"""CRUD для справочника номенклатуры."""
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_tenant_id, get_db
from app.models.nomenclature import Nomenclature
from app.schemas.nomenclature import NomenclatureCreate, NomenclatureOut, NomenclatureUpdate

router = APIRouter(prefix="/v1/nomenclature", tags=["nomenclature"])


@router.get("/", response_model=list[NomenclatureOut])
async def list_items(
    project_id: str | None = None,
    ntype: str | None = None,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Nomenclature).where(Nomenclature.tenant_id == tenant_id)
    if project_id:
        stmt = stmt.where(Nomenclature.project_id == project_id)
    if ntype:
        stmt = stmt.where(Nomenclature.ntype == ntype)
    stmt = stmt.order_by(Nomenclature.name)
    res = await db.execute(stmt)
    return res.scalars().all()


@router.post("/", response_model=NomenclatureOut, status_code=201)
async def create_item(
    body: NomenclatureCreate,
    project_id: str | None = None,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    item = Nomenclature(
        id=uuid4(),
        tenant_id=tenant_id,
        project_id=project_id,
        **body.model_dump(),
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


@router.get("/{item_id}", response_model=NomenclatureOut)
async def get_item(
    item_id: str,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(
        select(Nomenclature).where(
            Nomenclature.id == item_id, Nomenclature.tenant_id == tenant_id
        )
    )
    item = res.scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Not found")
    return item


@router.put("/{item_id}", response_model=NomenclatureOut)
async def update_item(
    item_id: str,
    body: NomenclatureUpdate,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(
        select(Nomenclature).where(
            Nomenclature.id == item_id, Nomenclature.tenant_id == tenant_id
        )
    )
    item = res.scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Not found")
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
    res = await db.execute(
        select(Nomenclature).where(
            Nomenclature.id == item_id, Nomenclature.tenant_id == tenant_id
        )
    )
    item = res.scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Not found")
    await db.delete(item)
    await db.commit()
