"""CRUD для справочника графиков работы (WorkSchedule)."""
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import get_current_tenant_id
from app.models.work_schedule import WorkSchedule, WorkScheduleSlot
from app.schemas.work_schedule import (
    WorkScheduleCreate,
    WorkScheduleOut,
    WorkScheduleUpdate,
)

router = APIRouter(prefix="/v1/work-schedules", tags=["work-schedules"])


def _load_slots():
    return selectinload(WorkSchedule.slots)


@router.get("/", response_model=list[WorkScheduleOut])
async def list_items(
    search: str | None = None,
    tenant_id: UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(WorkSchedule).options(_load_slots()).where(
        WorkSchedule.tenant_id == tenant_id
    )
    if search:
        like = f"%{search.strip()}%"
        stmt = stmt.where(WorkSchedule.name.ilike(like))
    stmt = stmt.order_by(WorkSchedule.name)
    res = await db.execute(stmt)
    return res.scalars().all()


@router.post("/", response_model=WorkScheduleOut, status_code=201)
async def create_item(
    body: WorkScheduleCreate,
    tenant_id: UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    item = WorkSchedule(
        id=uuid4(),
        tenant_id=tenant_id,
        name=body.name,
        fill_mode=body.fill_mode,
        cycle_length=body.cycle_length,
        timezone=body.timezone,
    )
    db.add(item)
    await db.flush()
    for sc in body.slots:
        db.add(
            WorkScheduleSlot(
                schedule_id=item.id,
                day_of_week=sc.day_of_week,
                cycle_day=sc.cycle_day,
                start_hour=sc.start_hour,
                end_hour=sc.end_hour,
                kind=sc.kind,
            )
        )
    await db.commit()
    res = await db.execute(
        select(WorkSchedule).options(_load_slots()).where(WorkSchedule.id == item.id)
    )
    return res.scalar_one()


@router.get("/{item_id}", response_model=WorkScheduleOut)
async def get_item(
    item_id: UUID,
    tenant_id: UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(
        select(WorkSchedule)
        .options(_load_slots())
        .where(WorkSchedule.id == item_id, WorkSchedule.tenant_id == tenant_id)
    )
    item = res.scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Not found")
    return item


@router.put("/{item_id}", response_model=WorkScheduleOut)
async def update_item(
    item_id: UUID,
    body: WorkScheduleUpdate,
    tenant_id: UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(
        select(WorkSchedule)
        .options(_load_slots())
        .where(WorkSchedule.id == item_id, WorkSchedule.tenant_id == tenant_id)
    )
    item = res.scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Not found")

    data = body.model_dump(exclude_unset=True)
    slots = data.pop("slots", None)
    for k, v in data.items():
        setattr(item, k, v)

    if slots is not None:
        for s in item.slots:
            await db.delete(s)
        await db.flush()
        for sc in slots:
            db.add(
                WorkScheduleSlot(
                    schedule_id=item.id,
                    day_of_week=sc.get("day_of_week"),
                    cycle_day=sc.get("cycle_day"),
                    start_hour=sc["start_hour"],
                    end_hour=sc["end_hour"],
                    kind=sc.get("kind", "work"),
                )
            )

    await db.commit()
    res = await db.execute(
        select(WorkSchedule).options(_load_slots()).where(WorkSchedule.id == item.id)
    )
    return res.scalar_one()


@router.delete("/{item_id}", status_code=204)
async def delete_item(
    item_id: UUID,
    tenant_id: UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(
        select(WorkSchedule).where(
            WorkSchedule.id == item_id, WorkSchedule.tenant_id == tenant_id
        )
    )
    item = res.scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Not found")
    await db.delete(item)
    await db.commit()
