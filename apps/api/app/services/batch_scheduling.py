"""
Batch Scheduling — группировка операций с одинаковым output_product для
оптимизации производственного расписания.

Обнаруживает партии (batches):
- По совпадающему output_product
- По близким датам старта (в пределах окна группировки)
- Рассчитывает экономию от объединения (единый setup, сокращение переналадок)

Не изменяет граф автоматически — возвращает предложения для подтверждения.
"""
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Optional
from uuid import UUID


@dataclass
class BatchCandidate:
    """Группа операций-кандидатов на объединение в партию."""
    output_product: str
    operation_ids: list[str]
    operation_names: list[str]
    total_quantity: Decimal
    total_duration: Decimal  # сумма длительностей без оптимизации
    setup_savings: Decimal    # экономия setup_time при объединении
    optimized_duration: Decimal  # длительность после объединения
    resource_ids: list[str]   # задействованные ресурсы
    earliest_start: float     # самый ранний ES в партии
    latest_finish: float      # самый поздний LF в партии
    batch_window_hours: float # окно, в которое попали операции
    recommendation: str       # "merge" / "stagger" / "split"


@dataclass
class BatchScheduleResult:
    """Результат анализа batch scheduling."""
    project_id: str
    batches: list[BatchCandidate]
    total_setup_savings: Decimal
    total_duration_savings: Decimal
    affected_operations: int
    total_operations: int
    warnings: list[str] = field(default_factory=list)


def analyze_batches(
    operations: list[dict],
    dependencies: list[dict],
    resources: list[dict],
    batch_window_hours: float = 48.0,
    min_batch_size: int = 2,
) -> BatchScheduleResult:
    """
    Анализ возможностей пакетной обработки.

    operations: [{id, name, output_product, output_quantity, duration_base, setup_time, ...}]
    dependencies: [{predecessor_id, successor_id, ...}]
    resources: [{id, name, resource_type}, ...]
    batch_window_hours: окно группировки по раннему старту (часы)
    min_batch_size: минимальное количество операций для формирования партии

    Возвращает BatchScheduleResult с предложениями без изменения графа.
    """
    # Фильтруем операции с output_product
    product_ops: dict[str, list[dict]] = {}
    for op in operations:
        product = op.get("output_product")
        if not product:
            continue
        product_ops.setdefault(product, []).append(op)

    # Анализируем группы
    batches: list[BatchCandidate] = []
    warnings: list[str] = []

    for product, ops in product_ops.items():
        if len(ops) < min_batch_size:
            continue

        # Сортируем по раннему старту
        sorted_ops = sorted(ops, key=lambda o: float(o.get("early_start", 0)))

        # Группируем по временному окну
        current_group: list[dict] = []
        group_start_es = float(sorted_ops[0].get("early_start", 0))

        for op in sorted_ops:
            op_es = float(op.get("early_start", 0))
            if op_es - group_start_es <= batch_window_hours:
                current_group.append(op)
            else:
                # Завершаем текущую группу
                if len(current_group) >= min_batch_size:
                    batch = _build_batch(product, current_group, resources)
                    batches.append(batch)
                # Начинаем новую
                current_group = [op]
                group_start_es = op_es

        # Последняя группа
        if len(current_group) >= min_batch_size:
            batch = _build_batch(product, current_group, resources)
            batches.append(batch)

    total_ops = len(operations)
    affected = sum(len(b.operation_ids) for b in batches)
    total_setup_savings = sum(b.setup_savings for b in batches)
    total_dur_savings = sum(
        (b.total_duration - b.optimized_duration) for b in batches
    )

    if total_ops > 0 and affected == 0:
        warnings.append("Не найдено операций с совпадающим output_product для группировки")

    return BatchScheduleResult(
        project_id="",
        batches=batches,
        total_setup_savings=total_setup_savings,
        total_duration_savings=total_dur_savings,
        affected_operations=affected,
        total_operations=total_ops,
        warnings=warnings,
    )


def _build_batch(
    product: str,
    ops: list[dict],
    resources: list[dict],
) -> BatchCandidate:
    """Строит BatchCandidate из группы операций."""
    op_ids = [str(o["id"]) for o in ops]
    op_names = [o.get("name", "?") for o in ops]

    total_qty = sum(Decimal(str(o.get("output_quantity", 0))) for o in ops)
    total_dur = sum(Decimal(str(o.get("duration_base", 0))) for o in ops)
    setup_total = sum(Decimal(str(o.get("setup_time", 0))) for o in ops)

    # Экономия: сохраняем один setup вместо N
    # Плюс сокращение teardown между одинаковыми продуктами
    max_setup = max((Decimal(str(o.get("setup_time", 0))) for o in ops), default=Decimal("0"))
    setup_savings = setup_total - max_setup

    # Оптимизированная длительность: общая длительность минус лишние setup/teardown
    optimized = total_dur - setup_savings

    # Собираем ресурсы
    res_ids: list[str] = []
    for op in ops:
        res_list = op.get("resources", [])
        for r in res_list:
            rid = r.get("resource_id") or r.get("id")
            if rid and str(rid) not in res_ids:
                res_ids.append(str(rid))

    earliest = min(float(o.get("early_start", 0)) for o in ops)
    latest = max(float(o.get("late_finish", float(o.get("early_finish", 0)) + float(o.get("duration_base", 1)))
                if o.get("late_finish") else float(o.get("early_finish", 0)) + float(o.get("duration_base", 1)))
                for o in ops)

    # Определяем рекомендацию
    if optimized < total_dur * Decimal("0.7"):
        recommendation = "merge"  # значительная экономия → объединять
    elif len(ops) > 5:
        recommendation = "split"  # слишком большая партия → разбить
    else:
        recommendation = "stagger"  # staggered — со смещением

    return BatchCandidate(
        output_product=product,
        operation_ids=op_ids,
        operation_names=op_names,
        total_quantity=total_qty,
        total_duration=total_dur,
        setup_savings=setup_savings,
        optimized_duration=optimized,
        resource_ids=res_ids,
        earliest_start=earliest,
        latest_finish=latest,
        batch_window_hours=latest - earliest,
        recommendation=recommendation,
    )
