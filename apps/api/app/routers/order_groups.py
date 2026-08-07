"""
API для OrderGroup и OrderPool.
"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_tenant_id, get_current_user
from app.models.order_group import OrderGroup
from app.models.order_pool import OrderPool
from app.models.production_order import ProductionOrder
from app.models.tenant import User

groups_router = APIRouter(prefix="/v1", tags=["groups"])


# ── Schemas ────────────────────────────────────────────────────────
class GroupCreate(BaseModel):
    name: str
    sort_order: int = 0
    notes: Optional[str] = None


class GroupUpdate(BaseModel):
    name: Optional[str] = None
    sort_order: Optional[int] = None
    notes: Optional[str] = None


class PoolCreate(BaseModel):
    name: str
    group_id: Optional[uuid.UUID] = None
    order_ids: list[uuid.UUID] = []
    notes: Optional[str] = None


class PoolUpdate(BaseModel):
    name: Optional[str] = None
    group_id: Optional[uuid.UUID] = None
    notes: Optional[str] = None


class OrderMoveRequest(BaseModel):
    target: str  # "group" | "pool" | "root"
    id: Optional[uuid.UUID] = None  # group_id или pool_id, если target != "root"


# ── Groups ──────────────────────────────────────────────────────────
@groups_router.get("/projects/{project_id}/groups")
async def list_groups(
    project_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(OrderGroup)
        .where(OrderGroup.project_id == project_id, OrderGroup.tenant_id == tenant_id)
        .order_by(OrderGroup.sort_order)
    )
    groups = result.scalars().all()
    return {"items": [{"id": g.id, "name": g.name, "sort_order": g.sort_order, "notes": g.notes} for g in groups]}


@groups_router.post("/projects/{project_id}/groups")
async def create_group(
    project_id: uuid.UUID,
    body: GroupCreate,
    tenant_id: uuid.UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    group = OrderGroup(
        tenant_id=tenant_id,
        project_id=project_id,
        name=body.name,
        sort_order=body.sort_order,
        notes=body.notes,
    )
    db.add(group)
    await db.commit()
    await db.refresh(group)
    return {"id": group.id, "name": group.name}


@groups_router.put("/projects/{project_id}/groups/{group_id}")
async def update_group(
    project_id: uuid.UUID,
    group_id: uuid.UUID,
    body: GroupUpdate,
    tenant_id: uuid.UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(OrderGroup).where(OrderGroup.id == group_id, OrderGroup.tenant_id == tenant_id)
    )
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(404, "Группа не найдена")
    if body.name is not None:
        group.name = body.name
    if body.sort_order is not None:
        group.sort_order = body.sort_order
    if body.notes is not None:
        group.notes = body.notes
    await db.commit()
    return {"id": group.id, "name": group.name}


@groups_router.delete("/projects/{project_id}/groups/{group_id}")
async def delete_group(
    project_id: uuid.UUID,
    group_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(OrderGroup).where(OrderGroup.id == group_id, OrderGroup.tenant_id == tenant_id)
    )
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(404, "Группа не найдена")
    # Возвращаем заказы группы в корень проекта
    await db.execute(
        select(ProductionOrder).where(ProductionOrder.group_id == group_id)
    )
    orders = (await db.execute(
        select(ProductionOrder).where(ProductionOrder.group_id == group_id)
    )).scalars().all()
    for o in orders:
        o.group_id = None
    # Возвращаем пулы группы в корень
    pools = (await db.execute(
        select(OrderPool).where(OrderPool.group_id == group_id)
    )).scalars().all()
    for p in pools:
        p.group_id = None
    await db.delete(group)
    await db.commit()
    return {"ok": True}


# ── Pools ───────────────────────────────────────────────────────────
@groups_router.get("/projects/{project_id}/pools")
async def list_pools(
    project_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(OrderPool).where(OrderPool.project_id == project_id, OrderPool.tenant_id == tenant_id)
    )
    pools = result.scalars().all()
    return {"items": [
        {"id": p.id, "name": p.name, "group_id": p.group_id, "notes": p.notes, "order_count": await _count_pool_orders(p.id, db)}
        for p in pools
    ]}


@groups_router.post("/projects/{project_id}/pools")
async def create_pool(
    project_id: uuid.UUID,
    body: PoolCreate,
    tenant_id: uuid.UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    pool = OrderPool(
        tenant_id=tenant_id,
        project_id=project_id,
        group_id=body.group_id,
        name=body.name,
        notes=body.notes,
    )
    db.add(pool)
    await db.flush()

    # Перемещаем заказы в пул
    for oid in body.order_ids:
        result = await db.execute(
            select(ProductionOrder).where(ProductionOrder.id == oid, ProductionOrder.tenant_id == tenant_id)
        )
        order = result.scalar_one_or_none()
        if order:
            order.pool_id = pool.id
            order.group_id = None  # заказ в пуле не может быть в группе напрямую

    await db.commit()
    await db.refresh(pool)
    return {"id": pool.id, "name": pool.name, "order_ids": [str(oid) for oid in body.order_ids]}


@groups_router.delete("/projects/{project_id}/pools/{pool_id}")
async def delete_pool(
    project_id: uuid.UUID,
    pool_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(OrderPool).where(OrderPool.id == pool_id, OrderPool.tenant_id == tenant_id)
    )
    pool = result.scalar_one_or_none()
    if not pool:
        raise HTTPException(404, "Пул не найден")
    # Возвращаем заказы в корень проекта
    orders = (await db.execute(
        select(ProductionOrder).where(ProductionOrder.pool_id == pool_id)
    )).scalars().all()
    for o in orders:
        o.pool_id = None
    await db.delete(pool)
    await db.commit()
    return {"ok": True}


# ── Move order ──────────────────────────────────────────────────────
@groups_router.post("/orders/{order_id}/move")
async def move_order(
    order_id: uuid.UUID,
    body: OrderMoveRequest,
    tenant_id: uuid.UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ProductionOrder).where(ProductionOrder.id == order_id, ProductionOrder.tenant_id == tenant_id)
    )
    order = result.scalar_one_or_none()
    if not order:
        raise HTTPException(404, "Заказ не найден")

    if body.target == "root":
        order.group_id = None
        order.pool_id = None
    elif body.target == "group":
        if not body.id:
            raise HTTPException(400, "group_id обязателен для target=group")
        order.group_id = body.id
        order.pool_id = None
    elif body.target == "pool":
        if not body.id:
            raise HTTPException(400, "pool_id обязателен для target=pool")
        order.pool_id = body.id
        order.group_id = None
    else:
        raise HTTPException(400, "target должен быть group, pool или root")

    await db.commit()
    return {"ok": True, "group_id": order.group_id, "pool_id": order.pool_id}


async def _count_pool_orders(pool_id: uuid.UUID, db: AsyncSession) -> int:
    result = await db.execute(
        select(func.count(ProductionOrder.id)).where(ProductionOrder.pool_id == pool_id)
    )
    return result.scalar() or 0
