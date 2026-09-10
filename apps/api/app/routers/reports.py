"""
Отчёты по событиям мощности: потери (muda) и дополнительная выработка (muri)
в разрезе причин и ресурсов. Часы считаются по рабочим дням календаря и
окну рабочего дня из графика ресурса; формат — дни/часы/минуты.
"""
from collections import defaultdict
from datetime import date, datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_tenant_id
from app.models.project import Project
from app.models.resource import Resource
from app.models.resource_event import ResourceEvent
from app.models.work_schedule import WorkSchedule, WorkScheduleSlot
from app.services.capacity import event_work_hours, format_duration, loss_split, schedule_window
from app.services.scheduling import CalendarResolver, schedule_hours_per_day

router = APIRouter(prefix="/v1/reports", tags=["reports"])

TYPE_RU = {
    "boost": "Форсаж",
    "reduced": "Снижение мощности",
    "breakdown": "Простой/поломка",
    "maintenance": "ТО",
    "modernization": "Модернизация",
    "condition_change": "Изменение состояния",
    "other": "Прочее",
}


@router.get("/lost-hours")
async def lost_hours_report(
    project_id: Optional[UUID] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    include_global: bool = True,
    tenant_id: UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    """Отчёт «потери часов по причинам»: потери (muda) и выработка (muri)."""
    country = "RU"
    if project_id:
        pr = (await db.execute(
            select(Project).where(Project.id == project_id, Project.tenant_id == tenant_id)
        )).scalar_one_or_none()
        if not pr:
            raise HTTPException(404, "Проект не найден")
        country = pr.country_code or "RU"

    ev_stmt = select(ResourceEvent).where(
        ResourceEvent.tenant_id == tenant_id,
        ResourceEvent.is_active.is_(True),
    )
    if project_id:
        if include_global:
            ev_stmt = ev_stmt.where(
                (ResourceEvent.project_id == project_id) | (ResourceEvent.project_id.is_(None))
            )
        else:
            ev_stmt = ev_stmt.where(ResourceEvent.project_id == project_id)
    events = (await db.execute(ev_stmt)).scalars().all()
    if date_from:
        events = [e for e in events if e.date_to >= date_from]
    if date_to:
        events = [e for e in events if e.date_from <= date_to]

    res_ids = {e.resource_id for e in events}
    resources = {}
    if res_ids:
        resources = {
            r.id: r
            for r in (await db.execute(
                select(Resource).where(Resource.id.in_(res_ids), Resource.tenant_id == tenant_id)
            )).scalars().all()
        }

    sch_ids = {r.schedule_id for r in resources.values() if r.schedule_id}
    slots_map: dict = defaultdict(list)
    sched_map: dict = {}
    if sch_ids:
        sched_map = {
            x.id: x
            for x in (await db.execute(select(WorkSchedule).where(WorkSchedule.id.in_(sch_ids)))).scalars().all()
        }
        for sl in (await db.execute(
            select(WorkScheduleSlot).where(WorkScheduleSlot.schedule_id.in_(sch_ids))
        )).scalars().all():
            slots_map[sl.schedule_id].append(sl)

    resolver = CalendarResolver(db, tenant_id, country)

    by_reason: dict = defaultdict(lambda: {"lost": 0.0, "extra": 0.0, "events": 0, "types": set(), "resources": set()})
    by_res: dict = defaultdict(lambda: {"lost": 0.0, "extra": 0.0, "events": 0, "reasons": defaultdict(float)})
    rows = []

    for ev in events:
        r = resources.get(ev.resource_id)
        ds_h, win_h, hpd = 8.0, 8.0, 8.0
        if r and r.schedule_id and slots_map.get(r.schedule_id) and sched_map.get(r.schedule_id):
            ds_h, win_h = schedule_window(slots_map[r.schedule_id])
            hpd = float(schedule_hours_per_day(sched_map[r.schedule_id], slots_map[r.schedule_id]))
        try:
            wh = await event_work_hours(ev, resolver, hpd, ds_h, win_h)
        except Exception:
            continue
        sp = loss_split(ev.capacity_multiplier, wh["hours"])
        reason = (ev.reason or "—").strip()
        rname = r.name if r else ""
        m = float(ev.capacity_multiplier) if ev.capacity_multiplier is not None else None

        by_reason[reason]["lost"] += sp["lost_hours"]
        by_reason[reason]["extra"] += sp["extra_hours"]
        by_reason[reason]["events"] += 1
        by_reason[reason]["types"].add(ev.event_type)
        if rname:
            by_reason[reason]["resources"].add(rname)

        by_res[str(ev.resource_id)]["lost"] += sp["lost_hours"]
        by_res[str(ev.resource_id)]["extra"] += sp["extra_hours"]
        by_res[str(ev.resource_id)]["events"] += 1
        if sp["lost_hours"] > 0:
            by_res[str(ev.resource_id)]["reasons"][reason] += sp["lost_hours"]

        rows.append({
            "id": str(ev.id),
            "resource_id": str(ev.resource_id),
            "resource_name": rname,
            "event_type": ev.event_type,
            "event_type_ru": TYPE_RU.get(ev.event_type, ev.event_type),
            "capacity_multiplier": m,
            "reason": reason,
            "date_from": ev.date_from.isoformat(timespec="minutes") if hasattr(ev.date_from, "isoformat") else str(ev.date_from),
            "date_to": ev.date_to.isoformat(timespec="minutes") if hasattr(ev.date_to, "isoformat") else str(ev.date_to),
            "work_hours": wh["hours"],
            "work_text": format_duration(wh["hours"] * 60, hpd),
            "lost_hours": sp["lost_hours"],
            "lost_text": format_duration(sp["lost_hours"] * 60, hpd),
            "extra_hours": sp["extra_hours"],
            "extra_text": format_duration(sp["extra_hours"] * 60, hpd),
        })

    def _agg(container: dict, key_field: str):
        out = []
        for k, v in container.items():
            out.append({
                key_field: k,
                "lost_hours": round(v["lost"], 2),
                "lost_text": format_duration(v["lost"] * 60, 8.0),
                "extra_hours": round(v["extra"], 2),
                "extra_text": format_duration(v["extra"] * 60, 8.0),
                "events": v["events"],
            })
        out.sort(key=lambda x: -x["lost_hours"])
        return out

    reasons_out = _agg(by_reason, "reason")
    for item in reasons_out:
        v = by_reason[item["reason"]]
        item["types_ru"] = sorted(TYPE_RU.get(t, t) for t in v["types"])
        item["resources"] = sorted(v["resources"])

    resources_out = []
    for rid, v in by_res.items():
        r = resources.get(UUID(rid))
        resources_out.append({
            "resource_id": rid,
            "resource_name": r.name if r else "",
            "lost_hours": round(v["lost"], 2),
            "lost_text": format_duration(v["lost"] * 60, 8.0),
            "extra_hours": round(v["extra"], 2),
            "extra_text": format_duration(v["extra"] * 60, 8.0),
            "events": v["events"],
            "by_reason": [
                {"reason": k2, "lost_hours": round(v2, 2), "lost_text": format_duration(v2 * 60, 8.0)}
                for k2, v2 in sorted(v["reasons"].items(), key=lambda x: -x[1])
            ],
        })
    resources_out.sort(key=lambda x: -x["lost_hours"])

    total_lost = sum(x["lost_hours"] for x in rows)
    total_extra = sum(x["extra_hours"] for x in rows)

    rows.sort(key=lambda x: (-x["lost_hours"], x["date_from"]))
    return {
        "project_id": str(project_id) if project_id else None,
        "date_from": date_from.isoformat() if date_from else None,
        "date_to": date_to.isoformat() if date_to else None,
        "totals": {
            "lost_hours": round(total_lost, 2),
            "lost_text": format_duration(total_lost * 60, 8.0),
            "extra_hours": round(total_extra, 2),
            "extra_text": format_duration(total_extra * 60, 8.0),
            "events": len(rows),
        },
        "by_reason": reasons_out,
        "by_resource": resources_out,
        "events": rows,
    }
