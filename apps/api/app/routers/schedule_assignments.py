"""Версии графиков ресурса: назначение графика с даты (v2.16)."""
from datetime import date
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_tenant_id
from app.models.schedule_assignment import ScheduleAssignment
from app.models.work_schedule import WorkSchedule

router = APIRouter(prefix="/v1", tags=["schedule-assignments"])


class ScheduleAssignmentCreate(BaseModel):
    schedule_id: str
    valid_from: date
    note: str | None = None


class ScheduleAssignmentOut(BaseModel):
    id: str
    resource_id: str
    schedule_id: str
    schedule_name: str | None = None
    valid_from: date
    note: str | None = None

    class Config:
        from_attributes = True


@router.get("/resources/{resource_id}/schedule-assignments", response_model=list[ScheduleAssignmentOut])
async def list_items(
    resource_id: str,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(ScheduleAssignment).where(
            ScheduleAssignment.resource_id == resource_id,
            ScheduleAssignment.tenant_id == tenant_id,
        ).order_by(ScheduleAssignment.valid_from.desc())
    )).scalars().all()
    out = []
    for r in rows:
        ws = (await db.execute(select(WorkSchedule).where(WorkSchedule.id == r.schedule_id))).scalar_one_or_none()
        out.append(ScheduleAssignmentOut(
            id=str(r.id), resource_id=str(r.resource_id), schedule_id=str(r.schedule_id),
            schedule_name=ws.name if ws else None, valid_from=r.valid_from, note=r.note,
        ))
    return out


@router.post("/resources/{resource_id}/schedule-assignments", response_model=ScheduleAssignmentOut, status_code=201)
async def create_item(
    resource_id: str,
    body: ScheduleAssignmentCreate,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    item = ScheduleAssignment(
        id=uuid4(),
        tenant_id=tenant_id,
        resource_id=resource_id,
        schedule_id=body.schedule_id,
        valid_from=body.valid_from,
        note=body.note,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    ws = (await db.execute(select(WorkSchedule).where(WorkSchedule.id == item.schedule_id))).scalar_one_or_none()
    return ScheduleAssignmentOut(
        id=str(item.id), resource_id=str(item.resource_id), schedule_id=str(item.schedule_id),
        schedule_name=ws.name if ws else None, valid_from=item.valid_from, note=item.note,
    )


@router.delete("/schedule-assignments/{item_id}", status_code=204)
async def delete_item(
    item_id: str,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    item = (await db.execute(
        select(ScheduleAssignment).where(
            ScheduleAssignment.id == item_id, ScheduleAssignment.tenant_id == tenant_id
        )
    )).scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Назначение графика не найдено")
    await db.delete(item)
    await db.commit()
