"""Read-only API заказ-нарядов для проверки импорта и будущего экрана."""
from __future__ import annotations

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import get_current_tenant_id
from app.models.work_order import WorkOrder, WorkOrderLine

router = APIRouter(prefix="/v1/work-orders", tags=["work-orders"])


def _line_out(line: WorkOrderLine) -> dict:
    return {
        "id": str(line.id),
        "line_uid": line.line_uid,
        "operation_id": str(line.operation_id) if line.operation_id else None,
        "nomenclature_uid": line.nomenclature_uid,
        "nomenclature_name": line.nomenclature_name,
        "nomenclature_kind": line.nomenclature_kind,
        "work_type_uid": line.work_type_uid,
        "work_type_name": line.work_type_name,
        "quantity": float(line.quantity or 0),
        "unit": line.unit,
        "duration_hours": float(line.duration_hours or 0),
        "sequence": line.sequence,
        "department_id": str(line.department_id) if line.department_id else None,
        "executor_uid": line.executor_uid,
        "executor_type": line.executor_type,
        "resource_uid": line.resource_uid,
        "ktu": float(line.ktu or 1),
        "executors": [
            {
                "id": str(e.id),
                "executor_uid": e.executor_uid,
                "executor_type": e.executor_type,
                "resource_uid": e.resource_uid,
                "role": e.role,
                "capacity_demand": float(e.capacity_demand or 0),
                "ktu": float(e.ktu or 1),
            }
            for e in (line.executors or [])
        ],
    }


def _out(wo: WorkOrder) -> dict:
    return {
        "id": str(wo.id),
        "ext_uid": wo.ext_uid,
        "ext_id": wo.ext_id,
        "number": wo.number,
        "doc_date": wo.doc_date.isoformat() if wo.doc_date else None,
        "status": wo.status,
        "project_id": str(wo.project_id) if wo.project_id else None,
        "organization_id": str(wo.organization_id) if wo.organization_id else None,
        "parent_production_order_id": str(wo.parent_production_order_id) if wo.parent_production_order_id else None,
        "pending_project_uid": wo.pending_project_uid,
        "lines": [_line_out(line) for line in (wo.lines or [])],
    }


@router.get("")
async def list_work_orders(
    project_id: Optional[UUID] = None,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    stmt = (
        select(WorkOrder)
        .options(selectinload(WorkOrder.lines).selectinload(WorkOrderLine.executors))
        .where(WorkOrder.tenant_id == tenant_id)
        .order_by(WorkOrder.created_at.desc())
    )
    if project_id:
        stmt = stmt.where(WorkOrder.project_id == project_id)
    rows = (await db.execute(stmt)).scalars().all()
    return [_out(wo) for wo in rows]


@router.get("/{work_order_id}")
async def get_work_order(
    work_order_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    wo = (await db.execute(
        select(WorkOrder)
        .options(selectinload(WorkOrder.lines).selectinload(WorkOrderLine.executors))
        .where(WorkOrder.id == work_order_id, WorkOrder.tenant_id == tenant_id)
    )).scalars().first()
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")
    return _out(wo)
