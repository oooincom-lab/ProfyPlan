"""CRUD для справочника контрагентов."""
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_tenant_id
from app.models.counterparty import Counterparty
from app.schemas.counterparty import CounterpartyCreate, CounterpartyOut, CounterpartyUpdate

router = APIRouter(prefix="/v1/counterparties", tags=["counterparties"])


@router.get("/", response_model=list[CounterpartyOut])
async def list_items(
    search: str | None = None,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Counterparty).where(Counterparty.tenant_id == tenant_id)
    if search:
        like = f"%{search.strip()}%"
        stmt = stmt.where(or_(
            Counterparty.name.ilike(like),
            Counterparty.inn.ilike(like),
            Counterparty.external_code.ilike(like),
        ))
    stmt = stmt.order_by(Counterparty.name)
    res = await db.execute(stmt)
    return res.scalars().all()


@router.post("/", response_model=CounterpartyOut, status_code=201)
async def create_item(
    body: CounterpartyCreate,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    item = Counterparty(id=uuid4(), tenant_id=tenant_id, **body.model_dump())
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


@router.get("/{item_id}", response_model=CounterpartyOut)
async def get_item(
    item_id: str,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(
        select(Counterparty).where(
            Counterparty.id == item_id, Counterparty.tenant_id == tenant_id
        )
    )
    item = res.scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Not found")
    return item


@router.put("/{item_id}", response_model=CounterpartyOut)
async def update_item(
    item_id: str,
    body: CounterpartyUpdate,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(
        select(Counterparty).where(
            Counterparty.id == item_id, Counterparty.tenant_id == tenant_id
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
        select(Counterparty).where(
            Counterparty.id == item_id, Counterparty.tenant_id == tenant_id
        )
    )
    item = res.scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Not found")
    await db.delete(item)
    await db.commit()
