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
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_tenant_id
from app.models.operation import Operation, OperationDependency, OperationResource
from app.models.project import Project
from app.models.production_order import ProductionOrder
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


def _hours_text(hours) -> str:
    """Д6: срок в днях и часах вместо «899.8 ч»."""
    if hours is None:
        return "—"
    if hours >= 24:
        d = int(hours // 24)
        h = round(hours - d * 24, 1)
        return ("%d дн" % d) + (" %s ч" % str(h).replace(".", ",") if h else "")
    return str(round(hours, 1)).replace(".", ",") + " ч"


def _shift_plural(n: int) -> str:
    """Д5: «1 операция сдвинута» вместо «1 операций сдвинуты»."""
    if n % 10 == 1 and n % 100 != 11:
        return "%d операция сдвинута" % n
    if n % 10 in (2, 3, 4) and n % 100 not in (12, 13, 14):
        return "%d операции сдвинуты" % n
    return "%d операций сдвинуты" % n


class ScheduleRequest(BaseModel):
    start_date: Optional[datetime] = None
    # «Что если» по мощности (шаг 2.9): множитель мощности всех ресурсов; 1.0 — обычный расчёт.
    # Не сохраняется — только прикидка сценария.
    power_factor: float = 1.0
    # Авто-перевод заказов в «Завершён», если расчётный финиш уже прошёл (по умолчанию включён интерфейсом).
    auto_complete: bool = False


class CpmRequest(BaseModel):
    """Параметры CPM-расчёта (тело запроса необязательно)."""
    # Авто-перевод заказов в «Завершён», если расчётный финиш уже прошёл.
    auto_complete: bool = False


@calculator_router.post("/cpm")
async def run_cpm(
    project_id: UUID,
    body: Optional[CpmRequest] = None,
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
        select(Operation)
        .outerjoin(ProductionOrder, Operation.order_id == ProductionOrder.id)
        .where(
            Operation.project_id == project_id,
            Operation.tenant_id == tenant_id,
            or_(Operation.order_id.is_(None), ProductionOrder.status != "draft"),
        )
    )
    operations = ops_result.scalars().all()
    if len(operations) < 2:
        _total = (await db.execute(
            select(func.count()).select_from(Operation).where(
                Operation.project_id == project_id,
                Operation.tenant_id == tenant_id,
            )
        )).scalar() or 0
        if _total >= 2:
            raise HTTPException(
                status_code=400,
                detail="Все операции проекта в заказах-черновиках. Черновики исключаются из расчёта — переведите заказ в «В работе».",
            )
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
    for opres in or_rows_cpm.scalars().all():
        op_res_cpm[opres.operation_id].append(opres)
    res_ids_cpm = {opres.resource_id for ors in op_res_cpm.values() for opres in ors}
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
        for opres in ors:
            r0 = res_map_cpm.get(opres.resource_id)
            if r0 and r0.schedule_id and slots_map_cpm.get(r0.schedule_id):
                return schedule_window(slots_map_cpm[r0.schedule_id])
        return DEFAULT_DAY_START, DEFAULT_WINDOW_HOURS

    def hpd_for_op_cpm(op: Operation) -> float:
        """Рабочих часов в день по графику ресурса (для перевода часов в дни)."""
        ors = sorted(op_res_cpm.get(op.id, []), key=lambda o: 0 if o.role == "primary" else 1)
        for opres in ors:
            r0 = res_map_cpm.get(opres.resource_id)
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
    if ev_map_cpm or share_cpm or quota_map_cpm:
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
            for opres in ors_cpm:
                if res_map_cpm.get(opres.resource_id):
                    lead_cpm = res_map_cpm[opres.resource_id]
                    break
            m_final_cpm, used_all_cpm = 1.0, []
            blocked_cpm = None
            share_lead_cpm = 1.0
            if lead_cpm:
                share_lead_cpm = float(share_cpm.get(lead_cpm.id, 1.0) or 0.0) * quota_of_cpm(lead_cpm)
                if ev_map_cpm.get(lead_cpm.id):
                    m1, u1 = day_factor(ev_map_cpm[lead_cpm.id], wins_cpm, abs_base=(float(lead_cpm.capacity_per_unit) if lead_cpm and getattr(lead_cpm, "capacity_per_unit", None) else None))
                    m_final_cpm = m1 * share_lead_cpm
                    if u1:
                        used_all_cpm = list(u1)
                    if m1 <= 0 or share_lead_cpm <= 0:
                        blocked_cpm = lead_cpm
                else:
                    m_final_cpm = share_lead_cpm
                    if share_lead_cpm <= 0:
                        blocked_cpm = lead_cpm
            for opres in ors_cpm:
                r2 = res_map_cpm.get(opres.resource_id)
                if not r2 or (lead_cpm and r2.id == lead_cpm.id):
                    continue
                if not ev_map_cpm.get(r2.id):
                    continue
                m2, u2 = day_factor(ev_map_cpm[r2.id], wins_cpm, abs_base=(float(r2.capacity_per_unit) if getattr(r2, "capacity_per_unit", None) else None))
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

    # Авто-«Завершён»: заказ «В работе», чей расчётный финиш уже прошёл, переводится в «Завершён».
    if body is not None and getattr(body, "auto_complete", False):
        finish_by_order: dict = {}
        for _n in nodes:
            _oid = _n.get("order_id")
            _fin = _n.get("early_finish_date")
            if _oid and _fin:
                if isinstance(_fin, str):
                    try:
                        _fin = datetime.fromisoformat(_fin)
                    except ValueError:
                        continue
                _cur = finish_by_order.get(_oid)
                if _cur is None or _fin > _cur:
                    finish_by_order[_oid] = _fin
        _today = date.today()
        _done = [str(_oid) for _oid, _fin in finish_by_order.items() if _fin.date() <= _today]
        if _done:
            await db.execute(
                update(ProductionOrder).where(
                    ProductionOrder.id.in_([UUID(x) for x in _done]),
                    ProductionOrder.status == "planned",
                ).values(status="completed")
            )
            await db.commit()

    return {
        "project_id": str(project_id),
        "method": "CPM",
        "total_duration": float(result.total_duration),
        "critical_path": result.critical_path,
        # Критический путь как путь: упорядоченная цепочка. Ветвей может быть
        # несколько — отдаём их списком, а critical_path держит самую длинную.
        "critical_paths": [{"operations": ch, "names": [result.nodes[i].name for i in ch]} for ch in (result.critical_paths or [])],
        "critical_path_names": [result.nodes[i].name for i in result.critical_path],
        "nodes": nodes,
        "node_count": len(nodes),
        "critical_count": len(result.critical_path),
        "warnings": warnings_cpm,
        "capacity_applied": bool(factors_cpm),
    }


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
    body.power_factor (опц.) — «что если» по мощности: множитель для всех ресурсов.
    """
    proj = await db.execute(
        select(Project).where(Project.id == project_id, Project.tenant_id == tenant_id)
    )
    project = proj.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Проект не найден")

    # множитель «что если»: меняет только расчёт, в данные не пишется
    _power_factor = float(getattr(body, "power_factor", 1.0) or 1.0)
    if _power_factor <= 0:
        _power_factor = 1.0

    ops_result = await db.execute(
        select(Operation)
        .outerjoin(ProductionOrder, Operation.order_id == ProductionOrder.id)
        .where(
            Operation.project_id == project_id,
            Operation.tenant_id == tenant_id,
            or_(Operation.order_id.is_(None), ProductionOrder.status != "draft"),
        )
    )
    operations = ops_result.scalars().all()
    if len(operations) < 2:
        _total_ops = (await db.execute(select(func.count()).select_from(Operation).where(Operation.project_id == project_id, Operation.tenant_id == tenant_id))).scalar() or 0
        if _total_ops >= 2:
            raise HTTPException(status_code=400, detail="Все операции проекта в заказах-черновиках. Черновики исключаются из расчёта — переведите заказ в «В работе».")
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
    for opres in op_res_rows.scalars().all():
        op_resources[opres.operation_id].append(opres)

    res_ids = {opres.resource_id for ors in op_resources.values() for opres in ors}
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
        for opres in ors:
            r = resources.get(opres.resource_id)
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
    order_by_op: dict = {}   # Н3: чтобы узел знал свой заказ (для «общий ресурс» на шкале)
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
        order_by_op[str(op.id)] = str(op.order_id) if getattr(op, "order_id", None) else None

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
        for opres in ors:
            r = resources.get(opres.resource_id)
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
                m_lead, used_lead = day_factor(evs, wins, abs_base=(float(lead.capacity_per_unit) if lead and getattr(lead, "capacity_per_unit", None) else None))
                m_final = m_lead * share_lead
                if used_lead:
                    used_all = list(used_lead)
                if m_lead <= 0 or share_lead <= 0:
                    blocked_res = lead
            else:
                m_final = share_lead
                if share_lead <= 0:
                    blocked_res = lead
        for opres in op_resources.get(op.id, []):
            r2 = resources.get(opres.resource_id)
            if not r2 or (lead and r2.id == lead.id):
                continue
            evs2 = events_by_res.get(r2.id) or []
            if not evs2:
                continue
            m2, used2 = day_factor(evs2, wins, abs_base=(float(r2.capacity_per_unit) if getattr(r2, "capacity_per_unit", None) else None))
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

    # применяем множитель сценария «что если» ко всем операциям (в том числе без событий)
    if abs(_power_factor - 1.0) > 1e-9:
        for _od in ops_dicts:
            _b = float(factors.get(_od["id"], 1.0) or 1.0)
            factors[_od["id"]] = (_b * _power_factor) if _b > 0 else _b

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

    # ── Закрепления операций (пины, шаг 2.2): статические ограничения ──
    # Закреплённая операция не сдвигается ниже/позже заданной границы:
    # «начать не раньше»/«окно доступности» задают нижнюю границу старта,
    # «закончить к»/«закончить не позже» — верхнюю границу финиша.
    from app.models.operation_pin import OperationPin
    pin_rows = (await db.execute(
        select(OperationPin).where(
            OperationPin.tenant_id == tenant_id, OperationPin.project_id == project_id
        )
    )).scalars().all()

    pin_constraints: dict = {}
    pin_list: list = []
    for _p in pin_rows:
        # дата закрепления может попасть на нерабочий день — переносим на ближайший рабочий
        _d = _p.pin_at.date()
        _guard = 0
        try:
            while _guard < 90 and not await resolver.is_working(_d):
                _d = _d + timedelta(days=1)
                _guard += 1
        except Exception:
            pass
        try:
            _idx = await date_to_working_day_index(resolver, anchor, _d)
        except Exception:
            continue
        _ds_h, _win_h = win_by_id.get(str(_p.operation_id)) or (DEFAULT_DAY_START, DEFAULT_WINDOW_HOURS)
        _win_h = float(_win_h) or 8.0
        _hour = _p.pin_at.hour + _p.pin_at.minute / 60.0
        _frac = max((_hour - float(_ds_h)) / _win_h, 0.0)   # доля рабочего дня от начала смены
        _pos = float(_idx) + _frac
        _c = pin_constraints.setdefault(str(_p.operation_id), {})
        if _p.pin_type in ("start_not_earlier", "capacity_window"):
            _c["min_start"] = max(_c.get("min_start", 0.0), _pos)
        else:  # finish_at | finish_not_later
            _c["max_finish"] = min(_c.get("max_finish", 1e9), _pos)
        pin_list.append({
            "operation_id": str(_p.operation_id),
            "pin_type": _p.pin_type,
            "pin_at": _p.pin_at.isoformat(),
            "is_hard": _p.is_hard,
            "position_days": round(_pos, 3),
        })

    # ── Потоки (шаг 2.8): непрерывность ресурса, ритм и разрыв между фронтами ──
    # Операции потока упорядочиваются по плановому старту, и каждой следующей задаётся
    # нижняя граница старта: не раньше финиша предыдущей плюс разрыв, и не раньше ритма.
    from app.models.group_flow import GroupFlow, GroupFlowOperation
    from app.models.order_group import OrderGroup as _OG

    _cpm_nodes = getattr(result, "nodes", {}) or {}

    def _flow_days(_nid):
        _nd = _cpm_nodes.get(_nid) if isinstance(_cpm_nodes, dict) else None
        if not _nd:
            return None
        try:
            return (float(_nd.early_start), float(_nd.early_finish))
        except Exception:
            return None

    flow_rows = (await db.execute(
        select(GroupFlow).join(_OG, _OG.id == GroupFlow.group_id).where(
            _OG.project_id == project_id, GroupFlow.is_active.is_(True)
        )
    )).scalars().all()
    flow_list: list = []
    flow_warnings: list = []
    # позиции операций в календаре — считаем так же, как закрепления (индекс рабочего дня от якоря)
    _fin_map: dict = {}
    _start_map: dict = {}
    for _n in (nodes or []):
        try:
            _key = str(_n["id"]).lower()
            _fin_map[_key] = datetime.fromisoformat(str(_n.get("finish_datetime") or _n.get("start_datetime")))
            _start_map[_key] = datetime.fromisoformat(str(_n.get("start_datetime")))
        except Exception:
            continue

    async def _cal_pos(_op_id: str, _add_days: float):
        """Индекс рабочего дня (как у закреплений) для даты старта с учётом сдвига в днях."""
        _base = _start_map.get(str(_op_id).lower())
        if not _base:
            return None
        _d = _base + timedelta(days=int(round(_add_days)))
        _g = 0
        try:
            while _g < 90 and not await resolver.is_working(_d.date()):
                _d = _d + timedelta(days=1)
                _g += 1
        except Exception:
            pass
        try:
            _idx = await date_to_working_day_index(resolver, anchor, _d.date())
        except Exception:
            return None
        _ds_h, _win_h = win_by_id.get(_op_id) or (DEFAULT_DAY_START, DEFAULT_WINDOW_HOURS)
        _win_h = float(_win_h) or 8.0
        _frac = max((_d.hour + _d.minute / 60.0 - float(_ds_h)) / _win_h, 0.0)
        return float(_idx) + _frac
    # достижимость по технологическим связям — чтобы поток не разворачивал порядок и не создавал цикл
    _adj: dict = {}
    for _d in (deps_dicts or []):
        _adj.setdefault(str(_d.get("predecessor_id")), []).append(str(_d.get("successor_id")))

    def _reaches(_from, _to, _limit=5000):
        _seen = {_from}
        _stack = [_from]
        _n = 0
        while _stack and _n < _limit:
            _cur = _stack.pop()
            _n += 1
            if _cur == _to:
                return True
            for _nx in _adj.get(_cur, []):
                if _nx not in _seen:
                    _seen.add(_nx)
                    _stack.append(_nx)
        return False
    for _f in flow_rows:
        _op_ids = (await db.execute(
            select(GroupFlowOperation.operation_id).where(GroupFlowOperation.flow_id == _f.id)
        )).scalars().all()
        # ключи в нижнем регистре для сопоставления, но в ограничения пишем исходные идентификаторы
        _orig = {str(x).lower(): str(x) for x in _op_ids}
        _keys = [k for k in _orig.keys() if _start_map.get(k)]
        if len(_keys) < 2:
            continue
        # порядок цепи — как прикрепил планировщик (порядок привязки операций к потоку)
        _gap = float(_f.min_gap_days or 0)
        _takt = float(_f.takt_days or 0)
        _shifted = 0
        _conflicts = 0
        _cons_list: list = []
        for _ka, _kb in zip(_keys, _keys[1:]):
            _a, _b = _orig[_ka], _orig[_kb]
            _fin_a = _fin_map.get(_ka)
            if not _fin_a:
                continue
            _by_gap = None
            try:
                _d = _fin_a + timedelta(days=int(round(_gap)))
                _g = 0
                while _g < 90 and not await resolver.is_working(_d.date()):
                    _d = _d + timedelta(days=1)
                    _g += 1
                _idx = await date_to_working_day_index(resolver, anchor, _d.date())
                _ds_h, _win_h = win_by_id.get(_b) or (DEFAULT_DAY_START, DEFAULT_WINDOW_HOURS)
                _win_h = float(_win_h) or 8.0
                _frac = max((_d.hour + _d.minute / 60.0 - float(_ds_h)) / _win_h, 0.0)
                _by_gap = float(_idx) + _frac
            except Exception:
                _by_gap = None
            _by_takt = await _cal_pos(_a, _takt) if _takt > 0 else None
            _vals = [v for v in (_by_gap, _by_takt) if v is not None]
            if not _vals:
                continue
            _need = max(_vals)
            if _reaches(_b, _a):
                _conflicts += 1
                continue
            _c = pin_constraints.setdefault(_b, {})
            _prev = _c.get("min_start")
            _c["min_start"] = _need if _prev is None else max(float(_prev), _need)
            _was = None
            try:
                _was = await _cal_pos(_b, 0.0)
            except Exception:
                _was = None
            _cons_list.append({
                "operation_id": _b,
                "required_days": round(float(_need), 2),
                "was_days": round(float(_was), 2) if _was is not None else None,
                "bites": bool(_was is not None and _need > float(_was) + 1e-6),
            })
            if _was is not None and _need > float(_was) + 1e-6:
                _shifted += 1
        flow_list.append({
            "flow_id": str(_f.id),
            "name": _f.name,
            "operations": len(_keys),
            "min_gap_days": _gap,
            "takt_days": _takt or None,
            "priority": _f.priority,
            "shifted_operations": _shifted,
            "order_conflicts": _conflicts,
            "constraints": _cons_list,
        })
        if _shifted:
            flow_warnings.append({
                "type": "flow_shift",
                "message": ("Поток «%s»: %s — непрерывность ресурса важнее раннего старта"
                            % (_f.name, _shift_plural(_shifted))),
            })
        if _conflicts:
            flow_warnings.append({
                "type": "flow_conflict",
                "message": ("Поток «%s»: %d пар пропущены — технологический порядок требует обратного, "
                            "поток туда не навязываем" % (_f.name, _conflicts)),
            })
    if flow_list:
        warnings.extend(flow_warnings)

    pin_warnings: list = []
    if pin_constraints:
        ops_dicts_pin = []
        for od in ops_dicts:
            m = factors.get(od["id"], 1.0)
            dur = od["duration_base"]
            if m > 0 and abs(m - 1.0) > 1e-9:
                dur = dur / m
            ops_dicts_pin.append({**od, "duration_base": dur})
        try:
            result = calculate_cpm(ops_dicts_pin, deps_dicts, constraints=pin_constraints)
            nodes, project_finish, node_dates = await build_nodes(result)
        except ValueError:
            # ограничения по отдельности: пропускаем те, что конфликтуют с технологическим порядком
            _applied: dict = {}
            _dropped = 0
            _ok = False
            for _oid, _con in pin_constraints.items():
                _trial = {**_applied, _oid: _con}
                try:
                    _r = calculate_cpm(ops_dicts_pin, deps_dicts, constraints=_trial)
                except ValueError:
                    _dropped += 1
                    continue
                _applied = _trial
                result = _r
                _ok = True
            if _ok:
                nodes, project_finish, node_dates = await build_nodes(result)
            if _dropped:
                warnings.append({
                    "type": "constraints_skipped",
                    "message": ("%d ограничений (закрепления/потоки) пропущено — они конфликтуют "
                                "с технологическим порядком операций" % _dropped),
                })

    # Н3: узел получает идентификатор своего заказа — без этого «общий ресурс» на шкале
    # не отличим от «ресурс одного заказа» (клиент подставлял имя узла и помечал общими все строки)
    for _n in (nodes or []):
        _oid = order_by_op.get(str(_n.get("id")))
        if _oid:
            _n["order_id"] = _oid

    # Отметка закреплённых операций и проверка нарушений
    for n in nodes:
        _c = pin_constraints.get(n["id"])
        n["is_pinned"] = bool(_c)
        if _c:
            if _c.get("min_start") is not None:
                n["pin_min_start"] = round(float(_c["min_start"]), 3)
            if _c.get("max_finish") is not None:
                n["pin_max_finish"] = round(float(_c["max_finish"]), 3)

    _finish_types = ("finish_at", "finish_not_later")
    for _pl in pin_list:
        if _pl["pin_type"] not in _finish_types:
            continue
        _c = pin_constraints.get(_pl["operation_id"]) or {}
        _n = next((x for x in nodes if x["id"] == _pl["operation_id"]), None)
        if not _n:
            continue
        if _c.get("max_finish") is not None:
            _ef = float(_n.get("early_finish_day", 0.0))
            if _ef > float(_c["max_finish"]) + 1e-6:
                _delta = round((_ef - float(_c["max_finish"])) * float(hpd_by_id.get(_pl["operation_id"], 8.0) or 8.0), 1)
                pin_warnings.append({
                    "type": "pin_violation",
                    "operation_id": _pl["operation_id"],
                    "operation_name": _n.get("name"),
                    "pin_type": _pl["pin_type"],
                    "is_hard": _pl["is_hard"],
                    "message": ("Закрепление «%s» для «%s» нарушено на %s — операция не успевает к сроку"
                                % (_pl["pin_type"], _n.get("name"), _hours_text(_delta))),
                })

    warnings.extend(pin_warnings)

    # Индикатор «свобода плана»: доля незакреплённых операций
    _total_ops = len(nodes)
    _pinned_ops = sum(1 for n in nodes if n.get("is_pinned"))
    _freedom = round(100.0 * (_total_ops - _pinned_ops) / _total_ops, 1) if _total_ops else 100.0
    _threshold = 20.0
    try:
        from app.services.planning_settings import resolve_settings
        _st = await resolve_settings(db, tenant_id, project_id)
        _threshold = float((_st["values"].get("plan.freedom_threshold_percent") or {}).get("value") or 20)
    except Exception:
        pass
    if _total_ops and _freedom < _threshold:
        warnings.append({
            "type": "low_freedom",
            "message": ("Свобода плана %.1f%% (порог %.0f%%): почти все операции закреплены, автоматическая оптимизация почти не влияет"
                        % (_freedom, _threshold)),
        })
    plan_freedom = {
        "total_operations": _total_ops,
        "pinned_operations": _pinned_ops,
        "freedom_percent": _freedom,
        "threshold_percent": _threshold,
    }

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
                    "message": "Форсаж «%s» длится %d раб. дн. (больше %d) — риск перегрузки исполнителя: длительный форсаж" % ((r.name if r else ""), days, FORSAZH_MAX_WORKDAYS),
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
        "pins": pin_list,
        "flows": flow_list,
        "what_if": {"power_factor": _power_factor},
        "plan_freedom": plan_freedom,
    }
