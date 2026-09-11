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
from app.models.resource_department_quota import ResourceDepartmentQuota
from app.models.work_schedule import WorkSchedule, WorkScheduleSlot
from app.services.capacity import (
    DEFAULT_DAY_START,
    DEFAULT_WINDOW_HOURS,
    FORSAZH_MAX_WORKDAYS,
    day_factor,
    format_duration,
    op_day_windows,
    schedule_window,
    spread_work_hours,
)
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


# Логика эффективной мощности — в app/services/capacity.py (единая для всех расчётов)


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

    # ---- Учёт событий мощности ресурсов (форсаж / ограничение / простой) ----
    op_ids_cpm = [op.id for op in operations]
    or_rows_cpm = await db.execute(
        select(OperationResource).where(OperationResource.operation_id.in_(op_ids_cpm))
    )
    op_res_cpm: dict = defaultdict(list)
    for or_ in or_rows_cpm.scalars().all():
        op_res_cpm[or_.operation_id].append(or_)
    res_ids_cpm = {or_.resource_id for ors in op_res_cpm.values() for or_ in ors}
    res_map_cpm: dict = {}
    if res_ids_cpm:
        rr_cpm = await db.execute(
            select(Resource).where(Resource.id.in_(res_ids_cpm), Resource.tenant_id == tenant_id)
        )
        res_map_cpm = {r.id: r for r in rr_cpm.scalars().all()}

    # Графики работы ресурсов → рабочее окно дня (как в календарном расчёте)
    sched_ids_cpm = {r.schedule_id for r in res_map_cpm.values() if r.schedule_id}
    slots_map_cpm: dict = defaultdict(list)
    schedules_cpm: dict = {}
    if sched_ids_cpm:
        sch_cpm = await db.execute(
            select(WorkSchedule).where(WorkSchedule.id.in_(sched_ids_cpm), WorkSchedule.tenant_id == tenant_id)
        )
        schedules_cpm = {x.id: x for x in sch_cpm.scalars().all()}
        slr_cpm = await db.execute(
            select(WorkScheduleSlot).where(WorkScheduleSlot.schedule_id.in_(sched_ids_cpm))
        )
        for sl in slr_cpm.scalars().all():
            slots_map_cpm[sl.schedule_id].append(sl)

    def win_for_op_cpm(op: Operation):
        ors = sorted(op_res_cpm.get(op.id, []), key=lambda o: 0 if o.role == "primary" else 1)
        for or_ in ors:
            r0 = res_map_cpm.get(or_.resource_id)
            if r0 and r0.schedule_id and slots_map_cpm.get(r0.schedule_id):
                return schedule_window(slots_map_cpm[r0.schedule_id])
        return DEFAULT_DAY_START, DEFAULT_WINDOW_HOURS

    def hpd_for_op_cpm(op: Operation) -> float:
        """Рабочих часов в день по графику ресурса (для перевода часов в дни)."""
        ors = sorted(op_res_cpm.get(op.id, []), key=lambda o: 0 if o.role == "primary" else 1)
        for or_ in ors:
            r0 = res_map_cpm.get(or_.resource_id)
            if r0 and r0.schedule_id and slots_map_cpm.get(r0.schedule_id):
                sched0 = schedules_cpm.get(r0.schedule_id)
                if sched0:
                    return float(schedule_hours_per_day(sched0, slots_map_cpm[r0.schedule_id]))
        return 8.0

    ev_map_cpm: dict = defaultdict(list)
    if res_ids_cpm:
        evr_cpm = await db.execute(
            select(ResourceEvent).where(
                ResourceEvent.tenant_id == tenant_id,
                ResourceEvent.resource_id.in_(res_ids_cpm),
                ResourceEvent.is_active.is_(True),
            )
        )
        for ev in evr_cpm.scalars().all():
            if ev.project_id is None or str(ev.project_id) == str(project_id):
                ev_map_cpm[ev.resource_id].append(ev)

    # Квоты ресурсов по подразделениям (CPM)
    quota_map_cpm: dict = {}
    _dept_ids_cpm = {r.department_id for r in res_map_cpm.values() if getattr(r, "department_id", None)}
    if _dept_ids_cpm and res_ids_cpm:
        _q_rows_cpm = await db.execute(
            select(ResourceDepartmentQuota).where(
                ResourceDepartmentQuota.tenant_id == tenant_id,
                ResourceDepartmentQuota.department_id.in_(_dept_ids_cpm),
                ResourceDepartmentQuota.resource_id.in_(res_ids_cpm),
                ResourceDepartmentQuota.is_active.is_(True),
            )
        )
        for _q in _q_rows_cpm.scalars().all():
            try:
                quota_map_cpm[(_q.department_id, _q.resource_id)] = float(_q.quota_share)
            except Exception:
                pass

    def quota_of_cpm(r) -> float:
        if r is None or not getattr(r, "department_id", None):
            return 1.0
        return float(quota_map_cpm.get((r.department_id, r.id), 1.0))

    # Доля мощности ресурса в проекте (регистр ProjectResource)
    share_cpm: dict = {}
    if res_ids_cpm:
        pr_rows_cpm = await db.execute(
            select(ProjectResource).where(
                ProjectResource.project_id == project_id,
                ProjectResource.resource_id.in_(res_ids_cpm),
            )
        )
        for prc in pr_rows_cpm.scalars().all():
            try:
                _shc = float(prc.capacity_share) if prc.capacity_share is not None else 1.0
            except Exception:
                _shc = 1.0
            if abs(_shc - 1.0) > 1e-9:
                share_cpm[prc.resource_id] = _shc

    warnings_cpm: list = []
    factors_cpm: dict = {}
    ev_used_cpm: dict = {}
    if ev_map_cpm or share_cpm:
        anchor_cpm = project.start_date.date() if project.start_date else date.today()
        res_cpm = CalendarResolver(db, tenant_id, project.country_code or "RU")
        for op in operations:
            node_cpm = result.nodes.get(str(op.id))
            if not node_cpm:
                continue
            ds_cpm, win_cpm = win_for_op_cpm(op)
            hpd_cpm = hpd_for_op_cpm(op) or 8.0
            dur_days_cpm = float(node_cpm.total_duration) / hpd_cpm
            days_cpm = max(int(math.ceil(dur_days_cpm - 1e-9)), 1)

            class _NodeCpm:
                pass

            n_cpm = _NodeCpm()
            # в CPM время в часах → переводим старт в рабочие дни
            n_cpm.early_start = float(node_cpm.early_start) / hpd_cpm
            n_cpm.total_duration = days_cpm
            wins_cpm = await op_day_windows(n_cpm, win_cpm, ds_cpm, res_cpm, anchor_cpm)
            if not wins_cpm:
                continue
            ors_cpm = sorted(op_res_cpm.get(op.id, []), key=lambda o: 0 if o.role == "primary" else 1)
            lead_cpm = None
            for or_ in ors_cpm:
                if res_map_cpm.get(or_.resource_id):
                    lead_cpm = res_map_cpm[or_.resource_id]
                    break
            m_final_cpm, used_all_cpm = 1.0, []
            blocked_cpm = None
            share_lead_cpm = 1.0
            if lead_cpm:
                share_lead_cpm = float(share_cpm.get(lead_cpm.id, 1.0) or 0.0) * quota_of_cpm(lead_cpm)
                if ev_map_cpm.get(lead_cpm.id):
                    m1, u1 = day_factor(ev_map_cpm[lead_cpm.id], wins_cpm)
                    m_final_cpm = m1 * share_lead_cpm
                    if u1:
                        used_all_cpm = list(u1)
                    if m1 <= 0 or share_lead_cpm <= 0:
                        blocked_cpm = lead_cpm
                else:
                    m_final_cpm = share_lead_cpm
                    if share_lead_cpm <= 0:
                        blocked_cpm = lead_cpm
            for or_ in ors_cpm:
                r2 = res_map_cpm.get(or_.resource_id)
                if not r2 or (lead_cpm and r2.id == lead_cpm.id):
                    continue
                if not ev_map_cpm.get(r2.id):
                    continue
                m2, u2 = day_factor(ev_map_cpm[r2.id], wins_cpm)
                share2_cpm = float(share_cpm.get(r2.id, 1.0) or 0.0) * quota_of_cpm(r2)
                m2_total = m2 * share2_cpm
                if not u2 and abs(share2_cpm - 1.0) < 1e-9:
                    continue
                if (m2_total < 1.0 - 1e-9 or share2_cpm <= 0) and m2_total < m_final_cpm:
                    m_final_cpm = m2_total
                    if u2:
                        used_all_cpm = used_all_cpm + list(u2)
                elif u2:
                    used_all_cpm = used_all_cpm + list(u2)
                if (m2 <= 0 or share2_cpm <= 0) and blocked_cpm is None:
                    blocked_cpm = r2
            if abs(m_final_cpm - 1.0) < 1e-9:
                continue
            factors_cpm[str(op.id)] = m_final_cpm
            ev_used_cpm[str(op.id)] = used_all_cpm
            if m_final_cpm <= 0:
                br = blocked_cpm or lead_cpm
                warnings_cpm.append({
                    "type": "blocked",
                    "operation_id": str(op.id),
                    "operation_name": op.name,
                    "resource_id": str(br.id) if br else "",
                    "resource_name": br.name if br else "",
                    "message": "Операция «%s» попадает в простой ресурса «%s» (мощность 0) — срок невыполним" % (op.name, (br.name if br else "")),
                })

        # Пересчёт с учётом эффективной мощности
        if any(m > 0 for m in factors_cpm.values()):
            ops_cpm2 = []
            for od in ops_dicts:
                m = factors_cpm.get(od["id"], 1.0)
                dur = od["duration_base"]
                if m > 0 and abs(m - 1.0) > 1e-9:
                    dur = dur / m
                ops_cpm2.append({**od, "duration_base": dur})
            try:
                result = calculate_cpm(ops_cpm2, deps_dicts)
            except ValueError:
                pass

    # Формируем ответ
    nodes = []
    for nid, node in result.nodes.items():
        nodes.append({
            "id": nid,
            "name": node.name,
            "duration": float(node.total_duration),
            "capacity_multiplier": round(float(factors_cpm.get(nid, 1.0)), 4),
            "capacity_events": ev_used_cpm.get(nid, []),
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
        "warnings": warnings_cpm,
        "capacity_applied": bool(factors_cpm),
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
    share_by_res: dict = {}
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
            try:
                _sh = float(pr.capacity_share) if pr.capacity_share is not None else 1.0
            except Exception:
                _sh = 1.0
            if abs(_sh - 1.0) > 1e-9:
                share_by_res[pr.resource_id] = _sh

    # Каскад календарей (v2.16): ресурс → подразделение → проект → default
    dept_sched: dict = {}
    project_sched_id = None
    dept_ids = {r.department_id for r in resources.values() if r.department_id}
    if dept_ids:
        dept_rows = await db.execute(select(Department).where(Department.id.in_(dept_ids)))
        dept_sched = {d.id: d.schedule_id for d in dept_rows.scalars().all() if d.schedule_id}
    if project.schedule_id:
        project_sched_id = project.schedule_id

    # Квоты ресурсов по подразделениям: (подразделение, ресурс) → доля мощности
    quota_map: dict = {}
    _dept_ids_res = {r.department_id for r in resources.values() if r.department_id}
    if _dept_ids_res and res_ids:
        _q_rows = await db.execute(
            select(ResourceDepartmentQuota).where(
                ResourceDepartmentQuota.tenant_id == tenant_id,
                ResourceDepartmentQuota.department_id.in_(_dept_ids_res),
                ResourceDepartmentQuota.resource_id.in_(res_ids),
                ResourceDepartmentQuota.is_active.is_(True),
            )
        )
        for _q in _q_rows.scalars().all():
            try:
                quota_map[(_q.department_id, _q.resource_id)] = float(_q.quota_share)
            except Exception:
                pass

    def quota_of(r) -> float:
        if r is None or not getattr(r, "department_id", None):
            return 1.0
        return float(quota_map.get((r.department_id, r.id), 1.0))

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

    def op_sched_id(op: Operation):
        """График операции (по её ресурсам, с учётом переопределений на проект)."""
        ors = sorted(op_resources.get(op.id, []), key=lambda o: 0 if o.role == "primary" else 1)
        for or_ in ors:
            r = resources.get(or_.resource_id)
            if r:
                sched_id = override_sched.get(r.id) or r.schedule_id or dept_sched.get(r.department_id) or project_sched_id
                if sched_id and sched_id in schedules:
                    return sched_id
        return None

    def op_hours_per_day(op: Operation) -> Decimal:
        sid = op_sched_id(op)
        if sid:
            return schedule_hours_per_day(schedules[sid], slots_by_sched[sid])
        return DEFAULT_HOURS_PER_DAY

    def op_day_window(op: Operation):
        """(начало смены, длина рабочего окна в часах) из графика операции."""
        sid = op_sched_id(op)
        if sid:
            return schedule_window(slots_by_sched[sid])
        return DEFAULT_DAY_START, DEFAULT_WINDOW_HOURS

    # CPM в рабочих днях
    hpd_by_id: dict = {}
    win_by_id: dict = {}
    ops_dicts = []
    for op in operations:
        hpd = op_hours_per_day(op)
        hpd_by_id[str(op.id)] = float(hpd)
        win_by_id[str(op.id)] = op_day_window(op)
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
            # Точность до минут: рабочие часы раскладываются по рабочим дням
            # (окно дня — из графика работы: начало смены и её длительность)
            hpd_n = float(hpd_by_id.get(nid, 8.0)) or 8.0
            ds_h, win_h = win_by_id.get(nid) or (DEFAULT_DAY_START, DEFAULT_WINDOW_HOURS)
            dur_days = float(node.total_duration)
            di_s = int(math.floor(float(es_days)))
            start_hour, di_e, end_hour = spread_work_hours(float(es_days), dur_days, hpd_n, win_h, ds_h)
            sd_dt = await working_day_index_to_date(resolver, anchor, max(di_s, 0))
            ed_dt = await working_day_index_to_date(resolver, anchor, max(di_e, 0))
            start_dt = (datetime.combine(sd_dt, time.min) + timedelta(hours=start_hour)).replace(second=0, microsecond=0)
            end_dt = (datetime.combine(ed_dt, time.min) + timedelta(hours=end_hour)).replace(second=0, microsecond=0)
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
        node = result.nodes.get(str(op.id))
        if not node:
            continue
        ds_h, win_h = win_by_id.get(str(op.id)) or (DEFAULT_DAY_START, DEFAULT_WINDOW_HOURS)
        wins = await op_day_windows(node, win_h, ds_h, resolver, anchor)
        if not wins:
            continue
        # Ведущий ресурс задаёт форсаж/ограничение; ограничения (m<1) других
        # ресурсов операции учитываются как самое узкое звено.
        lead = lead_resource(op)
        m_final, used_all = 1.0, []
        blocked_res = None
        share_lead = 1.0
        if lead:
            share_lead = float(share_by_res.get(lead.id, 1.0) or 0.0) * quota_of(lead)
            evs = events_by_res.get(lead.id) or []
            if evs:
                m_lead, used_lead = day_factor(evs, wins)
                m_final = m_lead * share_lead
                if used_lead:
                    used_all = list(used_lead)
                if m_lead <= 0 or share_lead <= 0:
                    blocked_res = lead
            else:
                m_final = share_lead
                if share_lead <= 0:
                    blocked_res = lead
        for or_ in op_resources.get(op.id, []):
            r2 = resources.get(or_.resource_id)
            if not r2 or (lead and r2.id == lead.id):
                continue
            evs2 = events_by_res.get(r2.id) or []
            if not evs2:
                continue
            m2, used2 = day_factor(evs2, wins)
            share2 = float(share_by_res.get(r2.id, 1.0) or 0.0) * quota_of(r2)
            m2_total = m2 * share2
            if not used2 and abs(share2 - 1.0) < 1e-9:
                continue
            if m2_total < 1.0 - 1e-9 or share2 <= 0:
                if m2_total < m_final:
                    m_final = m2_total
                    if used2:
                        used_all = used_all + list(used2)
                elif used2:
                    used_all = used_all + list(used2)
                if m2 <= 0 or share2 <= 0:
                    blocked_res = r2
        if abs(m_final - 1.0) < 1e-9:
            continue
        factors[str(op.id)] = m_final
        ev_used[str(op.id)] = used_all
        if m_final <= 0:
            br = blocked_res or lead
            warnings.append({
                "type": "blocked",
                "operation_id": str(op.id),
                "operation_name": op.name,
                "resource_id": str(br.id) if br else "",
                "resource_name": br.name if br else "",
                "message": "Операция «%s» попадает в простой ресурса «%s» (мощность 0) — срок невыполним" % (op.name, (br.name if br else "")),
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
