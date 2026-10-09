"""API фиксации плана: создание, список, просмотр, выгрузка (09.10.2026).

Выгрузка — для передачи плановых данных во внешние системы (1С и др.):
CSV (разделитель «;», UTF-8 с BOM — открывается в Excel) и JSON.
"""
from __future__ import annotations

import csv
import io
import json
import uuid
from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_tenant_id, get_current_user
from app.models.plan_snapshot import PlanSnapshot, PlanSnapshotRow
from app.models.project import Project
from app.models.tenant import User
from app.services.plan_snapshots import build_snapshot

router = APIRouter(prefix="/v1", tags=["plan-snapshots"])


class SnapshotCreateIn(BaseModel):
    name: Optional[str] = None
    comment: Optional[str] = None


class SnapshotOut(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    comment: Optional[str] = None
    planning_logic: str
    data_fingerprint: Optional[str] = None
    start_anchor: Optional[datetime] = None
    rows_count: int
    created_at: Optional[datetime] = None
    created_by: Optional[uuid.UUID] = None

    class Config:
        from_attributes = True


class SnapshotRowOut(BaseModel):
    id: uuid.UUID
    order_id: Optional[uuid.UUID] = None
    order_ext_id: Optional[str] = None
    order_name: Optional[str] = None
    operation_id: Optional[uuid.UUID] = None
    operation_name: str
    department_name: Optional[str] = None
    resource_name: Optional[str] = None
    start_date: Optional[datetime] = None
    finish_date: Optional[datetime] = None
    start_datetime: Optional[datetime] = None
    finish_datetime: Optional[datetime] = None
    duration_hours: Optional[float] = None
    quantity: Optional[float] = None
    unit: Optional[str] = None
    is_critical: bool = False
    position: Optional[int] = None

    class Config:
        from_attributes = True


class SnapshotListOut(BaseModel):
    items: list[SnapshotOut]


class SnapshotDetailOut(SnapshotOut):
    rows: list[SnapshotRowOut] = []


def _snapshot_or_404(snap: Optional[PlanSnapshot]) -> PlanSnapshot:
    if snap is None:
        raise HTTPException(status_code=404, detail="Фиксация плана не найдена")
    return snap


async def _get_project(db: AsyncSession, project_id: UUID, tenant_id: UUID) -> Project:
    res = await db.execute(
        select(Project).where(Project.id == project_id, Project.tenant_id == tenant_id)
    )
    project = res.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Проект не найден")
    return project


async def _get_snapshot(db: AsyncSession, snapshot_id: UUID, tenant_id: UUID) -> PlanSnapshot:
    res = await db.execute(
        select(PlanSnapshot).where(
            PlanSnapshot.id == snapshot_id, PlanSnapshot.tenant_id == tenant_id
        )
    )
    return _snapshot_or_404(res.scalar_one_or_none())


@router.post("/projects/{project_id}/plan-snapshots", response_model=SnapshotOut, status_code=201)
async def create_snapshot(
    project_id: UUID,
    body: Optional[SnapshotCreateIn] = None,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
    user: User = Depends(get_current_user),
):
    """Зафиксировать план проекта: снимок операций с датами и длительностями."""
    project = await _get_project(db, project_id, tenant_id)
    try:
        snap = await build_snapshot(
            db,
            project,
            tenant_id,
            getattr(user, "id", None),
            name=(body.name if body and body.name else ""),
            comment=(body.comment if body else None),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return snap


@router.get("/projects/{project_id}/plan-snapshots", response_model=SnapshotListOut)
async def list_snapshots(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """Список фиксаций плана проекта — от свежих к старым."""
    await _get_project(db, project_id, tenant_id)
    res = await db.execute(
        select(PlanSnapshot)
        .where(PlanSnapshot.tenant_id == tenant_id, PlanSnapshot.project_id == project_id)
        .order_by(PlanSnapshot.created_at.desc())
        .limit(100)
    )
    return {"items": res.scalars().all()}


@router.get("/plan-snapshots/{snapshot_id}", response_model=SnapshotDetailOut)
async def get_snapshot(
    snapshot_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """Фиксация с пооперационными строками."""
    snap = await _get_snapshot(db, snapshot_id, tenant_id)
    res = await db.execute(
        select(PlanSnapshotRow)
        .where(PlanSnapshotRow.snapshot_id == snap.id)
        .order_by(PlanSnapshotRow.order_ext_id.asc().nullsfirst(), PlanSnapshotRow.position.asc().nullsfirst())
    )
    rows = res.scalars().all()
    out = SnapshotDetailOut.model_validate(snap)
    out.rows = [SnapshotRowOut.model_validate(r) for r in rows]
    return out


@router.delete("/plan-snapshots/{snapshot_id}", status_code=204)
async def delete_snapshot(
    snapshot_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """Удалить фиксацию плана (строки удаляются каскадом)."""
    snap = await _get_snapshot(db, snapshot_id, tenant_id)
    await db.delete(snap)
    await db.commit()
    return Response(status_code=204)


def _fmt_dt(v) -> str:
    return v.strftime("%Y-%m-%d %H:%M") if v else ""


def _fmt_num(v) -> str:
    if v is None:
        return ""
    try:
        f = float(v)
    except Exception:
        return str(v)
    return ("%g" % f)


@router.get("/plan-snapshots/{snapshot_id}/export")
async def export_snapshot(
    snapshot_id: UUID,
    format: str = "csv",
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """Выгрузка фиксации: format=csv (для Excel/1С) или format=json."""
    snap = await _get_snapshot(db, snapshot_id, tenant_id)
    res = await db.execute(
        select(PlanSnapshotRow)
        .where(PlanSnapshotRow.snapshot_id == snap.id)
        .order_by(PlanSnapshotRow.order_ext_id.asc().nullsfirst(), PlanSnapshotRow.position.asc().nullsfirst())
    )
    rows = res.scalars().all()

    if format == "json":
        payload = {
            "schema": "profyplan.plan-snapshot.v1",
            "snapshot": {
                "id": str(snap.id),
                "name": snap.name,
                "project_id": str(snap.project_id),
                "planning_logic": snap.planning_logic,
                "data_fingerprint": snap.data_fingerprint,
                "start_anchor": snap.start_anchor.isoformat() if snap.start_anchor else None,
                "rows_count": snap.rows_count,
                "created_at": snap.created_at.isoformat() if snap.created_at else None,
            },
            "rows": [
                {
                    "order_ext_id": r.order_ext_id,
                    "order_name": r.order_name,
                    "operation_name": r.operation_name,
                    "department_name": r.department_name,
                    "resource_name": r.resource_name,
                    "start": r.start_datetime.isoformat() if r.start_datetime else None,
                    "finish": r.finish_datetime.isoformat() if r.finish_datetime else None,
                    "duration_hours": float(r.duration_hours) if r.duration_hours is not None else None,
                    "quantity": float(r.quantity) if r.quantity is not None else None,
                    "unit": r.unit,
                    "is_critical": bool(r.is_critical),
                }
                for r in rows
            ],
        }
        data = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        return Response(
            content=data,
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="plan-snapshot-{str(snap.id)[:8]}.json"'},
        )

    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";", lineterminator="\r\n")
    w.writerow(
        [
            "Код заказа",
            "Заказ",
            "Операция",
            "Подразделение",
            "Ресурс",
            "Начало",
            "Окончание",
            "Длительность, ч",
            "Количество",
            "Ед",
            "Критическая",
        ]
    )
    for r in rows:
        w.writerow(
            [
                r.order_ext_id or "",
                r.order_name or "",
                r.operation_name or "",
                r.department_name or "",
                r.resource_name or "",
                _fmt_dt(r.start_datetime),
                _fmt_dt(r.finish_datetime),
                _fmt_num(r.duration_hours),
                _fmt_num(r.quantity),
                r.unit or "",
                ("да" if r.is_critical else ""),
            ]
        )
    data = ("\ufeff" + buf.getvalue()).encode("utf-8")
    return Response(
        content=data,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="plan-snapshot-{str(snap.id)[:8]}.csv"'},
    )
