"""CRUD справочника организаций."""
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_tenant_id
from app.models.organization import Organization
from app.schemas.organization import OrganizationCreate, OrganizationOut, OrganizationUpdate

router = APIRouter(prefix="/v1/organizations", tags=["organizations"])


@router.get("", response_model=list[OrganizationOut])
@router.get("/", response_model=list[OrganizationOut])
async def list_items(search: str | None = None, tenant_id: str = Depends(get_current_tenant_id), db: AsyncSession = Depends(get_db)):
    stmt = select(Organization).where(Organization.tenant_id == tenant_id)
    if search:
        like = f"%{search.strip()}%"
        stmt = stmt.where(or_(Organization.name.ilike(like), Organization.inn.ilike(like)))
    stmt = stmt.order_by(Organization.name)
    return (await db.execute(stmt)).scalars().all()


@router.post("", response_model=OrganizationOut, status_code=201)
@router.post("/", response_model=OrganizationOut, status_code=201)
async def create_item(body: OrganizationCreate, tenant_id: str = Depends(get_current_tenant_id), db: AsyncSession = Depends(get_db)):
    item = Organization(id=uuid4(), tenant_id=tenant_id, **body.model_dump())
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


@router.patch("/{item_id}", response_model=OrganizationOut)
async def update_item(item_id: str, body: OrganizationUpdate, tenant_id: str = Depends(get_current_tenant_id), db: AsyncSession = Depends(get_db)):
    item = (await db.execute(select(Organization).where(Organization.id == item_id, Organization.tenant_id == tenant_id))).scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Организация не найдена")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(item, k, v)
    await db.commit()
    await db.refresh(item)
    return item


@router.delete("/{item_id}", status_code=204)
async def delete_item(item_id: str, tenant_id: str = Depends(get_current_tenant_id), db: AsyncSession = Depends(get_db)):
    item = (await db.execute(select(Organization).where(Organization.id == item_id, Organization.tenant_id == tenant_id))).scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Организация не найдена")
    await db.delete(item)
    await db.commit()
