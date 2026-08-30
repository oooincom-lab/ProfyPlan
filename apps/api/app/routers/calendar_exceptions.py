"""Исключения доступности: ремонт, простой, отпуск, форс-мажор, обслуживание (v2.16)."""
from datetime import datetime
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_tenant_id
from app.models.calendar_exception import CalendarException

router = APIRouter(prefix="/v1/calendar-exceptions", tags=["calendar-exceptions"])

KINDS = {"repair", "downtime", "vacation", "force_majeure", "maintenance"}


class CalendarExceptionIn(BaseModel):
    level: str = Field(..., pattern="^(resource|department|project)$")
    resource_id: str | None = None
    department_id: str | None = None
    project_id: str | None = None
    kind: str
    date_from: datetime
    date_to: datetime
    hours_override: float | None = None
    note: str | None = None


class CalendarExceptionOut(CalendarExceptionIn):
    id: str
    created_at: datetime | None = None


@router.get("/", response_model=list[CalendarExceptionOut])
async def list_items(
    resource_id: str | None = None,
    department_id: str | None = None,
    project_id: str | None = None,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(CalendarException).where(CalendarException.tenant_id == tenant_id)
    if resource_id:
        stmt = stmt.where(CalendarException.resource_id == resource_id)
    if department_id:
        stmt = stmt.where(CalendarException.department_id == department_id)
    if project_id:
        stmt = stmt.where(CalendarException.project_id == project_id)
    stmt = stmt.order_by(CalendarException.date_from.desc())
    rows = (await db.execute(stmt)).scalars().all()
    return [CalendarExceptionOut(
        id=str(x.id), level=x.level,
        resource_id=str(x.resource_id) if x.resource_id else None,
        department_id=str(x.department_id) if x.department_id else None,
        project_id=str(x.project_id) if x.project_id else None,
        kind=x.kind, date_from=x.date_from, date_to=x.date_to,
        hours_override=float(x.hours_override) if x.hours_override is not None else None,
        note=x.note, created_at=x.created_at,
    ) for x in rows]


@router.post("", response_model=CalendarExceptionOut, status_code=201)
@router.post("/", response_model=CalendarExceptionOut, status_code=201)
async def create_item(
    body: CalendarExceptionIn,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    if body.kind not in KINDS:
        raise HTTPException(422, "Недопустимый тип исключения")
    item = CalendarException(
        id=uuid4(), tenant_id=tenant_id, level=body.level,
        resource_id=body.resource_id, department_id=body.department_id, project_id=body.project_id,
        kind=body.kind, date_from=body.date_from, date_to=body.date_to,
        hours_override=body.hours_override, note=body.note,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return CalendarExceptionOut(
        id=str(item.id), level=item.level,
        resource_id=str(item.resource_id) if item.resource_id else None,
        department_id=str(item.department_id) if item.department_id else None,
        project_id=str(item.project_id) if item.project_id else None,
        kind=item.kind, date_from=item.date_from, date_to=item.date_to,
        hours_override=float(item.hours_override) if item.hours_override is not None else None,
        note=item.note, created_at=item.created_at,
    )


@router.delete("/{item_id}", status_code=204)
async def delete_item(
    item_id: str,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    item = (await db.execute(
        select(CalendarException).where(
            CalendarException.id == item_id, CalendarException.tenant_id == tenant_id
        )
    )).scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Исключение не найдено")
    await db.delete(item)
    await db.commit()
