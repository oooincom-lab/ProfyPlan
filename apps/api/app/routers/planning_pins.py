"""Закрепления операций (маркеры), потоки и журнал сдвигов по группам."""
from typing import Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_tenant_id
from app.models.group_flow import GroupFlow, GroupFlowOperation
from app.models.group_shift_log import GroupShiftLog
from app.models.operation import Operation
from app.models.operation_pin import OperationPin
from app.models.resource import Resource
from app.schemas.operation_pin import (
    FlowCreate,
    FlowOut,
    FlowUpdate,
    PinCreate,
    PinOut,
    PinUpdate,
    ShiftLogOut,
)

router = APIRouter(prefix="/v1", tags=["pins"])


async def _log(db: AsyncSession, tenant_id: UUID, action: str, payload: dict,
               project_id: Optional[UUID] = None, group_id: Optional[UUID] = None,
               user_id: Optional[UUID] = None, note: Optional[str] = None) -> None:
    db.add(GroupShiftLog(
        id=uuid4(), tenant_id=tenant_id, project_id=project_id, group_id=group_id,
        action=action, payload=payload, author_user_id=user_id, note=note,
    ))


# ─────────────────────────── Закрепления (pins) ───────────────────────────

@router.get("/projects/{project_id}/pins", response_model=list[PinOut])
async def list_pins(
    project_id: UUID,
    group_id: Optional[UUID] = None,
    tenant_id: UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(OperationPin).where(
        OperationPin.tenant_id == tenant_id, OperationPin.project_id == project_id
    )
    if group_id:
        stmt = stmt.where(OperationPin.group_id == group_id)
    rows = (await db.execute(stmt)).scalars().all()

    op_ids = {p.operation_id for p in rows}
    res_ids = {p.resource_id for p in rows if p.resource_id}
    ops = {}
    if op_ids:
        ops = {o.id: o.name for o in (await db.execute(
            select(Operation).where(Operation.id.in_(op_ids))
        )).scalars().all()}
    res = {}
    if res_ids:
        res = {r.id: r.name for r in (await db.execute(
            select(Resource).where(Resource.id.in_(res_ids))
        )).scalars().all()}
    return [
        PinOut(
            id=p.id, project_id=p.project_id, operation_id=p.operation_id,
            operation_name=ops.get(p.operation_id), resource_id=p.resource_id,
            resource_name=res.get(p.resource_id) if p.resource_id else None,
            group_id=p.group_id, pin_type=p.pin_type, pin_at=p.pin_at,
            is_hard=p.is_hard, note=p.note,
        )
        for p in rows
    ]


@router.post("/pins", response_model=PinOut, status_code=201)
async def create_pin(
    body: PinCreate,
    tenant_id: UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    op = (await db.execute(
        select(Operation).where(Operation.id == body.operation_id, Operation.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not op:
        raise HTTPException(404, "Операция не найдена")
    pin = OperationPin(
        id=uuid4(), tenant_id=tenant_id, project_id=op.project_id,
        operation_id=body.operation_id, resource_id=body.resource_id,
        group_id=body.group_id, pin_type=body.pin_type, pin_at=body.pin_at,
        is_hard=body.is_hard, note=body.note,
    )
    db.add(pin)
    await _log(db, tenant_id, "pin", {
        "operation_id": str(body.operation_id), "pin_type": body.pin_type,
        "pin_at": body.pin_at.isoformat(), "resource_id": str(body.resource_id) if body.resource_id else None,
    }, project_id=op.project_id, group_id=body.group_id, note=body.note)
    await db.commit()
    await db.refresh(pin)
    return PinOut(id=pin.id, project_id=pin.project_id, operation_id=pin.operation_id,
                  operation_name=op.name, resource_id=pin.resource_id,
                  group_id=pin.group_id, pin_type=pin.pin_type, pin_at=pin.pin_at,
                  is_hard=pin.is_hard, note=pin.note)


@router.put("/pins/{pin_id}", response_model=PinOut)
async def update_pin(
    pin_id: UUID,
    body: PinUpdate,
    tenant_id: UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    pin = (await db.execute(
        select(OperationPin).where(OperationPin.id == pin_id, OperationPin.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not pin:
        raise HTTPException(404, "Закрепление не найдено")
    data = body.model_dump(exclude_unset=True)
    before = {"pin_type": pin.pin_type, "pin_at": pin.pin_at.isoformat(), "is_hard": pin.is_hard}
    for k, v in data.items():
        setattr(pin, k, v)
    await _log(db, tenant_id, "pin", {
        "operation_id": str(pin.operation_id), "before": before,
        "after": {"pin_type": pin.pin_type, "pin_at": pin.pin_at.isoformat(), "is_hard": pin.is_hard},
    }, project_id=pin.project_id, group_id=pin.group_id)
    await db.commit()
    await db.refresh(pin)
    return PinOut(id=pin.id, project_id=pin.project_id, operation_id=pin.operation_id,
                  resource_id=pin.resource_id, group_id=pin.group_id, pin_type=pin.pin_type,
                  pin_at=pin.pin_at, is_hard=pin.is_hard, note=pin.note)


@router.delete("/pins/{pin_id}", status_code=204)
async def delete_pin(
    pin_id: UUID,
    tenant_id: UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    pin = (await db.execute(
        select(OperationPin).where(OperationPin.id == pin_id, OperationPin.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not pin:
        raise HTTPException(404, "Закрепление не найдено")
    await _log(db, tenant_id, "unpin", {
        "operation_id": str(pin.operation_id), "pin_type": pin.pin_type, "pin_at": pin.pin_at.isoformat(),
    }, project_id=pin.project_id, group_id=pin.group_id)
    await db.delete(pin)
    await db.commit()


# ─────────────────────────── Потоки (участки) ───────────────────────────

@router.get("/groups/{group_id}/flows", response_model=list[FlowOut])
async def list_flows(
    group_id: UUID,
    tenant_id: UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    flows = (await db.execute(
        select(GroupFlow).where(GroupFlow.tenant_id == tenant_id, GroupFlow.group_id == group_id)
    )).scalars().all()
    ops = (await db.execute(
        select(GroupFlowOperation).where(GroupFlowOperation.flow_id.in_([f.id for f in flows] or [uuid4()]))
    )).scalars().all() if flows else []
    by_flow: dict = {}
    for x in ops:
        by_flow.setdefault(x.flow_id, []).append(x.operation_id)
    return [
        FlowOut(id=f.id, group_id=f.group_id, name=f.name, min_gap_days=f.min_gap_days,
                takt_days=f.takt_days, priority=f.priority, is_active=f.is_active,
                operations=by_flow.get(f.id, []))
        for f in flows
    ]


@router.post("/flows", response_model=FlowOut, status_code=201)
async def create_flow(
    body: FlowCreate,
    tenant_id: UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    flow = GroupFlow(id=uuid4(), tenant_id=tenant_id, group_id=body.group_id, name=body.name,
                     min_gap_days=body.min_gap_days, takt_days=body.takt_days, priority=body.priority)
    db.add(flow)
    await _log(db, tenant_id, "flow", {"flow_id": str(flow.id), "name": body.name, "op": "create"},
               group_id=body.group_id)
    await db.commit()
    await db.refresh(flow)
    return FlowOut(id=flow.id, group_id=flow.group_id, name=flow.name, min_gap_days=flow.min_gap_days,
                   takt_days=flow.takt_days, priority=flow.priority, is_active=flow.is_active, operations=[])


@router.put("/flows/{flow_id}", response_model=FlowOut)
async def update_flow(
    flow_id: UUID,
    body: FlowUpdate,
    tenant_id: UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    flow = (await db.execute(
        select(GroupFlow).where(GroupFlow.id == flow_id, GroupFlow.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not flow:
        raise HTTPException(404, "Поток не найден")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(flow, k, v)
    await db.commit()
    await db.refresh(flow)
    return FlowOut(id=flow.id, group_id=flow.group_id, name=flow.name, min_gap_days=flow.min_gap_days,
                   takt_days=flow.takt_days, priority=flow.priority, is_active=flow.is_active, operations=[])


@router.delete("/flows/{flow_id}", status_code=204)
async def delete_flow(
    flow_id: UUID,
    tenant_id: UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    flow = (await db.execute(
        select(GroupFlow).where(GroupFlow.id == flow_id, GroupFlow.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not flow:
        raise HTTPException(404, "Поток не найден")
    links = (await db.execute(select(GroupFlowOperation).where(GroupFlowOperation.flow_id == flow_id))).scalars().all()
    for x in links:
        await db.delete(x)
    await _log(db, tenant_id, "flow", {"flow_id": str(flow.id), "op": "delete"}, group_id=flow.group_id)
    await db.delete(flow)
    await db.commit()


@router.post("/flows/{flow_id}/operations", status_code=201)
async def attach_operation(
    flow_id: UUID,
    operation_id: UUID,
    tenant_id: UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    flow = (await db.execute(
        select(GroupFlow).where(GroupFlow.id == flow_id, GroupFlow.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not flow:
        raise HTTPException(404, "Поток не найден")
    op = (await db.execute(
        select(Operation).where(Operation.id == operation_id, Operation.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not op:
        raise HTTPException(404, "Операция не найдена")
    exists = (await db.execute(
        select(GroupFlowOperation).where(
            GroupFlowOperation.flow_id == flow_id, GroupFlowOperation.operation_id == operation_id
        )
    )).scalar_one_or_none()
    if not exists:
        db.add(GroupFlowOperation(id=uuid4(), tenant_id=tenant_id, flow_id=flow_id, operation_id=operation_id))
        await _log(db, tenant_id, "flow", {"flow_id": str(flow_id), "operation_id": str(operation_id), "op": "attach"},
                   project_id=op.project_id, group_id=flow.group_id)
        await db.commit()
    return {"ok": True}


@router.delete("/flows/{flow_id}/operations/{operation_id}", status_code=204)
async def detach_operation(
    flow_id: UUID,
    operation_id: UUID,
    tenant_id: UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    link = (await db.execute(
        select(GroupFlowOperation).where(
            GroupFlowOperation.flow_id == flow_id, GroupFlowOperation.operation_id == operation_id
        )
    )).scalar_one_or_none()
    if link:
        await db.delete(link)
        await _log(db, tenant_id, "flow", {"flow_id": str(flow_id), "operation_id": str(operation_id), "op": "detach"})
        await db.commit()


# ─────────────────────────── Журнал сдвигов ───────────────────────────

@router.get("/projects/{project_id}/shift-log", response_model=list[ShiftLogOut])
async def shift_log(
    project_id: UUID,
    limit: int = 50,
    tenant_id: UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(GroupShiftLog)
        .where(GroupShiftLog.tenant_id == tenant_id, GroupShiftLog.project_id == project_id)
        .order_by(GroupShiftLog.created_at.desc())
        .limit(max(1, min(limit, 200)))
    )).scalars().all()
    return [ShiftLogOut.model_validate(r) for r in rows]
