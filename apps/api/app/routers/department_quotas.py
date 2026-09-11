"""CRUD квот ресурсов по подразделениям (ResourceDepartmentQuota)."""
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_tenant_id
from app.models.department import Department
from app.models.resource import Resource
from app.models.resource_department_quota import ResourceDepartmentQuota
from app.schemas.resource_department_quota import (
    DeptQuotaCreate,
    DeptQuotaOut,
    DeptQuotaUpdate,
)

router = APIRouter(prefix="/v1/department-quotas", tags=["department-quotas"])


async def _names(db: AsyncSession, tenant_id: UUID, items: list) -> dict:
    dept_ids = {i.department_id for i in items}
    res_ids = {i.resource_id for i in items}
    depts = {}
    if dept_ids:
        depts = {
            d.id: d.name
            for d in (await db.execute(
                select(Department).where(Department.id.in_(dept_ids), Department.tenant_id == tenant_id)
            )).scalars().all()
        }
    res = {}
    if res_ids:
        res = {
            r.id: r.name
            for r in (await db.execute(
                select(Resource).where(Resource.id.in_(res_ids), Resource.tenant_id == tenant_id)
            )).scalars().all()
        }
    return {"depts": depts, "res": res}


def _out(item, names) -> DeptQuotaOut:
    return DeptQuotaOut(
        id=item.id,
        tenant_id=item.tenant_id,
        department_id=item.department_id,
        resource_id=item.resource_id,
        quota_share=item.quota_share,
        is_active=item.is_active,
        department_name=names["depts"].get(item.department_id),
        resource_name=names["res"].get(item.resource_id),
    )


@router.get("", response_model=list[DeptQuotaOut])
async def list_quotas(
    department_id: UUID | None = None,
    resource_id: UUID | None = None,
    active_only: bool = False,
    tenant_id: UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(ResourceDepartmentQuota).where(ResourceDepartmentQuota.tenant_id == tenant_id)
    if department_id:
        stmt = stmt.where(ResourceDepartmentQuota.department_id == department_id)
    if resource_id:
        stmt = stmt.where(ResourceDepartmentQuota.resource_id == resource_id)
    if active_only:
        stmt = stmt.where(ResourceDepartmentQuota.is_active.is_(True))
    items = (await db.execute(stmt)).scalars().all()
    names = await _names(db, tenant_id, items)
    return [_out(i, names) for i in items]


@router.post("", response_model=DeptQuotaOut, status_code=201)
async def create_quota(
    body: DeptQuotaCreate,
    tenant_id: UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    dep = (await db.execute(
        select(Department).where(Department.id == body.department_id, Department.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not dep:
        raise HTTPException(404, "Подразделение не найдено")
    res = (await db.execute(
        select(Resource).where(Resource.id == body.resource_id, Resource.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not res:
        raise HTTPException(404, "Ресурс не найден")
    exists = (await db.execute(
        select(ResourceDepartmentQuota).where(
            ResourceDepartmentQuota.tenant_id == tenant_id,
            ResourceDepartmentQuota.department_id == body.department_id,
            ResourceDepartmentQuota.resource_id == body.resource_id,
        )
    )).scalar_one_or_none()
    if exists:
        exists.quota_share = body.quota_share
        exists.is_active = True
        await db.commit()
        await db.refresh(exists)
        names = await _names(db, tenant_id, [exists])
        return _out(exists, names)
    item = ResourceDepartmentQuota(
        id=uuid4(),
        tenant_id=tenant_id,
        department_id=body.department_id,
        resource_id=body.resource_id,
        quota_share=body.quota_share,
        is_active=True,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    names = await _names(db, tenant_id, [item])
    return _out(item, names)


@router.put("/{quota_id}", response_model=DeptQuotaOut)
async def update_quota(
    quota_id: UUID,
    body: DeptQuotaUpdate,
    tenant_id: UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    item = (await db.execute(
        select(ResourceDepartmentQuota).where(
            ResourceDepartmentQuota.id == quota_id, ResourceDepartmentQuota.tenant_id == tenant_id
        )
    )).scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Not found")
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(item, k, v)
    await db.commit()
    await db.refresh(item)
    names = await _names(db, tenant_id, [item])
    return _out(item, names)


@router.delete("/{quota_id}", status_code=204)
async def delete_quota(
    quota_id: UUID,
    tenant_id: UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    item = (await db.execute(
        select(ResourceDepartmentQuota).where(
            ResourceDepartmentQuota.id == quota_id, ResourceDepartmentQuota.tenant_id == tenant_id
        )
    )).scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Not found")
    await db.delete(item)
    await db.commit()
