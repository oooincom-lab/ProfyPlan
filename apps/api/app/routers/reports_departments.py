"""Отчёт по загрузке подразделений: спрос (часы операций проекта) и доступное
время подразделения с учётом графика и числа задействованных ресурсов."""
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_tenant_id
from app.models.department import Department
from app.models.operation import Operation, OperationResource
from app.models.project import Project
from app.models.resource import Resource
from app.models.work_schedule import WorkSchedule, WorkScheduleSlot
from app.services.capacity import format_duration, schedule_window
from app.services.scheduling import schedule_hours_per_day

router = APIRouter(prefix="/v1/reports", tags=["reports"])


@router.get("/department-loading")
async def department_loading(
    project_id: UUID,
    tenant_id: UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    """Загрузка подразделений по проекту: спрос, доступное время, процент."""
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

    nodes = {n["id"]: n for n in (sc.get("nodes") or [])}
    if not nodes:
        return {"project_id": str(project_id), "departments": [], "totals": {"demand_hours": 0, "demand_text": "0 мин"}}

    ops = (await db.execute(
        select(Operation).where(Operation.project_id == project_id, Operation.tenant_id == tenant_id)
    )).scalars().all()
    op_ids = [o.id for o in ops]
    ors = []
    if op_ids:
        ors = (await db.execute(
            select(OperationResource).where(OperationResource.operation_id.in_(op_ids))
        )).scalars().all()
    res_ids = {x.resource_id for x in ors}
    resources = {}
    if res_ids:
        resources = {
            r.id: r
            for r in (await db.execute(
                select(Resource).where(Resource.id.in_(res_ids), Resource.tenant_id == tenant_id)
            )).scalars().all()
        }

    dept_ids = {r.department_id for r in resources.values() if r.department_id}
    depts = {}
    if dept_ids:
        depts = {
            d.id: d
            for d in (await db.execute(
                select(Department).where(Department.id.in_(dept_ids), Department.tenant_id == tenant_id)
            )).scalars().all()
        }

    # графики подразделений (часы в день)
    sched_ids = {d.schedule_id for d in depts.values() if d.schedule_id}
    scheds = {}
    slots_map = defaultdict(list)
    if sched_ids:
        scheds = {x.id: x for x in (await db.execute(select(WorkSchedule).where(WorkSchedule.id.in_(sched_ids)))).scalars().all()}
        for sl in (await db.execute(select(WorkScheduleSlot).where(WorkScheduleSlot.schedule_id.in_(sched_ids)))).scalars().all():
            slots_map[sl.schedule_id].append(sl)

    # распределение часов операций по подразделениям (ведущий ресурс операции)
    by_op_res = defaultdict(list)
    for x in ors:
        by_op_res[x.operation_id].append(x)

    demand = defaultdict(float)
    ops_by_dept = defaultdict(int)
    res_by_dept = defaultdict(set)
    for op in ops:
        node = nodes.get(str(op.id))
        if not node:
            continue
        hours = float(node.get("duration_hours") or 0.0)
        ors_op = sorted(by_op_res.get(op.id, []), key=lambda o: 0 if o.role == "primary" else 1)
        lead = None
        for x in ors_op:
            r = resources.get(x.resource_id)
            if r:
                lead = r
                break
        dept = depts.get(lead.department_id) if (lead and lead.department_id) else None
        key = dept.name if dept else "Без подразделения"
        demand[key] += hours
        ops_by_dept[key] += 1
        if lead:
            res_by_dept[key].add(str(lead.id))

    # период проекта (по расчёту)
    starts, finishes = [], []
    for n in nodes.values():
        try:
            if n.get("start_datetime"):
                starts.append(datetime.fromisoformat(n["start_datetime"]))
            if n.get("finish_datetime"):
                finishes.append(datetime.fromisoformat(n["finish_datetime"]))
        except Exception:
            pass
    period_days = 1
    if starts and finishes:
        span = (max(finishes) - min(starts)).days + 1
        period_days = max(span, 1)
    work_days = max(int(round(period_days * 5 / 7)), 1)  # приблизительно рабочих дней в периоде

    out = []
    total_demand = 0.0
    for name, hours in sorted(demand.items(), key=lambda x: -x[1]):
        dept = next((d for d in depts.values() if d.name == name), None)
        hpd = 8.0
        if dept and dept.schedule_id and scheds.get(dept.schedule_id) and slots_map.get(dept.schedule_id):
            hpd = float(schedule_hours_per_day(scheds[dept.schedule_id], slots_map[dept.schedule_id])) or 8.0
        lines = max(len(res_by_dept.get(name, set())), 1)
        capacity = work_days * hpd * lines
        load = (hours / capacity * 100.0) if capacity > 0 else 0.0
        total_demand += hours
        out.append({
            "department_id": str(dept.id) if dept else None,
            "department_name": name,
            "hours_per_day": hpd,
            "resource_count": lines,
            "operations": ops_by_dept.get(name, 0),
            "demand_hours": round(hours, 2),
            "demand_text": format_duration(hours * 60, hpd),
            "capacity_hours": round(capacity, 2),
            "capacity_text": format_duration(capacity * 60, hpd),
            "load_percent": round(load, 1),
            "period_work_days": work_days,
        })
    out.sort(key=lambda x: -x["load_percent"])

    return {
        "project_id": str(project_id),
        "project_name": proj.name,
        "departments": out,
        "totals": {
            "demand_hours": round(total_demand, 2),
            "demand_text": format_duration(total_demand * 60, 8.0),
            "peak_percent": max([x["load_percent"] for x in out], default=0.0),
        },
    }
