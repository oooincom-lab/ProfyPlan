"""
Resource Leveling: Serial SGS алгоритм выравнивания ресурсов.
С поддержкой календарей доступности (рабочие смены).
"""
from dataclasses import dataclass, field
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.operation import Operation, OperationDependency, OperationResource
from app.models.resource import Resource
from app.models.resource_calendar import ResourceCalendar, ResourceCalendarSlot

HOURS_PER_DAY = Decimal("24")
DAYS_PER_WEEK = 7


def _parse_calendar_slots(calendar: ResourceCalendar | None) -> dict[int, list[tuple[Decimal, Decimal]]]:
    """
    Преобразует слоты календаря в словарь {day_of_week: [(start, end), ...]}.
    Возвращает пустой словарь если календаря нет (= 24/7).
    """
    if not calendar or not calendar.slots:
        return {}
    result: dict[int, list[tuple[Decimal, Decimal]]] = {}
    for s in calendar.slots:
        if not s.is_active:
            continue
        result.setdefault(s.day_of_week, []).append((s.start_hour, s.end_hour))
    return result


def find_earliest_working_start(
    earliest: Decimal,
    duration: Decimal,
    slots: dict[int, list[tuple[Decimal, Decimal]]],
    resource_free: Decimal,
) -> Decimal:
    """
    Найти earliest start time, при котором операция длительностью `duration`
    укладывается в рабочие слоты календаря.

    Args:
        earliest: самый ранний возможный старт (после предшественников)
        duration: длительность операции в часах
        slots: {day_of_week: [(start_hour, end_hour), ...]} или пусто = 24/7
        resource_free: время освобождения ресурса (конец предыдущей операции)

    Returns:
        Откорректированное время старта.
    """
    if not slots:
        # Нет календаря — 24/7, только учёт занятости ресурса
        return max(earliest, resource_free)

    current = max(earliest, resource_free)
    max_iterations = 365 * 24  # safety limit: 1 year of hours

    for _ in range(int(max_iterations)):
        day_index = int((current // HOURS_PER_DAY).quantize(Decimal("1"), rounding=ROUND_HALF_UP)) % DAYS_PER_WEEK
        hour_in_day = current % HOURS_PER_DAY

        day_slots = slots.get(day_index, [])

        # Ищем слот, который вмещает операцию
        for slot_start, slot_end in day_slots:
            effective_start = max(hour_in_day, slot_start)

            if effective_start >= slot_end:
                continue  # слот уже прошёл

            end_in_day = effective_start + duration

            if end_in_day <= slot_end:
                # Влезает в этот слот
                return (current // HOURS_PER_DAY) * HOURS_PER_DAY + effective_start

            # Не влезает — пробуем следующий слот этого дня
            continue

        # Нет подходящего слота сегодня — переходим к началу следующего дня
        next_day_start = ((current // HOURS_PER_DAY) + Decimal("1")) * HOURS_PER_DAY

        # Но сначала проверяем: может ли следующий день иметь слот раньше 24:00?
        # Ищем первый рабочий слот в следующие дни
        found = False
        for offset in range(1, 8):  # ищем до 7 дней вперёд
            check_day = (day_index + offset) % DAYS_PER_WEEK
            day_slots = slots.get(check_day, [])
            if day_slots:
                # Переход к началу первого слота этого дня
                first_slot = min(s[0] for s in day_slots)
                days_ahead = (next_day_start - current) // HOURS_PER_DAY
                jump = Decimal(str(offset)) * HOURS_PER_DAY + first_slot
                current = ((current // HOURS_PER_DAY) * HOURS_PER_DAY) + jump
                found = True
                break

        if not found:
            # Нет слотов вообще — возвращаем earliest
            return max(earliest, resource_free)

        # Перепроверим, что не вышли за earliest+resource_free
        current = max(current, resource_free)

    return max(earliest, resource_free)  # fallback


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

    # Загружаем календари ресурсов
    res_ids = list(resources.keys())
    calendars: dict[UUID, dict[int, list[tuple[Decimal, Decimal]]]] = {}
    if res_ids:
        cal_result = await db.execute(
            select(ResourceCalendar)
            .options(selectinload(ResourceCalendar.slots))
            .where(
                ResourceCalendar.resource_id.in_(res_ids),
                ResourceCalendar.tenant_id == tenant_id,
                ResourceCalendar.is_active == True,
            )
        )
        for cal in cal_result.scalars().all():
            calendars[cal.resource_id] = _parse_calendar_slots(cal)

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

        # Если операция использует ресурс — учесть занятость и календарь
        if resource_name and op_resources:
            res_id = op_resources[0].resource_id
            cal_slots = calendars.get(res_id, {})
            rf = resource_free.get(resource_name, Decimal("0"))
            if est < rf:
                conflicts_resolved += 1
            est = find_earliest_working_start(est, Decimal(str(duration)), cal_slots, rf)

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
