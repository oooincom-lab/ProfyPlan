"""Отчёт по загрузке ресурсов по периодам (неделям).

Считает спрос (часы операций из календарного расчёта проекта) и доступное
время недели, процент загрузки. Часы считаются в днях/часах/минутах.
"""
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_tenant_id
from app.models.project import Project
from app.services.capacity import format_duration

router = APIRouter(prefix="/v1/reports", tags=["reports"])


def _parse_dt(s) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s))
    except Exception:
        return None


@router.get("/resource-loading")
async def resource_loading(
    project_id: UUID,
    weeks: int = 8,
    tenant_id: UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    """Загрузка ресурсов проекта по неделям (спрос / доступное время / процент)."""
    proj = (await db.execute(
        select(Project).where(Project.id == project_id, Project.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not proj:
        raise HTTPException(404, "Проект не найден")

    from app.routers.calculations import run_schedule

    try:
        sc = await run_schedule(project_id, None, db, tenant_id)
    except HTTPException as e:
        raise HTTPException(status_code=400, detail=str(e.detail))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Не удалось рассчитать проект: {e}")

    nodes = sc.get("nodes") or []
    if not nodes:
        return {"project_id": str(project_id), "weeks": [], "totals": {"demand_hours": 0, "demand_text": "0 мин"}}

    starts = [x for x in (_parse_dt(n.get("start_datetime")) for n in nodes) if x]
    anchor = min(starts).date() if starts else date.today()
    # понедельник недели-начала
    anchor = anchor - timedelta(days=anchor.weekday())

    buckets = []
    for w in range(max(1, min(weeks, 26))):
        w0 = anchor + timedelta(days=7 * w)
        w1 = w0 + timedelta(days=7)
        buckets.append({"start": w0.isoformat(), "end": (w1 - timedelta(days=1)).isoformat(), "hours": 0.0, "ops": 0})

    for n in nodes:
        hpd = float(n.get("hours_per_day") or 8.0) or 8.0
        dur_h = float(n.get("duration_hours") or 0.0)
        s_dt = _parse_dt(n.get("start_datetime"))
        f_dt = _parse_dt(n.get("finish_datetime"))
        if not s_dt or not f_dt:
            continue
        total_span = max((f_dt - s_dt).total_seconds() / 3600.0, 0.01)
        # распределяем часы операции по неделям пропорционально перекрытию рабочего окна
        for b in buckets:
            b0 = datetime.fromisoformat(b["start"] + "T00:00")
            b1 = datetime.fromisoformat(b["end"] + "T23:59")
            ov0 = max(s_dt.replace(tzinfo=None), b0)
            ov1 = min(f_dt.replace(tzinfo=None), b1)
            if ov1 <= ov0:
                continue
            share = (ov1 - ov0).total_seconds() / 3600.0 / total_span
            b["hours"] += dur_h * share
            b["ops"] += 1

    out = []
    total_demand = 0.0
    for b in buckets:
        # доступное время недели: 5 рабочих дней × часы дня проекта (по умолчанию 8)
        avail = 5 * 8.0
        load = (b["hours"] / avail * 100.0) if avail > 0 else 0.0
        total_demand += b["hours"]
        out.append({
            "week_start": b["start"],
            "week_end": b["end"],
            "demand_hours": round(b["hours"], 2),
            "demand_text": format_duration(b["hours"] * 60, 8.0),
            "available_hours": avail,
            "load_percent": round(load, 1),
            "operations": b["ops"],
        })

    return {
        "project_id": str(project_id),
        "project_name": proj.name,
        "weeks": out,
        "totals": {
            "demand_hours": round(total_demand, 2),
            "demand_text": format_duration(total_demand * 60, 8.0),
            "peak_percent": max([x["load_percent"] for x in out], default=0.0),
        },
    }
