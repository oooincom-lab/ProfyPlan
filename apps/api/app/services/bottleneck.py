"""
Bottleneck Analysis — выявление узких мест в производственном расписании.

Анализирует:
- Загрузку ресурсов из OperationResource
- Ресурсы с загрузкой >80%
- Время ожидания операций в очередях к ресурсу
- Рекомендации: добавить смену, аутсорсинг, перераспределение

Не изменяет граф — только диагностика.
"""
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Optional
from uuid import UUID


@dataclass
class ResourceLoad:
    """Загрузка одного ресурса."""
    resource_id: str
    resource_name: str
    resource_type: str
    total_demand_hours: Decimal  # сумма capacity_demand × duration по всем назначенным операциям
    available_hours: Decimal     # доступные часы за период
    load_percent: Decimal        # процент загрузки
    assigned_operations: int     # количество назначенных операций
    min_wait_hours: Decimal      # минимальное ожидание в очереди
    max_wait_hours: Decimal      # максимальное ожидание
    avg_wait_hours: Decimal      # среднее ожидание
    bottleneck_level: str        # "critical" (>95%), "warning" (80-95%), "normal" (<80%)
    recommendations: list[str] = field(default_factory=list)


@dataclass
class BottleneckResult:
    """Результат bottleneck-анализа."""
    project_id: str
    resources: list[ResourceLoad]
    critical_count: int
    warning_count: int
    total_resources: int
    summary: str
    recommendations: list[str] = field(default_factory=list)


def analyze_bottlenecks(
    operations: list[dict],
    operation_resources: list[dict],
    resources: list[dict],
    project_duration_hours: float = 0,
    bottleneck_threshold: float = 80.0,
    critical_threshold: float = 95.0,
) -> BottleneckResult:
    """
    Анализ узких мест.

    operations: [{id, name, duration_base, early_start, early_finish, ...}]
    operation_resources: [{operation_id, resource_id, capacity_demand, ...}]
    resources: [{id, name, resource_type, capacity_per_unit, ...}]
    project_duration_hours: общая длительность проекта (для расчёта доступных часов)
    bottleneck_threshold: порог для "warning" (%)
    critical_threshold: порог для "critical" (%)

    Возвращает BottleneckResult с диагностикой.
    """
    if not resources or not operation_resources:
        return BottleneckResult(
            project_id="",
            resources=[],
            critical_count=0,
            warning_count=0,
            total_resources=len(resources),
            summary="Нет данных для анализа узких мест",
        )

    # Индексируем операции по id
    ops_by_id: dict[str, dict] = {str(o["id"]): o for o in operations}

    # Авто-определение project_duration если не задан
    if project_duration_hours <= 0 and operations:
        project_duration_hours = max(
            float(o.get("early_finish", 0)) for o in operations
        ) - min(
            float(o.get("early_start", 0)) for o in operations
        )
    if project_duration_hours <= 0:
        project_duration_hours = 40.0  # fallback: неделя

    # Группируем назначения по ресурсам
    res_assignments: dict[str, list[dict]] = {}
    for ass in operation_resources:
        rid = str(ass.get("resource_id", ""))
        if rid:
            res_assignments.setdefault(rid, []).append(ass)

    res_index: dict[str, dict] = {str(r["id"]): r for r in resources}

    loads: list[ResourceLoad] = []

    for rid, rdata in res_index.items():
        assignments = res_assignments.get(rid, [])

        # Суммарный спрос (часы)
        total_demand = Decimal("0")
        op_count = 0
        wait_times: list[Decimal] = []

        for ass in assignments:
            op = ops_by_id.get(str(ass.get("operation_id", "")))
            if not op:
                continue
            op_count += 1

            dur = Decimal(str(op.get("duration_base", 1)))
            capacity = Decimal(str(ass.get("capacity_demand", 1)))
            demand = dur * capacity
            total_demand += demand

            # Время ожидания: разница между early_start и late_start
            es = Decimal(str(op.get("early_start", 0)))
            ls = Decimal(str(op.get("late_start", 0)))
            wait = max(Decimal("0"), ls - es)
            wait_times.append(wait)

        # Доступные часы
        cap_per_unit = Decimal(str(rdata.get("capacity_per_unit", 1)))
        cap_unit = rdata.get("capacity_unit", "hour")
        if cap_unit == "day":
            cap_per_unit *= Decimal("8")  # 8-часовой день
        elif cap_unit == "shift":
            cap_per_unit *= Decimal("12")

        available = Decimal(str(project_duration_hours)) * cap_per_unit

        # Процент загрузки
        if available > 0:
            load_pct = (total_demand / available) * Decimal("100")
        else:
            load_pct = Decimal("0")

        # Уровень bottleneck
        if load_pct >= Decimal(str(critical_threshold)):
            level = "critical"
        elif load_pct >= Decimal(str(bottleneck_threshold)):
            level = "warning"
        else:
            level = "normal"

        # Рекомендации
        recs: list[str] = []
        if level == "critical":
            recs.append(f"Ресурс «{rdata.get('name', rid)}» перегружен ({float(load_pct):.0f}%). "
                        f"Рекомендуется: добавить вторую смену или аутсорсинг.")
            if cap_unit in ("hour", "day"):
                recs.append("Рассмотрите увеличение capacity_per_unit или добавление "
                           "параллельного ресурса того же типа.")
        elif level == "warning":
            recs.append(f"Ресурс «{rdata.get('name', rid)}» близок к перегрузке ({float(load_pct):.0f}%). "
                        f"Мониторинг. План: добавить резервного оператора.")

        avg_wait = (sum(wait_times, Decimal("0")) / len(wait_times)) if wait_times else Decimal("0")
        min_wait = min(wait_times) if wait_times else Decimal("0")
        max_wait = max(wait_times) if wait_times else Decimal("0")

        loads.append(ResourceLoad(
            resource_id=rid,
            resource_name=rdata.get("name", "Ресурс " + rid[:8]),
            resource_type=rdata.get("resource_type", "equipment"),
            total_demand_hours=total_demand,
            available_hours=available,
            load_percent=load_pct,
            assigned_operations=op_count,
            min_wait_hours=min_wait,
            max_wait_hours=max_wait,
            avg_wait_hours=avg_wait,
            bottleneck_level=level,
            recommendations=recs,
        ))

    # Сортируем по загрузке (сверху — самые загруженные)
    loads.sort(key=lambda r: float(r.load_percent), reverse=True)

    critical_count = sum(1 for r in loads if r.bottleneck_level == "critical")
    warning_count = sum(1 for r in loads if r.bottleneck_level == "warning")

    # Сводка
    if critical_count > 0:
        summary = (f"Выявлено {critical_count} критических узких мест, "
                   f"{warning_count} предупреждений. "
                   f"Рекомендуется выравнивание ресурсов.")
    elif warning_count > 0:
        summary = (f"Критических узких мест нет. {warning_count} ресурсов "
                   f"близки к порогу загрузки. План стабилен с оговорками.")
    else:
        summary = "Узких мест не выявлено. Загрузка ресурсов в норме."

    all_recs: list[str] = []
    for r in loads:
        all_recs.extend(r.recommendations)

    return BottleneckResult(
        project_id="",
        resources=loads,
        critical_count=critical_count,
        warning_count=warning_count,
        total_resources=len(resources),
        summary=summary,
        recommendations=all_recs[:5],  # топ-5
    )
