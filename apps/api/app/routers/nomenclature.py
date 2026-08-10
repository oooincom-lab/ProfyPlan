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


@router.get("/search/", response_model=list[NomenclatureOut])
async def search_items(
    q: str,
    limit: int = 10,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    """Fuzzy search nomenclature by name. Uses ILIKE + word prefix matching."""
    from sqlalchemy import or_, and_
    # Normalize query: split into words, match each as prefix
    words = [w.strip() for w in q.split() if w.strip()]
    if not words:
        return []
    # Build ILIKE conditions: each word as prefix OR full substring
    conditions = []
    for w in words:
        pattern = f"%{w}%"
        conditions.append(Nomenclature.name.ilike(pattern))
        conditions.append(Nomenclature.code.ilike(pattern))
        conditions.append(Nomenclature.article.ilike(pattern))
    stmt = (
        select(Nomenclature)
        .where(and_(Nomenclature.tenant_id == tenant_id, or_(*conditions)))
        .order_by(Nomenclature.name)
        .limit(limit)
    )
    res = await db.execute(stmt)
    return res.scalars().all()


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
