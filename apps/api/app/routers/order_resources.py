"""Ресурсы заказа (Шаг 5 плана v2.15).

GET объединяет ресурсы из операций маршрутов заказа (источник истины) и
переопределения order_resources. PATCH/DELETE работают с переопределениями.
"""
from decimal import Decimal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_tenant_id
from app.models.department import Department
from app.models.order_resource import OrderResource
from app.models.production_order import ProductionOrder
from app.models.resource import Resource
from app.models.routing import Routing, RoutingOperation
from app.models.product_structure import ProductStructure
from app.schemas.order_resource import (
    OrderResourceCreate,
    OrderResourceOut,
    OrderResourceUpdate,
)

router = APIRouter(prefix="/v1", tags=["order-resources"])


async def _used_resource_ids(order_id, db) -> list:
    """Ресурсы, используемые операциями маршрутов узлов заказа."""
    rows = (await db.execute(
        select(RoutingOperation.resource_type_id)
        .join(Routing, RoutingOperation.routing_id == Routing.id)
        .join(ProductStructure, Routing.product_node_id == ProductStructure.id)
        .where(
            ProductStructure.order_id == order_id,
            RoutingOperation.resource_type_id.isnot(None),
        )
        .distinct()
    )).scalars().all()
    out = []
    for r in rows:
        try:
            out.append(str(r))
        except Exception:
            out.append(r)
    return out


@router.get("/orders/{order_id}/resources", response_model=list[OrderResourceOut])
async def list_resources(
    order_id: str,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    order = (await db.execute(
        select(ProductionOrder).where(
            ProductionOrder.id == order_id, ProductionOrder.tenant_id == tenant_id
        )
    )).scalar_one_or_none()
    if not order:
        raise HTTPException(404, "Заказ не найден")

    used = await _used_resource_ids(order_id, db)
    overrides = (await db.execute(
        select(OrderResource).where(OrderResource.order_id == order_id)
    )).scalars().all()
    ov_by_res = {str(o.resource_id): o for o in overrides}

    ids = set(used) | set(ov_by_res.keys())
    items = []
    for rid in ids:
        try:
            res = (await db.execute(
                select(Resource).where(Resource.id == rid, Resource.tenant_id == tenant_id)
            )).scalar_one_or_none()
        except Exception:
            res = None
        ov = ov_by_res.get(rid)
        dept_name = None
        if ov and ov.department_id:
            dept = (await db.execute(
                select(Department).where(Department.id == ov.department_id)
            )).scalar_one_or_none()
            dept_name = dept.name if dept else None
        items.append(OrderResourceOut(
            id=ov.id if ov else None,
            order_id=order_id,
            resource_id=rid,
            resource_name=res.name if res else rid,
            resource_unit=(str(res.capacity_unit) if res and res.capacity_unit else None),
            resource_type=(res.resource_type if res else None),
            department_id=ov.department_id if ov else None,
            department_name=dept_name,
            capacity=ov.capacity if ov else None,
            created_at=ov.created_at if ov else None,
        ))
    items.sort(key=lambda x: x.resource_name.lower())
    return items


@router.post("/orders/{order_id}/resources", response_model=OrderResourceOut, status_code=201)
async def create_override(
    order_id: str,
    body: OrderResourceCreate,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    order = (await db.execute(
        select(ProductionOrder).where(
            ProductionOrder.id == order_id, ProductionOrder.tenant_id == tenant_id
        )
    )).scalar_one_or_none()
    if not order:
        raise HTTPException(404, "Заказ не найден")
    res = (await db.execute(
        select(Resource).where(
            Resource.id == body.resource_id, Resource.tenant_id == tenant_id
        )
    )).scalar_one_or_none()
    if not res:
        raise HTTPException(404, "Ресурс не найден")

    existing = (await db.execute(
        select(OrderResource).where(
            OrderResource.order_id == order_id,
            OrderResource.resource_id == body.resource_id,
        )
    )).scalar_one_or_none()
    if existing:
        if body.department_id is not None:
            existing.department_id = body.department_id
        if body.capacity is not None:
            existing.capacity = body.capacity
        await db.commit()
        await db.refresh(existing)
        ov = existing
    else:
        ov = OrderResource(
            id=uuid4(),
            tenant_id=tenant_id,
            order_id=order_id,
            resource_id=body.resource_id,
            department_id=body.department_id,
            capacity=body.capacity,
        )
        db.add(ov)
        await db.commit()
        await db.refresh(ov)

    dept_name = None
    if ov.department_id:
        dept = (await db.execute(
            select(Department).where(Department.id == ov.department_id)
        )).scalar_one_or_none()
        dept_name = dept.name if dept else None
    return OrderResourceOut(
        id=ov.id,
        order_id=order_id,
        resource_id=str(ov.resource_id),
        resource_name=res.name,
        resource_unit=(str(res.capacity_unit) if res.capacity_unit else None),
        resource_type=res.resource_type,
        department_id=ov.department_id,
        department_name=dept_name,
        capacity=ov.capacity,
        created_at=ov.created_at,
    )


@router.patch("/order-resources/{item_id}", response_model=OrderResourceOut)
async def update_override(
    item_id: str,
    body: OrderResourceUpdate,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    ov = (await db.execute(
        select(OrderResource).where(
            OrderResource.id == item_id, OrderResource.tenant_id == tenant_id
        )
    )).scalar_one_or_none()
    if not ov:
        raise HTTPException(404, "Связь ресурса с заказом не найдена")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(ov, k, v)
    await db.commit()
    await db.refresh(ov)
    res = (await db.execute(select(Resource).where(Resource.id == ov.resource_id))).scalar_one_or_none()
    dept_name = None
    if ov.department_id:
        dept = (await db.execute(
            select(Department).where(Department.id == ov.department_id)
        )).scalar_one_or_none()
        dept_name = dept.name if dept else None
    return OrderResourceOut(
        id=ov.id,
        order_id=str(ov.order_id),
        resource_id=str(ov.resource_id),
        resource_name=res.name if res else str(ov.resource_id),
        resource_unit=(str(res.capacity_unit) if res and res.capacity_unit else None),
        resource_type=res.resource_type if res else None,
        department_id=ov.department_id,
        department_name=dept_name,
        capacity=ov.capacity,
        created_at=ov.created_at,
    )


@router.delete("/order-resources/{item_id}", status_code=204)
async def delete_override(
    item_id: str,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    ov = (await db.execute(
        select(OrderResource).where(
            OrderResource.id == item_id, OrderResource.tenant_id == tenant_id
        )
    )).scalar_one_or_none()
    if not ov:
        raise HTTPException(404, "Связь ресурса с заказом не найдена")
    await db.delete(ov)
    await db.commit()
