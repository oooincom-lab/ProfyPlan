"""
Роутер календарей поставщиков и сводки закупок.
"""
from datetime import time
from decimal import Decimal
from typing import Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, delete, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_tenant_id
from app.models.supplier_calendar import SupplierCalendar
from app.models.operation import Operation
from app.schemas.supplier_calendar import (
    SupplierCalendarUpsert,
    SupplierCalendarOut,
    SupplierCalendarFull,
    ProcurementSummary,
    SupplierSlot,
)

sc_router = APIRouter(prefix="/v1/suppliers", tags=["suppliers"])

DEFAULT_WORKDAY = [True] * 5 + [False, False]  # Mon-Fri working


@sc_router.get("/{supplier_id}/calendar", response_model=SupplierCalendarFull)
async def get_supplier_calendar(
    supplier_id: str,
    tenant_id: UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    """Получить календарь поставщика. Создаёт 24/7 по умолчанию."""
    result = await db.execute(
        select(SupplierCalendar).where(
            SupplierCalendar.tenant_id == tenant_id,
            SupplierCalendar.supplier_id == supplier_id,
        ).order_by(SupplierCalendar.day_of_week)
    )
    slots = result.scalars().all()

    if not slots:
        # Auto-create 24/7 default
        first = None
        for dow in range(7):
            s = SupplierCalendar(
                id=uuid4(),
                tenant_id=tenant_id,
                supplier_id=supplier_id,
                day_of_week=dow,
                is_working=True,
                start_time=time(0, 0),
                end_time=time(23, 59),
                lead_time_days=Decimal("0"),
            )
            db.add(s)
            if first is None:
                first = s

        await db.flush()

        return SupplierCalendarFull(
            supplier_id=supplier_id,
            supplier_name=None,
            lead_time_days=Decimal("0"),
            slots=[SupplierCalendarOut.model_validate(
                await _get_or_default(db, tenant_id, supplier_id, dow)
            ) for dow in range(7)],
        )

    # Collect metadata
    lead_time = slots[0].lead_time_days if slots else Decimal("0")
    return SupplierCalendarFull(
        supplier_id=supplier_id,
        supplier_name=slots[0].supplier_name if slots else None,
        lead_time_days=lead_time,
        min_order_qty=slots[0].min_order_qty if slots else None,
        notes=slots[0].notes if slots else None,
        slots=[SupplierCalendarOut.model_validate(s) for s in slots],
    )


async def _get_or_default(db: AsyncSession, tenant_id: UUID, supplier_id: str, dow: int):
    result = await db.execute(
        select(SupplierCalendar).where(
            SupplierCalendar.tenant_id == tenant_id,
            SupplierCalendar.supplier_id == supplier_id,
            SupplierCalendar.day_of_week == dow,
        )
    )
    s = result.scalar_one_or_none()
    if s:
        return s
    return SupplierCalendar(
        id=uuid4(),
        tenant_id=tenant_id,
        supplier_id=supplier_id,
        day_of_week=dow,
        is_working=True,
        start_time=time(0, 0),
        end_time=time(23, 59),
    )


@sc_router.put("/{supplier_id}/calendar", response_model=SupplierCalendarFull)
async def upsert_supplier_calendar(
    supplier_id: str,
    body: SupplierCalendarUpsert,
    tenant_id: UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    """Обновить календарь поставщика."""
    # Delete existing slots
    await db.execute(
        delete(SupplierCalendar).where(
            SupplierCalendar.tenant_id == tenant_id,
            SupplierCalendar.supplier_id == supplier_id,
        )
    )
    await db.flush()

    if not body.slots:
        # Default Mon-Fri 9-18
        body.slots = [
            SupplierSlot(day_of_week=d, is_working=DEFAULT_WORKDAY[d],
                         start_time=time(9, 0), end_time=time(18, 0))
            for d in range(7)
        ]

    for slot in body.slots:
        db.add(SupplierCalendar(
            id=uuid4(),
            tenant_id=tenant_id,
            supplier_id=supplier_id,
            supplier_name=body.supplier_name,
            day_of_week=slot.day_of_week,
            is_working=slot.is_working,
            start_time=slot.start_time,
            end_time=slot.end_time,
            lead_time_days=body.lead_time_days,
            min_order_qty=body.min_order_qty,
            notes=body.notes,
        ))

    await db.flush()

    # Re-fetch all slots
    result = await db.execute(
        select(SupplierCalendar).where(
            SupplierCalendar.tenant_id == tenant_id,
            SupplierCalendar.supplier_id == supplier_id,
        ).order_by(SupplierCalendar.day_of_week)
    )
    slots = result.scalars().all()

    return SupplierCalendarFull(
        supplier_id=supplier_id,
        supplier_name=body.supplier_name,
        lead_time_days=body.lead_time_days,
        min_order_qty=body.min_order_qty,
        notes=body.notes,
        slots=[SupplierCalendarOut.model_validate(s) for s in slots],
    )


@sc_router.get("/procurement/summary", response_model=list[ProcurementSummary])
async def procurement_summary(
    tenant_id: UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    """Сводка закупок по всем проектам: группировка по поставщикам."""
    # Get all procurement operations
    result = await db.execute(
        select(Operation).where(
            Operation.tenant_id == tenant_id,
            Operation.operation_type == "procurement",
        )
    )
    proc_ops = result.scalars().all()

    # Group by supplier
    by_supplier: dict[str, list] = {}
    for op in proc_ops:
        sid = op.supplier_id or "unknown"
        by_supplier.setdefault(sid, []).append(op)

    summaries = []
    for sid, ops in by_supplier.items():
        supplier_name = sid
        items = []
        for op in ops:
            items.append({
                "operation_id": str(op.id),
                "name": op.name,
                "output_product": op.output_product,
                "output_quantity": float(op.output_quantity) if op.output_quantity else 0,
                "project_id": str(op.project_id),
            })
        summaries.append(ProcurementSummary(
            supplier_id=sid,
            supplier_name=supplier_name,
            total_orders=len(ops),
            items=items,
        ))

    return summaries
