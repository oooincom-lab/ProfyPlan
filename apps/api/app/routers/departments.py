"""CRUD справочника подразделений (Шаг 4 плана v2.15)."""
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_tenant_id
from app.models.department import Department
from app.schemas.department import DepartmentCreate, DepartmentOut, DepartmentUpdate

router = APIRouter(prefix="/v1/departments", tags=["departments"])


@router.get("/", response_model=list[DepartmentOut])
async def list_items(
    search: str | None = None,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Department).where(Department.tenant_id == tenant_id)
    if search:
        like = f"%{search.strip()}%"
        stmt = stmt.where(or_(
            Department.name.ilike(like),
            Department.code.ilike(like),
        ))
    stmt = stmt.order_by(Department.name)
    res = await db.execute(stmt)
    return res.scalars().all()


async def _validate_parent(db: AsyncSession, tenant_id: str, parent_id, self_id=None):
    """Родитель должен существовать в тенанте; циклы и self запрещены."""
    if parent_id is None:
        return
    cur = (await db.execute(
        select(Department).where(Department.id == parent_id, Department.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not cur:
        raise HTTPException(400, "Родительское подразделение не найдено")
    if self_id and str(cur.id) == str(self_id):
        raise HTTPException(400, "Подразделение не может быть родителем самого себя")
    hops = 0
    seen = set()
    while cur.parent_id and hops < 12:
        if str(cur.id) in seen:
            break
        seen.add(str(cur.id))
        if self_id and str(cur.parent_id) == str(self_id):
            raise HTTPException(400, "Цикл в иерархии подразделений")
        cur = (await db.execute(
            select(Department).where(Department.id == cur.parent_id, Department.tenant_id == tenant_id)
        )).scalar_one_or_none()
        if not cur:
            break
        hops += 1


@router.post("/", response_model=DepartmentOut, status_code=201)
async def create_item(
    body: DepartmentCreate,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    await _validate_parent(db, tenant_id, body.parent_id)
    item = Department(id=uuid4(), tenant_id=tenant_id, **body.model_dump())
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


@router.patch("/{item_id}", response_model=DepartmentOut)
async def update_item(
    item_id: str,
    body: DepartmentUpdate,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    item = (await db.execute(
        select(Department).where(
            Department.id == item_id, Department.tenant_id == tenant_id
        )
    )).scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Подразделение не найдено")
    await _validate_parent(db, tenant_id, body.parent_id, self_id=item.id)
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
        select(Department).where(
            Department.id == item_id, Department.tenant_id == tenant_id
        )
    )).scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Подразделение не найдено")
    await db.delete(item)
    await db.commit()
