"""CRUD для событий мощности ресурса (ResourceEvent)."""
from datetime import date
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_tenant_id
from app.models.resource_event import ResourceEvent
from app.schemas.resource_event import (
    ResourceEventCreate,
    ResourceEventOut,
    ResourceEventUpdate,
)

router = APIRouter(prefix="/v1/resource-events", tags=["resource-events"])


@router.get("/", response_model=list[ResourceEventOut])
async def list_items(
    resource_id: UUID | None = None,
    project_id: UUID | None = None,
    event_type: str | None = None,
    active_only: bool = False,
    date_from: date | None = None,
    date_to: date | None = None,
    tenant_id: UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(ResourceEvent).where(ResourceEvent.tenant_id == tenant_id)
    if resource_id:
        stmt = stmt.where(ResourceEvent.resource_id == resource_id)
    if project_id:
        stmt = stmt.where(ResourceEvent.project_id == project_id)
    if event_type:
        stmt = stmt.where(ResourceEvent.event_type == event_type)
    if active_only:
        stmt = stmt.where(ResourceEvent.is_active.is_(True))
    # Пересечение с интервалом [date_from, date_to]
    if date_from:
        stmt = stmt.where(ResourceEvent.date_to >= date_from)
    if date_to:
        stmt = stmt.where(ResourceEvent.date_from <= date_to)
    stmt = stmt.order_by(ResourceEvent.date_from.desc(), ResourceEvent.created_at.desc())
    res = await db.execute(stmt)
    return res.scalars().all()


@router.post("/", response_model=ResourceEventOut, status_code=201)
async def create_item(
    body: ResourceEventCreate,
    tenant_id: UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    if body.date_to < body.date_from:
        raise HTTPException(400, "date_to не может быть раньше date_from")
    item = ResourceEvent(
        id=uuid4(),
        tenant_id=tenant_id,
        resource_id=body.resource_id,
        project_id=body.project_id,
        event_type=body.event_type,
        capacity_multiplier=body.capacity_multiplier,
        capacity_absolute=body.capacity_absolute,
        reason=body.reason,
        related_operation_id=body.related_operation_id,
        base_document_type=body.base_document_type,
        base_document_id=body.base_document_id,
        date_from=body.date_from,
        date_to=body.date_to,
        is_active=True,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


@router.get("/{item_id}", response_model=ResourceEventOut)
async def get_item(
    item_id: UUID,
    tenant_id: UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(
        select(ResourceEvent).where(
            ResourceEvent.id == item_id, ResourceEvent.tenant_id == tenant_id
        )
    )
    item = res.scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Not found")
    return item


@router.put("/{item_id}", response_model=ResourceEventOut)
async def update_item(
    item_id: UUID,
    body: ResourceEventUpdate,
    tenant_id: UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(
        select(ResourceEvent).where(
            ResourceEvent.id == item_id, ResourceEvent.tenant_id == tenant_id
        )
    )
    item = res.scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Not found")
    data = body.model_dump(exclude_unset=True)
    new_from = data.get("date_from", item.date_from)
    new_to = data.get("date_to", item.date_to)
    if new_to < new_from:
        raise HTTPException(400, "date_to не может быть раньше date_from")
    for k, v in data.items():
        setattr(item, k, v)
    await db.commit()
    await db.refresh(item)
    return item


@router.delete("/{item_id}", status_code=204)
async def delete_item(
    item_id: UUID,
    tenant_id: UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(
        select(ResourceEvent).where(
            ResourceEvent.id == item_id, ResourceEvent.tenant_id == tenant_id
        )
    )
    item = res.scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Not found")
    await db.delete(item)
    await db.commit()
