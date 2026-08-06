"""
CRUD-роутер для календарей доступности ресурсов.
"""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import get_current_tenant_id
from app.models.resource import Resource
from app.models.resource_calendar import ResourceCalendar, ResourceCalendarSlot
from app.schemas.resource_calendar import (
    CalendarSlotCreate,
    CalendarSlotOut,
    ResourceCalendarCreate,
    ResourceCalendarOut,
    ResourceCalendarUpdate,
)

router = APIRouter(prefix="/v1", tags=["calendars"])


# ── Calendar CRUD ──

@router.get("/projects/{project_id}/resources/{resource_id}/calendar", response_model=ResourceCalendarOut)
async def get_calendar(
    project_id: UUID,
    resource_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """Получить календарь ресурса (или авто-создать 24/7 по умолчанию)."""
    result = await db.execute(
        select(ResourceCalendar)
        .options(selectinload(ResourceCalendar.slots))
        .where(
            ResourceCalendar.resource_id == resource_id,
            ResourceCalendar.tenant_id == tenant_id,
        )
    )
    calendar = result.scalar_one_or_none()

    if not calendar:
        # Проверим, что ресурс существует
        r = await db.execute(
            select(Resource).where(Resource.id == resource_id, Resource.project_id == project_id)
        )
        if not r.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Resource not found")

        # Авто-создаём календарь 24/7
        calendar = ResourceCalendar(
            tenant_id=tenant_id,
            resource_id=resource_id,
            name="Стандартный календарь",
        )
        db.add(calendar)
        await db.flush()

        # Слоты 24/7 для всех дней недели
        for d in range(7):
            slot = ResourceCalendarSlot(
                calendar_id=calendar.id,
                day_of_week=d,
                start_hour=0,
                end_hour=24,
            )
            db.add(slot)

        await db.commit()
        
        # Refresh with eager-loaded slots
        result = await db.execute(
            select(ResourceCalendar)
            .options(selectinload(ResourceCalendar.slots))
            .where(ResourceCalendar.id == calendar.id)
        )
        calendar = result.scalar_one()

    slots_out = [CalendarSlotOut(id=str(s.id), calendar_id=str(s.calendar_id), day_of_week=s.day_of_week, start_hour=s.start_hour, end_hour=s.end_hour, is_active=s.is_active, exception_date=s.exception_date) for s in calendar.slots]
    return ResourceCalendarOut(id=str(calendar.id), resource_id=str(calendar.resource_id), name=calendar.name, timezone=calendar.timezone, is_active=calendar.is_active, slots=slots_out)


@router.put("/projects/{project_id}/resources/{resource_id}/calendar", response_model=ResourceCalendarOut)
async def upsert_calendar(
    project_id: UUID,
    resource_id: UUID,
    body: ResourceCalendarCreate,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """Создать или перезаписать календарь ресурса."""
    result = await db.execute(
        select(ResourceCalendar)
        .options(selectinload(ResourceCalendar.slots))
        .where(
            ResourceCalendar.resource_id == resource_id,
            ResourceCalendar.tenant_id == tenant_id,
        )
    )
    calendar = result.scalar_one_or_none()

    if calendar:
        # Удаляем старые слоты
        for s in calendar.slots:
            await db.delete(s)
        await db.flush()
        calendar.name = body.name
        calendar.timezone = body.timezone
        calendar.is_active = body.is_active
    else:
        calendar = ResourceCalendar(
            tenant_id=tenant_id,
            resource_id=resource_id,
            name=body.name,
            timezone=body.timezone,
            is_active=body.is_active,
        )
        db.add(calendar)
        await db.flush()

    # Создаём новые слоты
    for sc in body.slots:
        slot = ResourceCalendarSlot(
            calendar_id=calendar.id,
            day_of_week=sc.day_of_week,
            start_hour=sc.start_hour,
            end_hour=sc.end_hour,
            is_active=sc.is_active,
            exception_date=sc.exception_date,
        )
        db.add(slot)

    await db.commit()
    
    # Refresh with eager-loaded slots
    result = await db.execute(
        select(ResourceCalendar)
        .options(selectinload(ResourceCalendar.slots))
        .where(ResourceCalendar.id == calendar.id)
    )
    calendar = result.scalar_one()

    slots_out = [CalendarSlotOut(id=str(s.id), calendar_id=str(s.calendar_id), day_of_week=s.day_of_week, start_hour=s.start_hour, end_hour=s.end_hour, is_active=s.is_active, exception_date=s.exception_date) for s in calendar.slots]
    return ResourceCalendarOut(id=str(calendar.id), resource_id=str(calendar.resource_id), name=calendar.name, timezone=calendar.timezone, is_active=calendar.is_active, slots=slots_out)
