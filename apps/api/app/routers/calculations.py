"""
Роутер планирования: запуск CPM-расчёта, проверка статуса, получение результата,
и календарное планирование (даты с учётом производственного календаря и графиков).
"""
import math
from collections import defaultdict
from datetime import date, datetime
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
from app.models.resource import Resource
from app.models.work_schedule import WorkSchedule, WorkScheduleSlot
from app.services.cpm import CPMResult, calculate_cpm
from app.services.scheduling import (
    DEFAULT_HOURS_PER_DAY,
    CalendarResolver,
    normalize_to_hours,
    schedule_hours_per_day,
    working_day_index_to_date,
)

calculator_router = APIRouter(prefix="/v1/projects/{project_id}/calculate", tags=["calculations"])


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
        res_rows = await db.execute(select(Resource).where(Resource.id.in_(res_ids)))
        resources = {r.id: r for r in res_rows.scalars().all()}

    sched_ids = {r.schedule_id for r in resources.values() if r.schedule_id}
    schedules: dict = {}
    slots_by_sched: dict = defaultdict(list)
    if sched_ids:
        sched_rows = await db.execute(select(WorkSchedule).where(WorkSchedule.id.in_(sched_ids)))
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
            if r and r.schedule_id and r.schedule_id in schedules:
                return schedule_hours_per_day(schedules[r.schedule_id], slots_by_sched[r.schedule_id])
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
    resolver = CalendarResolver(db, tenant_id, project.country_code or "RU")

    nodes = []
    for nid, node in result.nodes.items():
        es_days = node.early_start
        ef_days = node.early_finish
        start_idx = int(math.floor(float(es_days)))
        finish_idx = int(math.ceil(float(ef_days)) - 1) if ef_days > 0 else 0
        s_date = await working_day_index_to_date(resolver, anchor, max(start_idx, 0))
        f_date = await working_day_index_to_date(resolver, anchor, max(finish_idx, 0))
        nodes.append({
            "id": nid,
            "name": node.name,
            "duration_days": float(node.total_duration),
            "hours_per_day": hpd_by_id.get(nid, 8.0),
            "early_start_day": float(es_days),
            "early_finish_day": float(ef_days),
            "early_start_date": s_date.isoformat(),
            "early_finish_date": f_date.isoformat(),
            "total_float_days": float(node.total_float),
            "is_critical": node.is_critical,
        })

    project_finish = await working_day_index_to_date(
        resolver, anchor, max(int(math.ceil(float(result.total_duration)) - 1), 0)
    )

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
    }
