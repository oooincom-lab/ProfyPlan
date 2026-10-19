"""Сервис фиксации плана: снимок результата расчёта (09.10.2026).

Собирает пооперационный план проекта (операции с датами/длительностями) тем же
движком, что и «календарный график»: CPM в рабочих днях (app.services.cpm),
каскад календарей (ресурс → подразделение → проект) и перевод рабочих дней
в календарные даты (app.services.scheduling). Результат сохраняется объектом
«фиксация плана» — для передачи во внешние системы и сравнения версий.
"""
from __future__ import annotations

import math
import json
import uuid
from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Optional
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.calendar_exception import CalendarException
from app.models.department import Department
from app.models.operation import Operation, OperationDependency, OperationResource
from app.models.plan_snapshot import PlanSnapshot, PlanSnapshotRow
from app.models.production_order import ProductionOrder
from app.models.project import Project
from app.models.project_resource import ProjectResource
from app.models.resource import Resource
from app.models.routing import RoutingOperation
from app.models.work_schedule import WorkSchedule, WorkScheduleSlot
from app.services.cpm import calculate_cpm
from app.services.capacity import (
    DEFAULT_DAY_START,
    DEFAULT_WINDOW_HOURS,
    schedule_window,
    spread_work_hours,
)
from app.services.scheduling import (
    CalendarResolver,
    DEFAULT_HOURS_PER_DAY,
    normalize_to_hours,
    schedule_hours_per_day,
    working_day_index_to_date,
)


async def build_snapshot(
    db: AsyncSession,
    project: Project,
    tenant_id: UUID,
    user_id: Optional[UUID],
    name: str = "",
    comment: Optional[str] = None,
) -> PlanSnapshot:
    """Построить и сохранить фиксацию плана проекта (снимок на текущий момент)."""

    # ── Операции проекта (черновики исключаются — как в календарном графике) ──
    ops_result = await db.execute(
        select(Operation)
        .outerjoin(ProductionOrder, Operation.order_id == ProductionOrder.id)
        .where(
            Operation.project_id == project.id,
            Operation.tenant_id == tenant_id,
            or_(Operation.order_id.is_(None), ProductionOrder.status != "draft"),
        )
    )
    operations = ops_result.scalars().all()
    if len(operations) < 2:
        raise ValueError("Для фиксации плана нужно минимум 2 операции (не считая черновики)")

    deps_result = await db.execute(
        select(OperationDependency)
        .join(Operation, OperationDependency.predecessor_id == Operation.id)
        .where(Operation.project_id == project.id)
    )
    dependencies = deps_result.scalars().all()

    op_ids = [op.id for op in operations]

    # ── Ресурсы операций и их подразделения ──
    op_res_rows = await db.execute(
        select(OperationResource).where(OperationResource.operation_id.in_(op_ids))
    )
    op_resources: dict = defaultdict(list)
    for opres in op_res_rows.scalars().all():
        op_resources[opres.operation_id].append(opres)

    res_ids = {opres.resource_id for ors in op_resources.values() for opres in ors}
    resources: dict = {}
    if res_ids:
        res_rows = await db.execute(
            select(Resource).where(Resource.id.in_(res_ids), Resource.tenant_id == tenant_id)
        )
        resources = {r.id: r for r in res_rows.scalars().all()}

    dept_names: dict = {}
    dept_ids = {r.department_id for r in resources.values() if r.department_id}
    if dept_ids:
        dept_rows = await db.execute(select(Department).where(Department.id.in_(dept_ids)))
        dept_names = {d.id: d.name for d in dept_rows.scalars().all()}

    # Полный справочник подразделений (tenant): имя → (UUID, код) — для UID в снимке
    dept_full = await db.execute(select(Department).where(Department.tenant_id == tenant_id))
    dept_by_name: dict = {}
    for d in dept_full.scalars().all():
        if d.name and d.name not in dept_by_name:
            dept_by_name[d.name] = (d.id, getattr(d, "code", None))

    # ── Каскад графиков работы: ресурс → подразделение → проект ──
    override_sched: dict = {}
    if res_ids:
        pr_rows = await db.execute(
            select(ProjectResource).where(
                ProjectResource.project_id == project.id,
                ProjectResource.resource_id.in_(res_ids),
            )
        )
        for pr in pr_rows.scalars().all():
            if pr.schedule_id:
                override_sched[pr.resource_id] = pr.schedule_id

    dept_sched: dict = {}
    if dept_ids:
        dept_rows2 = await db.execute(select(Department).where(Department.id.in_(dept_ids)))
        dept_sched = {d.id: d.schedule_id for d in dept_rows2.scalars().all() if d.schedule_id}
    project_sched_id = project.schedule_id

    sched_ids = {r.schedule_id for r in resources.values() if r.schedule_id}
    sched_ids.update(override_sched.values())
    sched_ids.update(s for s in dept_sched.values() if s)
    if project_sched_id:
        sched_ids.add(project_sched_id)

    schedules: dict = {}
    slots_by_sched: dict = defaultdict(list)
    if sched_ids:
        sched_rows = await db.execute(
            select(WorkSchedule).where(WorkSchedule.id.in_(sched_ids), WorkSchedule.tenant_id == tenant_id)
        )
        schedules = {s.id: s for s in sched_rows.scalars().all()}
        slot_rows = await db.execute(
            select(WorkScheduleSlot).where(WorkScheduleSlot.schedule_id.in_(sched_ids))
        )
        for sl in slot_rows.scalars().all():
            slots_by_sched[sl.schedule_id].append(sl)

    def op_sched_id(op: Operation):
        ors = sorted(op_resources.get(op.id, []), key=lambda o: 0 if o.role == "primary" else 1)
        for opres in ors:
            r = resources.get(opres.resource_id)
            if r:
                sid = (
                    override_sched.get(r.id)
                    or r.schedule_id
                    or dept_sched.get(r.department_id)
                    or project_sched_id
                )
                if sid and sid in schedules:
                    return sid
        return None

    def op_hours_per_day(op: Operation) -> Decimal:
        sid = op_sched_id(op)
        if sid:
            return schedule_hours_per_day(schedules[sid], slots_by_sched[sid])
        return DEFAULT_HOURS_PER_DAY

    def op_day_window(op: Operation):
        sid = op_sched_id(op)
        if sid:
            return schedule_window(slots_by_sched[sid])
        return DEFAULT_DAY_START, DEFAULT_WINDOW_HOURS

    # ── CPM в рабочих днях ──
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
        ops_dicts.append(
            {
                "id": str(op.id),
                "name": op.name,
                "duration_base": float(days),
                "setup_time": 0.0,
                "teardown_time": 0.0,
            }
        )

    deps_dicts = []
    for dep in dependencies:
        lag_hours = normalize_to_hours(dep.lag_time, dep.lag_unit)
        lag_days = lag_hours / Decimal("8")
        deps_dicts.append(
            {
                "predecessor_id": str(dep.predecessor_id),
                "successor_id": str(dep.successor_id),
                "dependency_type": dep.dependency_type,
                "lag_time": float(lag_days),
            }
        )

    result = calculate_cpm(ops_dicts, deps_dicts)

    # ── Точка отсчёта и исключения доступности ──
    anchor = project.start_date.date() if project.start_date else date.today()

    def _interval(x):
        f = x.date_from.date() if hasattr(x.date_from, "date") else x.date_from
        t = x.date_to.date() if hasattr(x.date_to, "date") else x.date_to
        return (f, t)

    exc_intervals = []
    exc_rows = await db.execute(
        select(CalendarException).where(
            CalendarException.tenant_id == tenant_id,
            CalendarException.project_id == project.id,
            CalendarException.level == "project",
        )
    )
    for x in exc_rows.scalars().all():
        exc_intervals.append(_interval(x))
    if res_ids:
        res_exc_rows = await db.execute(
            select(CalendarException).where(
                CalendarException.tenant_id == tenant_id,
                CalendarException.level == "resource",
                CalendarException.resource_id.in_(res_ids),
            )
        )
        for x in res_exc_rows.scalars().all():
            exc_intervals.append(_interval(x))

    resolver = CalendarResolver(
        db, tenant_id, project.country_code or "RU", extra_exceptions=exc_intervals
    )

    # ── Заказы: код/наименование для строк снимка ──
    order_ids = {op.order_id for op in operations if getattr(op, "order_id", None)}
    orders_by_id: dict = {}
    if order_ids:
        o_rows = await db.execute(
            select(ProductionOrder).where(ProductionOrder.id.in_(order_ids))
        )
        orders_by_id = {o.id: o for o in o_rows.scalars().all()}

    # ── Подразделение операции: ведущий ресурс → любой ресурс → шаг маршрута-источника ──
    ro_dept_cache: dict = {}
    dept_cache: dict = {}

    manual_dept_cache: dict = {}

    async def resolve_dept(op: Operation):
        key = str(op.id)
        if key in dept_cache:
            return dept_cache[key]
        # Ручное значение (правка в окне заказа) — приоритетнее авто-правил
        if getattr(op, "department_id", None):
            did = str(op.department_id)
            if did not in manual_dept_cache:
                drow = await db.get(Department, op.department_id)
                manual_dept_cache[did] = drow.name if drow else None
            if manual_dept_cache.get(did):
                dept_cache[key] = manual_dept_cache[did]
                return dept_cache[key]
        ors = sorted(op_resources.get(op.id, []), key=lambda o: 0 if o.role == "primary" else 1)
        lead = resources.get(ors[0].resource_id) if ors else None
        nm = dept_names.get(getattr(lead, "department_id", None)) if lead else None
        if not nm:
            for opres in ors:
                r = resources.get(opres.resource_id)
                cand = dept_names.get(getattr(r, "department_id", None)) if r else None
                if cand:
                    nm = cand
                    break
        if not nm and getattr(op, "source_routing_id", None) and getattr(op, "source_step_seq", None):
            key2 = (str(op.source_routing_id), op.source_step_seq)
            if key2 not in ro_dept_cache:
                ro = (await db.execute(
                    select(RoutingOperation).where(
                        RoutingOperation.routing_id == op.source_routing_id,
                        RoutingOperation.sequence_number == op.source_step_seq,
                    ).limit(1)
                )).scalars().first()
                nm2 = None
                if ro is not None:
                    if getattr(ro, "department_id", None):
                        drow = await db.get(Department, ro.department_id)
                        nm2 = drow.name if drow else None
                    if not nm2 and getattr(ro, "department", None):
                        nm2 = (ro.department or "").strip() or None
                ro_dept_cache[key2] = nm2
            nm = ro_dept_cache.get(key2)
        dept_cache[key] = nm
        return nm

    # ── «Куда закупается»: материал → подразделения операций-потребителей ──
    mat_consumers: dict = {}
    order_dept: dict = {}
    for op in operations:
        if getattr(op, "order_id", None):
            nm0 = await resolve_dept(op)
            if nm0:
                od = order_dept.setdefault(str(op.order_id), Counter())
                od[nm0] += 1
        if (getattr(op, "operation_type", None) or "") == "procurement":
            continue
        raw = getattr(op, "input_materials", None)
        nm = await resolve_dept(op)
        if not raw or not nm:
            continue
        try:
            mats = json.loads(raw) if isinstance(raw, str) else raw
        except Exception:
            continue
        if not isinstance(mats, list):
            continue
        oid = str(getattr(op, "order_id", "") or "")
        for m in mats:
            name = ""
            if isinstance(m, dict):
                name = str(m.get("name") or "").strip().lower()
            elif isinstance(m, str):
                name = m.strip().lower()
            if name:
                mat_consumers.setdefault(name, []).append((oid, nm))

    # ── Данные строк снимка ──
    row_data: list[dict] = []
    missing_departments: list[str] = []
    for op in operations:
        nid = str(op.id)
        node = result.nodes.get(nid)
        if node is None:
            continue

        es_days = float(node.early_start)
        dur_days = float(node.total_duration)
        hpd_n = float(hpd_by_id.get(nid, 8.0)) or 8.0
        ds_h, win_h = win_by_id.get(nid) or (DEFAULT_DAY_START, DEFAULT_WINDOW_HOURS)
        di_s = int(math.floor(es_days))
        start_hour, di_e, end_hour = spread_work_hours(es_days, dur_days, hpd_n, win_h, ds_h)
        sd_dt = await working_day_index_to_date(resolver, anchor, max(di_s, 0))
        ed_dt = await working_day_index_to_date(resolver, anchor, max(di_e, 0))
        start_dt = (
            datetime.combine(sd_dt, time.min) + timedelta(hours=start_hour)
        ).replace(second=0, microsecond=0)
        end_dt = (
            datetime.combine(ed_dt, time.min) + timedelta(hours=end_hour)
        ).replace(second=0, microsecond=0)

        ors = sorted(op_resources.get(op.id, []), key=lambda o: 0 if o.role == "primary" else 1)
        lead_res = resources.get(ors[0].resource_id) if ors else None

        # Подразделение обязательно для передачи во внешние системы (1С).
        # Основа — resolve_dept; для закупок — «куда закупается» (потребитель материала).
        dept_name = await resolve_dept(op)
        if not dept_name and (getattr(op, "operation_type", None) or "") == "procurement":
            mat = (op.name.split(":", 1)[1] if ":" in (op.name or "") else (op.name or "")).strip().lower()
            pool = mat_consumers.get(mat) or []
            same = [d for oid, d in pool if oid == str(getattr(op, "order_id", "") or "")]
            use = same or [d for _, d in pool]
            if use:
                dept_name = Counter(use).most_common(1)[0][0]
        if not dept_name and getattr(op, "order_id", None):
            # Запасное правило: «куда закупается» ≈ подразделение заказа (самое частое среди его операций)
            od = order_dept.get(str(op.order_id))
            if od:
                dept_name = od.most_common(1)[0][0]
        if not dept_name:
            missing_departments.append(op.name)

        _dinfo = dept_by_name.get(dept_name) if dept_name else None
        dept_id_out = _dinfo[0] if _dinfo else None
        dept_code_out = _dinfo[1] if _dinfo else None
        res_id_out = ors[0].resource_id if ors else None
        res_ext_out = (getattr(lead_res, "ext_id", None) if lead_res else None)

        o = orders_by_id.get(getattr(op, "order_id", None))

        row_data.append(
            {
                "order_id": getattr(op, "order_id", None),
                "order_ext_id": (o.ext_id if o else None),
                "order_ext_uid": (getattr(o, "ext_uid", None) if o else None),
                "order_name": (o.specification_name if o else None),
                "operation_id": op.id,
                "operation_name": op.name,
                "operation_ext_id": getattr(op, "ext_id", None),
                "department_name": dept_name,
                "department_id": dept_id_out,
                "department_code": dept_code_out,
                "resource_name": (lead_res.name if lead_res else None),
                "resource_id": res_id_out,
                "resource_ext_id": res_ext_out,
                "start_date": sd_dt,
                "finish_date": ed_dt,
                "start_datetime": start_dt,
                "finish_datetime": end_dt,
                "duration_hours": Decimal(str(round(dur_days * hpd_n, 4))),
                "quantity": getattr(op, "output_quantity", None),
                "unit": None,
                "is_critical": bool(node.is_critical),
                "position": getattr(op, "position", None),
            }
        )

    if not row_data:
        raise ValueError("Не удалось построить строки плана: нет рассчитанных операций")

    # ── Отпечаток входных данных (одна логика с реестром запусков) ──
    from app.routers.calculation_runs import _fingerprint

    fingerprint = _fingerprint(operations, dependencies, project)

    # ── Сохранение ──
    snap = PlanSnapshot(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        project_id=project.id,
        name=(name or "Фиксация плана"),
        comment=comment,
        planning_logic=(getattr(project, "planning_logic", None) or "cpm"),
        data_fingerprint=fingerprint,
        start_anchor=anchor,
        rows_count=len(row_data),
        created_by=user_id,
    )
    db.add(snap)
    await db.flush()

    for rd in row_data:
        db.add(PlanSnapshotRow(id=uuid.uuid4(), snapshot_id=snap.id, **rd))

    await db.commit()
    return snap, missing_departments
