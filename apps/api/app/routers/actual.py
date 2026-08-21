"""
Actual Execution router — работа с фактом, автозакрытие, отмена закрытия.
"""
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, and_, or_, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_tenant_id
from app.models.plan_version import ActualExecution
from app.models.operation import Operation, OperationDependency

router = APIRouter(prefix="/v1", tags=["actual"])


# ── Schemas ─────────────────────────────────────────────

class ActualSaveRequest(BaseModel):
    status: str = "completed"  # not_started | in_progress | completed | delayed | cancelled
    fact_start: Optional[str] = None  # ISO datetime
    fact_end: Optional[str] = None
    quantity_completed: Optional[float] = None
    quantity_defect: Optional[float] = None
    deviation_reason: Optional[str] = None
    comment: Optional[str] = None
    recorded_by: Optional[str] = None  # UUID as string
    source: str = "manual"


class ActualResponse(BaseModel):
    id: str
    operation_id: str
    status: str
    fact_start: Optional[str] = None
    fact_end: Optional[str] = None
    quantity_completed: Optional[float] = None
    quantity_defect: Optional[float] = None
    deviation_reason: Optional[str] = None
    comment: Optional[str] = None
    source: str
    recorded_at: Optional[str] = None
    updated_at: Optional[str] = None
    edit_count: int = 0


class AutoCloseResponse(BaseModel):
    closed: int
    closed_operation_ids: list[str]


class UncloseResponse(BaseModel):
    removed: int
    removed_operation_ids: list[str]


# ── Helpers ─────────────────────────────────────────────

async def _get_operation(db: AsyncSession, operation_id: uuid.UUID, tenant_id: uuid.UUID) -> Operation:
    result = await db.execute(
        select(Operation).where(Operation.id == operation_id, Operation.tenant_id == tenant_id)
    )
    op = result.scalar_one_or_none()
    if not op:
        raise HTTPException(status_code=404, detail="Operation not found")
    return op


def _to_response(ae: ActualExecution) -> ActualResponse:
    return ActualResponse(
        id=str(ae.id),
        operation_id=str(ae.operation_id),
        status=ae.status,
        fact_start=ae.fact_start.isoformat() if ae.fact_start else None,
        fact_end=ae.fact_end.isoformat() if ae.fact_end else None,
        quantity_completed=float(ae.quantity_completed) if ae.quantity_completed else None,
        quantity_defect=float(ae.quantity_defect) if ae.quantity_defect else None,
        deviation_reason=ae.deviation_reason,
        comment=ae.comment,
        source=ae.source,
        recorded_at=ae.recorded_at.isoformat() if ae.recorded_at else None,
        updated_at=ae.updated_at.isoformat() if ae.updated_at else None,
        edit_count=ae.edit_count,
    )


# ── GET actual by operation ──────────────────────────────

@router.get("/operations/{operation_id}/actual", response_model=Optional[ActualResponse])
async def get_actual(operation_id: uuid.UUID, db: AsyncSession = Depends(get_db), tenant_id: uuid.UUID = Depends(get_current_tenant_id)):
    await _get_operation(db, operation_id, tenant_id)
    result = await db.execute(
        select(ActualExecution).where(ActualExecution.operation_id == operation_id)
    )
    ae = result.scalar_one_or_none()
    return _to_response(ae) if ae else None


# ── PUT save actual ──────────────────────────────────────

@router.put("/operations/{operation_id}/actual", response_model=ActualResponse)
async def save_actual(operation_id: uuid.UUID, req: ActualSaveRequest, db: AsyncSession = Depends(get_db), tenant_id: uuid.UUID = Depends(get_current_tenant_id)):
    op = await _get_operation(db, operation_id, tenant_id)
    now = datetime.now(timezone.utc)

    # Find existing or create
    result = await db.execute(
        select(ActualExecution).where(ActualExecution.operation_id == operation_id)
    )
    ae = result.scalar_one_or_none()

    if ae:
        ae.status = req.status
        if req.fact_start:
            ae.fact_start = datetime.fromisoformat(req.fact_start)
        if req.fact_end:
            ae.fact_end = datetime.fromisoformat(req.fact_end)
        ae.quantity_completed = Decimal(str(req.quantity_completed)) if req.quantity_completed else None
        ae.quantity_defect = Decimal(str(req.quantity_defect)) if req.quantity_defect else None
        ae.deviation_reason = req.deviation_reason
        ae.comment = req.comment
        ae.source = req.source
        ae.edit_count = (ae.edit_count or 0) + 1
    else:
        ae = ActualExecution(
            operation_id=operation_id,
            status=req.status,
            fact_start=datetime.fromisoformat(req.fact_start) if req.fact_start else None,
            fact_end=datetime.fromisoformat(req.fact_end) if req.fact_end else None,
            quantity_completed=Decimal(str(req.quantity_completed)) if req.quantity_completed else None,
            quantity_defect=Decimal(str(req.quantity_defect)) if req.quantity_defect else None,
            deviation_reason=req.deviation_reason,
            comment=req.comment,
            source=req.source,
            edit_count=0,
        )
        db.add(ae)

    await db.commit()
    await db.refresh(ae)
    return _to_response(ae)


# ── AUTO-CLOSE predecessors ———————————————

@router.post("/operations/{operation_id}/auto-close", response_model=AutoCloseResponse)
async def auto_close_predecessors(operation_id: uuid.UUID, db: AsyncSession = Depends(get_db), tenant_id: uuid.UUID = Depends(get_current_tenant_id)):
    """Найти цепочку незакрытых операций от последней закрытой до target и закрыть плановыми данными."""
    target = await _get_operation(db, operation_id, tenant_id)

    # Build project-operation graph (scoped to tenant)
    result = await db.execute(
        select(Operation).where(
            Operation.project_id == target.project_id,
            Operation.tenant_id == tenant_id,
        ).order_by(Operation.position)
    )
    all_ops = list(result.scalars().all())

    # Load dependencies (only within tenant's operations)
    op_ids = [op.id for op in all_ops]
    dep_result = await db.execute(
        select(OperationDependency).where(
            OperationDependency.predecessor_id.in_(op_ids),
            OperationDependency.successor_id.in_(op_ids),
        )
    )
    deps = list(dep_result.scalars().all())

    # Build adjacency
    pred_of = {op.id: [] for op in all_ops}
    succ_of = {op.id: [] for op in all_ops}
    for d in deps:
        if d.successor_id in pred_of:
            pred_of[d.successor_id].append(d.predecessor_id)
        if d.predecessor_id in succ_of:
            succ_of[d.predecessor_id].append(d.successor_id)

    # Load existing actuals
    existing_actuals = await db.execute(
        select(ActualExecution).where(
            ActualExecution.operation_id.in_([op.id for op in all_ops])
        )
    )
    actual_map = {ae.operation_id: ae for ae in existing_actuals.scalars().all()}

    # Find topological order from start to target
    order_map = {op.id: op for op in all_ops}
    visited = set()
    path_ops: list[Operation] = []

    def dfs_forward(op_id):
        if op_id in visited:
            return
        visited.add(op_id)
        path_ops.append(order_map[op_id])
        if op_id == operation_id:
            return
        for succ_id in succ_of.get(op_id, []):
            dfs_forward(succ_id)

    # Start from nodes with no predecessors and DFS to target
    starts = [op.id for op in all_ops if not pred_of.get(op.id)]
    for sid in starts:
        dfs_forward(sid)
        if operation_id in visited:
            break

    # Fallback: if DFS didn't reach target (disconnected graph), use position order
    if operation_id not in visited:
        path_ops = sorted(all_ops, key=lambda o: o.position or 0)

    # Sort by position
    path_ops.sort(key=lambda o: o.position or 0)

    if not path_ops:
        return AutoCloseResponse(closed=0, closed_operation_ids=[])

    # Find last closed
    last_closed_idx = -1
    for i, op in enumerate(path_ops):
        if op.id in actual_map and actual_map[op.id].status == "completed":
            last_closed_idx = i

    if last_closed_idx >= len(path_ops) - 1:
        return AutoCloseResponse(closed=0, closed_operation_ids=[])

    # Collect candidates: between last_closed+1 and target (excluding)
    target_idx = next(i for i, op in enumerate(path_ops) if op.id == operation_id)
    candidates = []
    for i in range(last_closed_idx + 1, target_idx):
        op = path_ops[i]
        if op.id in actual_map:
            ae = actual_map[op.id]
            if ae.source == "manual":
                continue  # skip manually entered
        candidates.append(op)

    now = datetime.now(timezone.utc)
    closed_ids = []
    for op in candidates:
        ae = ActualExecution(
            operation_id=op.id,
            status="completed",
            fact_start=now if op.duration_base else None,
            fact_end=now if op.duration_base else None,
            source="auto_closed",
            edit_count=0,
        )
        db.add(ae)
        closed_ids.append(str(op.id))

    await db.commit()
    return AutoCloseResponse(closed=len(candidates), closed_operation_ids=closed_ids)


# ── UNCLOSE chain ———————————————

@router.post("/operations/{operation_id}/unclose", response_model=UncloseResponse)
async def unclose_chain(operation_id: uuid.UUID, db: AsyncSession = Depends(get_db), tenant_id: uuid.UUID = Depends(get_current_tenant_id)):
    """Отменить авто-закрытие от последней незакрытой до target."""
    target = await _get_operation(db, operation_id, tenant_id)
    actual_target = await db.execute(
        select(ActualExecution).where(ActualExecution.operation_id == operation_id)
    )
    ae_target = actual_target.scalar_one_or_none()
    if not ae_target:
        raise HTTPException(status_code=404, detail="No actual record for this operation")
    if ae_target.source == "manual":
        raise HTTPException(status_code=400, detail="Cannot auto-unclose a manual record")

    # Load all ops for this project (scoped to tenant)
    result = await db.execute(
        select(Operation).where(
            Operation.project_id == target.project_id,
            Operation.tenant_id == tenant_id,
        ).order_by(Operation.position)
    )
    all_ops = list(result.scalars().all())
    op_ids = [op.id for op in all_ops]

    # Load actuals
    actuals_result = await db.execute(
        select(ActualExecution).where(ActualExecution.operation_id.in_(op_ids))
    )
    actuals = list(actuals_result.scalars().all())
    actual_map = {ae.operation_id: ae for ae in actuals}

    # Build dependency graph (only within tenant's operations)
    dep_result = await db.execute(
        select(OperationDependency).where(
            OperationDependency.predecessor_id.in_(op_ids),
            OperationDependency.successor_id.in_(op_ids),
        )
    )
    deps = list(dep_result.scalars().all())
    pred_of = {op.id: [] for op in all_ops}
    for d in deps:
        if d.successor_id in pred_of:
            pred_of[d.successor_id].append(d.predecessor_id)

    # Find path in order
    order_map = {op.id: op for op in all_ops}
    path_ops: list[Operation] = []

    # Simple: walk from target backwards through predecessors
    def walk_back(op_id):
        if op_id not in order_map:
            return
        op = order_map[op_id]
        path_ops.append(op)
        for pred_id in pred_of.get(op_id, []):
            walk_back(pred_id)

    walk_back(operation_id)
    path_ops.sort(key=lambda o: o.position or 0)

    # Find last non-closed or manual
    removed_ids = []
    for op in reversed(path_ops):
        if op.id not in actual_map:
            continue
        ae = actual_map[op.id]
        if ae.source == "manual":
            continue
        if ae.source == "auto_closed":
            await db.execute(
                select(ActualExecution).where(ActualExecution.id == ae.id)
            )
            await db.delete(ae)
            removed_ids.append(str(op.id))

    # Remove target's record too
    await db.delete(ae_target)
    removed_ids.append(str(operation_id))

    await db.commit()
    return UncloseResponse(removed=len(removed_ids), removed_operation_ids=removed_ids)
