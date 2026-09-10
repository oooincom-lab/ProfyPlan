"""
Роутер планирования: запуск CPM-расчёта, проверка статуса, получение результата,
и календарное планирование (даты с учётом производственного календаря и графиков).
"""
import math
from collections import defaultdict
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_tenant_id
from app.models.operation import Operation, OperationDependency, OperationResource
from app.models.project import Project
from app.models.department import Department
from app.models.project_resource import ProjectResource
from app.models.resource import Resource
from app.models.resource_event import ResourceEvent
from app.models.work_schedule import WorkSchedule, WorkScheduleSlot
from app.services.cpm import CPMResult, calculate_cpm
from app.services.scheduling import (
    DEFAULT_HOURS_PER_DAY,
    CalendarResolver,
    normalize_to_hours,
    schedule_hours_per_day,
    working_day_index_to_date,
    date_to_working_day_index,
)

calculator_router = APIRouter(prefix="/v1/projects/{project_id}/calculate", tags=["calculations"])


# Порог предупреждения muri: форсаж дольше N рабочих дней — риск перегрузки
FORSAZH_MAX_WORKDAYS = 5


def format_duration(total_minutes: float, hours_per_day: float = 8.0) -> str:
    """Длительность в формате «N дн H ч M мин» (часы/минуты — остаток рабочего дня)."""
    tm = int(round(total_minutes))
    if tm <= 0:
        return "0 мин"
    day_min = max(int(round(hours_per_day * 60)), 1)
    d = tm // day_min
    rem = tm % day_min
    h = rem // 60
    mi = rem % 60
    parts = []
    if d:
        parts.append("%d дн" % d)
    if h:
        parts.append("%d ч" % h)
    if mi or not parts:
        parts.append("%d мин" % mi)
    return " ".join(parts)


def _capacity_factor(events, w0: datetime, w1: datetime):
    """Взвешенный множитель мощности по перекрытию событий с окном [w0, w1].

    Возвращает (m_eff, использованные события). multiplier=0 обнуляет мощность
    на своей доле; неперекрытые доли считаются нормой (×1.0).
    """
    total = (w1 - w0).total_seconds() / 60.0
    if total <= 0:
        return 1.0, []
    m = 1.0
    used = []
    for ev in events:
        mult = ev.capacity_multiplier
        if mult is None:
            continue
        a_ = max(ev.date_from, w0)
        b_ = min(ev.date_to, w1)
        if b_ <= a_:
            continue
        share = ((b_ - a_).total_seconds() / 60.0) / total
        m += share * (float(mult) - 1.0)
        used.append({
            "event_id": str(ev.id),
            "event_type": ev.event_type,
            "capacity_multiplier": float(mult),
            "share": round(share, 4),
            "reason": ev.reason,
        })
    return max(m, 0.0), used


@calculator_router.post("/cpm")
async def run_cpm(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """
    Запустить CPM-расчёт для проекта.
    Возвращает: критические операции, резервы, общую длительность.
    """
    # Проверка проекта
    proj = await db.execute(
        select(Project).where(Project.id == project_id, Project.tenant_id == tenant_id)
    )
    project = proj.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Проект не найден")

    # Загружаем операции
    ops_result = await db.execute(
        select(Operation).where(
            Operation.project_id == project_id,
            Operation.tenant_id == tenant_id,
        )
    )
    operations = ops_result.scalars().all()
    if len(operations) < 2:
        raise HTTPException(
            status_code=400,
            detail="Для расчёта CPM необходимо минимум 2 операции",
        )

    # Загружаем зависимости
    deps_result = await db.execute(
        select(OperationDependency).join(
            Operation, OperationDependency.predecessor_id == Operation.id
        ).where(Operation.project_id == project_id)
    )
    dependencies = deps_result.scalars().all()

    # Конвертируем в словари для движка
    ops_dicts = [
        {
            "id": str(op.id),
            "name": op.name,
            "duration_base": float(op.duration_base),
            "setup_time": float(op.setup_time),
            "teardown_time": float(op.teardown_time),
        }
        for op in operations
    ]
    deps_dicts = [
        {
            "predecessor_id": str(dep.predecessor_id),
            "successor_id": str(dep.successor_id),
            "dependency_type": dep.dependency_type,
            "lag_time": float(dep.lag_time),
        }
        for dep in dependencies
    ]

    # Расчёт
    try:
        result = calculate_cpm(ops_dicts, deps_dicts)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    # Формируем ответ
    nodes = []
    for nid, node in result.nodes.items():
        nodes.append({
            "id": nid,
            "name": node.name,
            "duration": float(node.total_duration),
            "duration_hours": round(float(node.total_duration), 4),
            "duration_minutes": int(round(float(node.total_duration) * 60)),
            "duration_text": format_duration(float(node.total_duration) * 60, 8.0),
            "early_start": float(node.early_start),
            "early_finish": float(node.early_finish),
            "late_start": float(node.late_start),
            "late_finish": float(node.late_finish),
            "total_float": float(node.total_float),
            "free_float": float(node.free_float),
            "is_critical": node.is_critical,
        })

    return {
        "project_id": str(project_id),
        "method": "CPM",
        "total_duration": float(result.total_duration),
        "critical_path": result.critical_path,
        "nodes": nodes,
        "node_count": len(nodes),
        "critical_count": len(result.critical_path),
    }


class ScheduleRequest(BaseModel):
    start_date: Optional[datetime] = None


@calculator_router.post("/schedule")
async def run_schedule(
    project_id: UUID,
    body: Optional[ScheduleRequest] = None,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """
    Календарное планирование: CPM в рабочих днях + даты с учётом
    производственного календаря страны и графиков работы ресурсов.

    body.start_date (опц.) — точка отсчёта; иначе project.start_date, иначе сегодня.
    """
    proj = await db.execute(
        select(Project).where(Project.id == project_id, Project.tenant_id == tenant_id)
    )
    project = proj.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Проект не найден")

    ops_result = await db.execute(
        select(Operation).where(
            Operation.project_id == project_id,
            Operation.tenant_id == tenant_id,
        )
    )
    operations = ops_result.scalars().all()
    if len(operations) < 2:
        raise HTTPException(status_code=400, detail="Для планирования необходимо минимум 2 операции")

    deps_result = await db.execute(
        select(OperationDependency).join(
            Operation, OperationDependency.predecessor_id == Operation.id
        ).where(Operation.project_id == project_id)
    )
    dependencies = deps_result.scalars().all()

    # Операции → ресурсы → графики
    op_ids = [op.id for op in operations]
    op_res_rows = await db.execute(
        select(OperationResource).where(OperationResource.operation_id.in_(op_ids))
    )
    op_resources: dict = defaultdict(list)
    for or_ in op_res_rows.scalars().all():
        op_resources[or_.operation_id].append(or_)

    res_ids = {or_.resource_id for ors in op_resources.values() for or_ in ors}
    resources: dict = {}
    if res_ids:
        res_rows = await db.execute(select(Resource).where(Resource.id.in_(res_ids), Resource.tenant_id == tenant_id))
        resources = {r.id: r for r in res_rows.scalars().all()}

    # Переопределение графика через регистр ProjectResource (override на проект)
    override_sched: dict = {}
    if res_ids:
        pr_rows = await db.execute(
            select(ProjectResource).where(
                ProjectResource.project_id == project_id,
                ProjectResource.resource_id.in_(res_ids),
            )
        )
        for pr in pr_rows.scalars().all():
            if pr.schedule_id:
                override_sched[pr.resource_id] = pr.schedule_id

    # Каскад календарей (v2.16): ресурс → подразделение → проект → default
    dept_sched: dict = {}
    project_sched_id = None
    dept_ids = {r.department_id for r in resources.values() if r.department_id}
    if dept_ids:
        dept_rows = await db.execute(select(Department).where(Department.id.in_(dept_ids)))
        dept_sched = {d.id: d.schedule_id for d in dept_rows.scalars().all() if d.schedule_id}
    if project.schedule_id:
        project_sched_id = project.schedule_id

    sched_ids = {r.schedule_id for r in resources.values() if r.schedule_id}
    sched_ids.update(override_sched.values())
    sched_ids.update(s for s in dept_sched.values() if s)
    if project_sched_id:
        sched_ids.add(project_sched_id)
    schedules: dict = {}
    slots_by_sched: dict = defaultdict(list)
    if sched_ids:
        sched_rows = await db.execute(select(WorkSchedule).where(WorkSchedule.id.in_(sched_ids), WorkSchedule.tenant_id == tenant_id))
        schedules = {s.id: s for s in sched_rows.scalars().all()}
        slot_rows = await db.execute(
            select(WorkScheduleSlot).where(WorkScheduleSlot.schedule_id.in_(sched_ids))
        )
        for sl in slot_rows.scalars().all():
            slots_by_sched[sl.schedule_id].append(sl)

    def op_hours_per_day(op: Operation) -> Decimal:
        ors = sorted(op_resources.get(op.id, []), key=lambda o: 0 if o.role == "primary" else 1)
        for or_ in ors:
            r = resources.get(or_.resource_id)
            if r:
                sched_id = override_sched.get(r.id) or r.schedule_id or dept_sched.get(r.department_id) or project_sched_id
                if sched_id and sched_id in schedules:
                    return schedule_hours_per_day(schedules[sched_id], slots_by_sched[sched_id])
        return DEFAULT_HOURS_PER_DAY

    # CPM в рабочих днях
    hpd_by_id: dict = {}
    ops_dicts = []
    for op in operations:
        hpd = op_hours_per_day(op)
        hpd_by_id[str(op.id)] = float(hpd)
        hours = (
            normalize_to_hours(op.duration_base, op.duration_unit)
            + normalize_to_hours(op.setup_time, op.duration_unit)
            + normalize_to_hours(op.teardown_time, op.duration_unit)
        )
        days = hours / hpd if hpd > 0 else hours
        ops_dicts.append({
            "id": str(op.id),
            "name": op.name,
            "duration_base": float(days),
            "setup_time": 0.0,
            "teardown_time": 0.0,
        })

    deps_dicts = []
    for dep in dependencies:
        lag_hours = normalize_to_hours(dep.lag_time, dep.lag_unit)
        lag_days = lag_hours / Decimal("8")
        deps_dicts.append({
            "predecessor_id": str(dep.predecessor_id),
            "successor_id": str(dep.successor_id),
            "dependency_type": dep.dependency_type,
            "lag_time": float(lag_days),
        })

    try:
        result = calculate_cpm(ops_dicts, deps_dicts)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    # Точка отсчёта
    anchor_dt = (body.start_date if body else None) or project.start_date
    anchor = anchor_dt.date() if anchor_dt else date.today()
    # Исключения доступности (ремонт/простой/форс-мажор) — вырезаются из расчёта дат.
    # Уровни: project (весь проект), resource (ресурсы проекта), department (подразделения ресурсов).
    exc_intervals = []
    from app.models.calendar_exception import CalendarException as _CE

    def _interval(x):
        f = x.date_from.date() if hasattr(x.date_from, 'date') else x.date_from
        t = x.date_to.date() if hasattr(x.date_to, 'date') else x.date_to
        return (f, t)

    exc_rows = await db.execute(
        select(_CE).where(_CE.tenant_id == tenant_id, _CE.project_id == project_id, _CE.level == "project")
    )
    for x in exc_rows.scalars().all():
        exc_intervals.append(_interval(x))

    if res_ids:
        res_exc_rows = await db.execute(
            select(_CE).where(
                _CE.tenant_id == tenant_id,
                _CE.level == "resource",
                _CE.resource_id.in_(res_ids),
            )
        )
        for x in res_exc_rows.scalars().all():
            exc_intervals.append(_interval(x))

    if dept_ids:
        dept_exc_rows = await db.execute(
            select(_CE).where(
                _CE.tenant_id == tenant_id,
                _CE.level == "department",
                _CE.department_id.in_(dept_ids),
            )
        )
        for x in dept_exc_rows.scalars().all():
            exc_intervals.append(_interval(x))

    resolver = CalendarResolver(db, tenant_id, project.country_code or "RU", extra_exceptions=exc_intervals)

    # --- построение узлов (даты/время по календарю, длительность Д+Ч+М) ---
    async def build_nodes(res):
        out = []
        meta = {}
        for nid, node in res.nodes.items():
            es_days = node.early_start
            ef_days = node.early_finish
            ls_days = node.late_start
            lf_days = node.late_finish
            start_idx = int(math.floor(float(es_days)))
            finish_idx = int(math.ceil(float(ef_days)) - 1) if ef_days > 0 else 0
            ls_idx = int(math.floor(float(ls_days)))
            lf_idx = int(math.ceil(float(lf_days)) - 1) if lf_days > 0 else 0
            s_date = await working_day_index_to_date(resolver, anchor, max(start_idx, 0))
            f_date = await working_day_index_to_date(resolver, anchor, max(finish_idx, 0))
            ls_date = await working_day_index_to_date(resolver, anchor, max(ls_idx, 0))
            lf_date = await working_day_index_to_date(resolver, anchor, max(lf_idx, 0))
            # Точность до минут: остаток рабочего дня переводим в часы/минуты
            hpd_n = float(hpd_by_id.get(nid, 8.0)) or 8.0
            dur_days = float(node.total_duration)
            start_abs = float(es_days)
            end_abs = start_abs + dur_days
            di_s, fr_s = int(math.floor(start_abs)), start_abs - math.floor(start_abs)
            di_e, fr_e = int(math.floor(end_abs)), end_abs - math.floor(end_abs)
            sd_dt = await working_day_index_to_date(resolver, anchor, max(di_s, 0))
            ed_dt = await working_day_index_to_date(resolver, anchor, max(di_e, 0))
            start_dt = (datetime.combine(sd_dt, time.min) + timedelta(hours=fr_s * hpd_n)).replace(second=0, microsecond=0)
            end_dt = (datetime.combine(ed_dt, time.min) + timedelta(hours=fr_e * hpd_n)).replace(second=0, microsecond=0)
            dur_min = dur_days * hpd_n * 60.0
            meta[nid] = {"start": s_date, "finish": f_date}
            out.append({
                "id": nid,
                "name": node.name,
                "duration_days": dur_days,
                "duration_hours": round(dur_days * hpd_n, 4),
                "duration_minutes": int(round(dur_min)),
                "duration_text": format_duration(dur_min, hpd_n),
                "hours_per_day": hpd_by_id.get(nid, 8.0),
                "start_datetime": start_dt.isoformat(timespec="minutes"),
                "finish_datetime": end_dt.isoformat(timespec="minutes"),
                "early_start_day": float(es_days),
                "early_finish_day": float(ef_days),
                "early_start_date": s_date.isoformat(),
                "early_finish_date": f_date.isoformat(),
                "late_start_day": float(ls_days),
                "late_finish_day": float(lf_days),
                "late_start_date": ls_date.isoformat(),
                "late_finish_date": lf_date.isoformat(),
                "total_float_days": float(node.total_float),
                "is_critical": node.is_critical,
            })
        fin = await working_day_index_to_date(
            resolver, anchor, max(int(math.ceil(float(res.total_duration)) - 1), 0)
        )
        return out, fin, meta

    # ---- События мощности ресурсов (форсаж / ограничение / простой) ----
    def lead_resource(op: Operation):
        """Ведущий ресурс операции (primary, иначе первый) — его события влияют на длительность."""
        ors = sorted(op_resources.get(op.id, []), key=lambda o: 0 if o.role == "primary" else 1)
        for or_ in ors:
            r = resources.get(or_.resource_id)
            if r:
                return r
        return None

    events_by_res: dict = defaultdict(list)
    if res_ids:
        ev_rows = await db.execute(
            select(ResourceEvent).where(
                ResourceEvent.tenant_id == tenant_id,
                ResourceEvent.resource_id.in_(res_ids),
                ResourceEvent.is_active.is_(True),
            )
        )
        for ev in ev_rows.scalars().all():
            if ev.project_id is None or str(ev.project_id) == str(project_id):
                events_by_res[ev.resource_id].append(ev)

    warnings: list = []
    nodes, project_finish, node_dates = await build_nodes(result)

    factors: dict = {}
    ev_used: dict = {}
    for op in operations:
        r = lead_resource(op)
        if not r:
            continue
        evs = events_by_res.get(r.id) or []
        if not evs:
            continue
        d = node_dates.get(str(op.id))
        if not d:
            continue
        w0 = datetime.combine(d["start"], time.min)
        w1 = datetime.combine(d["finish"], time.max)
        m, used = _capacity_factor(evs, w0, w1)
        if not used or abs(m - 1.0) < 1e-9:
            continue
        factors[str(op.id)] = m
        ev_used[str(op.id)] = used
        if m <= 0:
            warnings.append({
                "type": "blocked",
                "operation_id": str(op.id),
                "operation_name": op.name,
                "resource_id": str(r.id),
                "resource_name": r.name,
                "message": "Операция «%s» попадает в простой ресурса «%s» (мощность 0) — срок невыполним" % (op.name, r.name),
            })

    # Второй проход: пересчёт длительностей с учётом эффективной мощности
    if any(m > 0 for m in factors.values()):
        ops_dicts2 = []
        for od in ops_dicts:
            m = factors.get(od["id"], 1.0)
            dur = od["duration_base"]
            if m > 0 and abs(m - 1.0) > 1e-9:
                dur = dur / m
            ops_dicts2.append({**od, "duration_base": dur})
        try:
            result = calculate_cpm(ops_dicts2, deps_dicts)
            nodes, project_finish, node_dates = await build_nodes(result)
        except ValueError:
            pass

    for n in nodes:
        m = factors.get(n["id"])
        n["capacity_multiplier"] = round(float(m), 4) if m else 1.0
        n["capacity_events"] = ev_used.get(n["id"], [])

    # muri: длительный форсаж (риск перегрузки)
    for rid, evs in events_by_res.items():
        for ev in evs:
            if ev.event_type != "boost" or ev.capacity_multiplier is None:
                continue
            i0 = await date_to_working_day_index(resolver, anchor, ev.date_from.date())
            i1 = await date_to_working_day_index(resolver, anchor, ev.date_to.date())
            days = i1 - i0 + 1
            if days > FORSAZH_MAX_WORKDAYS:
                r = resources.get(rid)
                warnings.append({
                    "type": "muri",
                    "resource_id": str(rid),
                    "resource_name": (r.name if r else ""),
                    "event_id": str(ev.id),
                    "days": days,
                    "message": "Форсаж «%s» длится %d раб. дн. (больше %d) — риск перегрузки (muri)" % ((r.name if r else ""), days, FORSAZH_MAX_WORKDAYS),
                })

    return {
        "project_id": str(project_id),
        "method": "SCHEDULE",
        "anchor": anchor.isoformat(),
        "country_code": project.country_code or "RU",
        "calendar_found": resolver.found,
        "total_duration_days": float(result.total_duration),
        "project_start_date": (await working_day_index_to_date(resolver, anchor, 0)).isoformat(),
        "project_finish_date": project_finish.isoformat(),
        "critical_path": result.critical_path,
        "nodes": nodes,
        "node_count": len(nodes),
        "warnings": warnings,
        "capacity_applied": bool(factors),
    }
