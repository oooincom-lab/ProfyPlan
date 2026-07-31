"""
Resource Leveling: Serial SGS алгоритм выравнивания ресурсов.
"""
from dataclasses import dataclass
from decimal import Decimal
from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.operation import Operation, OperationDependency, OperationResource
from app.models.resource import Resource


@dataclass
class ScheduledOperation:
    """Операция после выравнивания ресурсов."""
    operation_id: UUID
    operation_name: str
    resource_id: Optional[UUID]
    resource_name: Optional[str]
    project_id: UUID
    planned_start: Decimal
    planned_end: Decimal
    duration: Decimal
    is_critical: bool
    total_float: Decimal
    predecessor_ids: list[UUID]
    batch_group: Optional[str] = None


@dataclass
class ResourceLevelResult:
    """Результат выравнивания ресурсов."""
    scheduled: list[ScheduledOperation]
    total_makespan: Decimal
    resource_utilization: dict[str, float]  # resource_name → % загрузки
    bottlenecks: list[str]  # ресурсы с загрузкой > 90%
    conflicts_resolved: int
    queue_lengths: dict[str, int]  # resource_name → очередь


async def resource_leveling_sgs(
    db: AsyncSession,
    project_id: UUID,
    tenant_id: UUID,
    cpm_result: Optional[dict] = None,
) -> ResourceLevelResult:
    """
    Serial Schedule Generation Scheme (SGS) — выравнивание ресурсов.

    Алгоритм:
    1. Приоритеты: LS asc, TF asc, -duration desc
    2. Для каждой операции: найти earliest time где ресурс свободен
    3. Пересчитать downstream-зависимости

    Args:
        db: асинхронная сессия БД
        project_id: ID проекта
        tenant_id: ID тенанта
        cpm_result: опциональный результат CPM-расчёта (с ES/EF/LS/LF/TF)

    Returns:
        ResourceLevelResult с выровненным расписанием
    """
    # 1. Загружаем операции с их связями ресурсов
    ops_result = await db.execute(
        select(Operation).where(
            Operation.project_id == project_id,
            Operation.tenant_id == tenant_id,
        )
    )
    operations = list(ops_result.scalars().all())

    # Загружаем зависимости
    deps_result = await db.execute(
        select(OperationDependency).where(
            OperationDependency.predecessor_id.in_(
                select(Operation.id).where(
                    Operation.project_id == project_id,
                    Operation.tenant_id == tenant_id,
                )
            )
        )
    )
    dependencies = list(deps_result.scalars().all())

    # Загружаем назначения ресурсов
    op_ids = [op.id for op in operations]
    res_assignments = {}
    if op_ids:
        res_result = await db.execute(
            select(OperationResource).where(
                OperationResource.operation_id.in_(op_ids)
            )
        )
        for ass in res_result.scalars().all():
            res_assignments.setdefault(ass.operation_id, []).append(ass)

    # Загружаем ресурсы
    resources_result = await db.execute(
        select(Resource).where(
            Resource.project_id == project_id,
            Resource.tenant_id == tenant_id,
        )
    )
    resources = {r.id: r for r in resources_result.scalars().all()}

    # 2. Строим списки предшественников/последователей
    predecessors: dict[UUID, list[UUID]] = {op.id: [] for op in operations}
    successors: dict[UUID, list[UUID]] = {op.id: [] for op in operations}

    for dep in dependencies:
        if dep.predecessor_id in predecessors and dep.successor_id in successors:
            successors[dep.predecessor_id].append(dep.successor_id)
            predecessors[dep.successor_id].append(dep.predecessor_id)

    # 3. Приоритизация операций для SGS
    # Сортируем по: LS asc → TF asc → -duration desc
    # Если CPM-результат не передан — используем duration как proxy
    op_priorities = []
    for op in operations:
        duration = float(op.duration_base)
        # Используем duration как proxy для LS если нет CPM
        ls = float(op.position or 0)
        tf = 0.0  # будет заполнено из cpm_result если доступен
        priority = (ls, tf, -duration)
        op_priorities.append((priority, op))

    op_priorities.sort(key=lambda x: x[0])

    # 4. Serial SGS — пооперационное размещение
    scheduled: dict[UUID, ScheduledOperation] = {}
    resource_free: dict[str, Decimal] = {}  # resource_name → время освобождения
    completed: dict[UUID, Decimal] = {}  # operation_id → время завершения (EF)
    started: dict[UUID, Decimal] = {}  # operation_id → время старта (ES)

    conflicts_resolved = 0

    for _, op in op_priorities:
        # Определяем ресурс(ы) операции
        op_resources = res_assignments.get(op.id, [])
        resource_name = None
        if op_resources:
            primary = [a for a in op_resources if a.role == "primary"]
            if primary:
                res = resources.get(primary[0].resource_id)
                resource_name = res.name if res else f"resource_{primary[0].resource_id}"
            else:
                res = resources.get(op_resources[0].resource_id)
                resource_name = res.name if res else None

        duration = float(op.duration_base) + float(op.setup_time) + float(op.teardown_time)

        # Earliest start = max(EF всех предшественников)
        est = Decimal("0")
        for pred_id in predecessors.get(op.id, []):
            if pred_id in completed:
                est = max(est, completed[pred_id])

        # Если операция использует ресурс — учесть занятость ресурса
        if resource_name:
            if resource_name in resource_free:
                if est < resource_free[resource_name]:
                    conflicts_resolved += 1
                est = max(est, resource_free[resource_name])

        start = est
        end = start + Decimal(str(duration))

        scheduled[op.id] = ScheduledOperation(
            operation_id=op.id,
            operation_name=op.name,
            resource_id=op_resources[0].resource_id if op_resources else None,
            resource_name=resource_name,
            project_id=project_id,
            planned_start=start,
            planned_end=end,
            duration=Decimal(str(duration)),
            is_critical=op.is_critical,
            total_float=Decimal("0"),
            predecessor_ids=[p for p in predecessors.get(op.id, [])],
        )

        started[op.id] = start
        completed[op.id] = end

        if resource_name:
            resource_free[resource_name] = end

    # 5. Расчёт загрузки ресурсов
    total_makespan = max(completed.values()) if completed else Decimal("0")
    resource_hours: dict[str, float] = {}
    resource_queues: dict[str, int] = {}

    for op_id, sched in scheduled.items():
        if sched.resource_name:
            resource_hours[sched.resource_name] = (
                resource_hours.get(sched.resource_name, 0)
                + float(sched.duration)
            )
            resource_queues.setdefault(sched.resource_name, 0)

    # Использование ресурсов
    utilization = {}
    bottlenecks = []
    for res_name, hours in resource_hours.items():
        if float(total_makespan) > 0:
            util = (hours / float(total_makespan)) * 100
        else:
            util = 0.0
        utilization[res_name] = round(util, 1)
        if util > 90:
            bottlenecks.append(res_name)

    return ResourceLevelResult(
        scheduled=list(scheduled.values()),
        total_makespan=total_makespan,
        resource_utilization=utilization,
        bottlenecks=bottlenecks,
        conflicts_resolved=conflicts_resolved,
        queue_lengths=resource_queues,
    )


def format_leveling_result(result: ResourceLevelResult) -> dict:
    """Форматирует ResourceLevelResult в JSON-ответ."""
    return {
        "method": "Resource Leveling (Serial SGS)",
        "total_makespan_hours": float(result.total_makespan),
        "conflicts_resolved": result.conflicts_resolved,
        "operation_count": len(result.scheduled),
        "resource_utilization": result.resource_utilization,
        "bottlenecks": result.bottlenecks,
        "operations": [
            {
                "operation_id": str(s.operation_id),
                "operation_name": s.operation_name,
                "resource_name": s.resource_name,
                "planned_start_hour": float(s.planned_start),
                "planned_end_hour": float(s.planned_end),
                "duration_hours": float(s.duration),
                "is_critical": s.is_critical,
                "total_float": float(s.total_float),
                "predecessor_ids": [str(p) for p in s.predecessor_ids],
            }
            for s in result.scheduled
        ],
    }
