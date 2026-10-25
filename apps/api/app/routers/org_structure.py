"""API настраиваемой оргструктуры и сотрудников."""
from __future__ import annotations

from typing import Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_tenant_id
from app.models.department import Department
from app.models.employee import Employee
from app.models.org_level import OrgLevel
from app.models.resource import Resource

router = APIRouter(prefix="/v1", tags=["org-structure"])


class OrgLevelIn(BaseModel):
    code: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=100)
    sort_order: int = 0
    can_be_resource: bool = False
    is_active: bool = True


class EmployeeIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    code: Optional[str] = None
    position: Optional[str] = None
    department_id: Optional[str] = None
    is_active: bool = True


def _uuid(value: Optional[str]):
    if not value:
        return None
    try:
        return UUID(str(value))
    except (ValueError, TypeError):
        raise HTTPException(400, "Некорректный UUID")


def _level_out(row: OrgLevel) -> dict:
    return {
        "id": str(row.id), "code": row.code, "name": row.name,
        "sort_order": row.sort_order, "can_be_resource": row.can_be_resource,
        "is_active": row.is_active,
    }


def _employee_out(row: Employee, resource=None) -> dict:
    return {
        "id": str(row.id), "department_id": str(row.department_id) if row.department_id else None,
        "name": row.name, "code": row.code, "position": row.position,
        "is_active": row.is_active, "source": row.source,
        "resource_enabled": bool(resource and resource.is_active),
        "resource_id": str(resource.id) if resource else None,
    }


class ResourceProfileIn(BaseModel):
    enabled: bool = True
    capacity_mode: str = "individual"


@router.get("/org-levels")
async def list_org_levels(
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    rows = (await db.execute(
        select(OrgLevel).where(OrgLevel.tenant_id == tenant_id, OrgLevel.is_active.is_(True))
        .order_by(OrgLevel.sort_order.asc(), OrgLevel.name.asc())
    )).scalars().all()
    return {"items": [_level_out(x) for x in rows], "count": len(rows)}


@router.post("/org-levels", status_code=201)
async def create_org_level(
    body: OrgLevelIn,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    row = OrgLevel(
        id=uuid4(), tenant_id=tenant_id,
        code=body.code.strip(), name=body.name.strip(),
        sort_order=body.sort_order, can_be_resource=body.can_be_resource,
        is_active=body.is_active,
    )
    db.add(row)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "Уровень с таким кодом уже существует")
    return _level_out(row)


@router.put("/org-levels/{level_id}")
async def update_org_level(
    level_id: UUID,
    body: OrgLevelIn,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    row = (await db.execute(
        select(OrgLevel).where(OrgLevel.id == level_id, OrgLevel.tenant_id == tenant_id)
    )).scalars().first()
    if row is None:
        raise HTTPException(404, "Уровень не найден")
    row.code = body.code.strip()
    row.name = body.name.strip()
    row.sort_order = body.sort_order
    row.can_be_resource = body.can_be_resource
    row.is_active = body.is_active
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "Уровень с таким кодом уже существует")
    return _level_out(row)


@router.delete("/org-levels/{level_id}", status_code=204)
async def delete_org_level(
    level_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    row = (await db.execute(
        select(OrgLevel).where(OrgLevel.id == level_id, OrgLevel.tenant_id == tenant_id)
    )).scalars().first()
    if row is None:
        raise HTTPException(404, "Уровень не найден")
    await db.delete(row)
    await db.commit()


@router.get("/employees")
async def list_employees(
    department_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    query = select(Employee).where(Employee.tenant_id == tenant_id)
    if department_id:
        query = query.where(Employee.department_id == _uuid(department_id))
    rows = (await db.execute(query.order_by(Employee.name.asc()))).scalars().all()
    items = []
    for row in rows:
        resource = await _resource_for(db, tenant_id, "employee", str(row.id))
        items.append(_employee_out(row, resource))
    return {"items": items, "count": len(items)}


@router.post("/employees", status_code=201)
async def create_employee(
    body: EmployeeIn,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    row = Employee(
        id=uuid4(), tenant_id=tenant_id, name=body.name.strip(),
        code=body.code, position=body.position,
        department_id=_uuid(body.department_id), is_active=body.is_active,
        source="profyplan",
    )
    db.add(row)
    await db.commit()
    return _employee_out(row)


@router.put("/employees/{employee_id}")
async def update_employee(
    employee_id: UUID,
    body: EmployeeIn,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    row = (await db.execute(
        select(Employee).where(Employee.id == employee_id, Employee.tenant_id == tenant_id)
    )).scalars().first()
    if row is None:
        raise HTTPException(404, "Сотрудник не найден")
    row.name = body.name.strip()
    row.code = body.code
    row.position = body.position
    row.department_id = _uuid(body.department_id)
    row.is_active = body.is_active
    await db.commit()
    return _employee_out(row)


@router.delete("/employees/{employee_id}", status_code=204)
async def delete_employee(
    employee_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    row = (await db.execute(
        select(Employee).where(Employee.id == employee_id, Employee.tenant_id == tenant_id)
    )).scalars().first()
    if row is None:
        raise HTTPException(404, "Сотрудник не найден")
    await db.delete(row)
    await db.commit()


@router.put("/departments/{department_id}/level")
async def set_department_level(
    department_id: UUID,
    level_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    row = (await db.execute(
        select(Department).where(Department.id == department_id, Department.tenant_id == tenant_id)
    )).scalars().first()
    if row is None:
        raise HTTPException(404, "Подразделение не найдено")
    row.level_id = _uuid(level_id)
    await db.commit()
    return {"id": str(row.id), "level_id": str(row.level_id) if row.level_id else None}


async def _resource_for(db: AsyncSession, tenant_id: UUID, subject_type: str, subject_uid: str):
    return (await db.execute(
        select(Resource).where(
            Resource.tenant_id == tenant_id,
            Resource.subject_type == subject_type,
            Resource.subject_uid == subject_uid,
        )
    )).scalars().first()


@router.get("/employees/{employee_id}/resource-profile")
async def get_employee_resource_profile(
    employee_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    employee = (await db.execute(
        select(Employee).where(Employee.id == employee_id, Employee.tenant_id == tenant_id)
    )).scalars().first()
    if employee is None:
        raise HTTPException(404, "Сотрудник не найден")
    resource = await _resource_for(db, tenant_id, "employee", str(employee.id))
    return {"enabled": bool(resource and resource.is_active), "resource_id": str(resource.id) if resource else None,
            "capacity_mode": resource.capacity_mode if resource else "individual"}


@router.put("/employees/{employee_id}/resource-profile")
async def set_employee_resource_profile(
    employee_id: UUID,
    body: ResourceProfileIn,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    employee = (await db.execute(
        select(Employee).where(Employee.id == employee_id, Employee.tenant_id == tenant_id)
    )).scalars().first()
    if employee is None:
        raise HTTPException(404, "Сотрудник не найден")
    resource = await _resource_for(db, tenant_id, "employee", str(employee.id))
    if not body.enabled:
        if resource is not None:
            resource.is_active = False
            await db.commit()
        return {"enabled": False, "resource_id": str(resource.id) if resource else None}
    if resource is None:
        resource = Resource(
            id=uuid4(), tenant_id=tenant_id, name=employee.name,
            resource_type="employee", capacity_per_unit=1, capacity_unit="hour",
            scope="shared", subject_type="employee", subject_uid=str(employee.id),
            capacity_mode=body.capacity_mode if body.capacity_mode in ("individual", "pool") else "individual",
            is_bookable=True, department_id=employee.department_id, is_active=True,
        )
        db.add(resource)
    else:
        resource.is_active = True
        resource.capacity_mode = body.capacity_mode if body.capacity_mode in ("individual", "pool") else "individual"
    await db.commit()
    return {"enabled": True, "resource_id": str(resource.id), "capacity_mode": resource.capacity_mode}


@router.put("/departments/{department_id}/resource-profile")
async def set_department_resource_profile(
    department_id: UUID,
    body: ResourceProfileIn,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    department = (await db.execute(
        select(Department).where(Department.id == department_id, Department.tenant_id == tenant_id)
    )).scalars().first()
    if department is None:
        raise HTTPException(404, "Подразделение не найдено")
    resource = await _resource_for(db, tenant_id, "org_unit", str(department.id))
    if not body.enabled:
        if resource is not None:
            resource.is_active = False
            await db.commit()
        return {"enabled": False, "resource_id": str(resource.id) if resource else None}
    if resource is None:
        resource = Resource(
            id=uuid4(), tenant_id=tenant_id, name=department.name,
            resource_type="team", capacity_per_unit=1, capacity_unit="hour",
            scope="shared", subject_type="org_unit", subject_uid=str(department.id),
            capacity_mode=body.capacity_mode if body.capacity_mode in ("individual", "pool") else "pool",
            is_bookable=True, department_id=department.id, is_active=True,
        )
        db.add(resource)
    else:
        resource.is_active = True
        resource.capacity_mode = body.capacity_mode if body.capacity_mode in ("individual", "pool") else "pool"
    await db.commit()
    return {"enabled": True, "resource_id": str(resource.id), "capacity_mode": resource.capacity_mode}
