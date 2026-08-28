"""CRUD каталога операций (Шаг 3 плана v2.15)."""
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_tenant_id
from app.models.catalog_operation import CatalogOperation
from app.schemas.catalog_operation import (
    CatalogOperationCreate,
    CatalogOperationOut,
    CatalogOperationUpdate,
)

router = APIRouter(prefix="/v1/catalog-operations", tags=["catalog-operations"])


@router.get("/", response_model=list[CatalogOperationOut])
async def list_items(
    search: str | None = None,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(CatalogOperation).where(CatalogOperation.tenant_id == tenant_id)
    if search:
        like = f"%{search.strip()}%"
        stmt = stmt.where(or_(
            CatalogOperation.name.ilike(like),
            CatalogOperation.notes.ilike(like),
        ))
    stmt = stmt.order_by(CatalogOperation.name)
    res = await db.execute(stmt)
    return res.scalars().all()


@router.post("/", response_model=CatalogOperationOut, status_code=201)
async def create_item(
    body: CatalogOperationCreate,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    item = CatalogOperation(id=uuid4(), tenant_id=tenant_id, **body.model_dump())
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


@router.patch("/{item_id}", response_model=CatalogOperationOut)
async def update_item(
    item_id: str,
    body: CatalogOperationUpdate,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    item = (await db.execute(
        select(CatalogOperation).where(
            CatalogOperation.id == item_id, CatalogOperation.tenant_id == tenant_id
        )
    )).scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Операция не найдена")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(item, k, v)
    await db.commit()
    await db.refresh(item)
    return item


@router.delete("/{item_id}", status_code=204)
async def delete_item(
    item_id: str,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    item = (await db.execute(
        select(CatalogOperation).where(
            CatalogOperation.id == item_id, CatalogOperation.tenant_id == tenant_id
        )
    )).scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Операция не найдена")
    await db.delete(item)
    await db.commit()
