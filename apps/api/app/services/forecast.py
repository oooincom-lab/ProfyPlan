"""
Пересчёт прогноза: Baseline vs Actual → Forecast.
"""
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.operation import Operation, OperationDependency
from app.models.plan_version import ActualExecution, PlanBaseline
from app.services.cpm import calculate_cpm


@dataclass
class ForecastDeviation:
    """Отклонение прогноза от baseline."""
    operation_id: UUID
    operation_name: str
    baseline_start: Decimal
    baseline_end: Decimal
    forecast_start: Decimal
    forecast_end: Decimal
    deviation_hours: Decimal
    reason: str


@dataclass
class ForecastResult:
    """Результат пересчёта прогноза."""
    project_id: UUID
    baseline_finish: Decimal
    forecast_finish: Decimal
    delay_hours: Decimal
    total_operations: int
    completed_count: int
    in_progress_count: int
    not_started_count: int
    deviations: list[ForecastDeviation]
    delayed_projects: list[UUID] = field(default_factory=list)


async def recalculate_forecast(
    db: AsyncSession,
    project_id: UUID,
    tenant_id: UUID,
) -> ForecastResult:
    """
    Пересчитывает план с учётом фактического выполнения.

    Шаги:
    1. Загрузить baseline (последний активный)
    2. Загрузить все actual-записи
    3. Зафиксировать completed/in_progress операции
    4. Пересчитать CPM с зафиксированными ES/EF
    5. Сравнить forecast с baseline
    """
    # 1. Baseline
    bl_result = await db.execute(
        select(PlanBaseline)
        .where(
            PlanBaseline.project_id == project_id,
            PlanBaseline.is_active == True,
        )
        .order_by(PlanBaseline.version.desc())
        .limit(1)
    )
    baseline = bl_result.scalars().first()

    # 2. Операции
    ops_result = await db.execute(
        select(Operation).where(
            Operation.project_id == project_id,
            Operation.tenant_id == tenant_id,
        )
    )
    operations = list(ops_result.scalars().all())
    op_ids = [op.id for op in operations]

    # 3. Фактические данные
    actual_result = await db.execute(
        select(ActualExecution).where(
            ActualExecution.operation_id.in_(op_ids)
        )
    )
    actuals = {a.operation_id: a for a in actual_result.scalars().all()}

    # 4. Зависимости
    deps_result = await db.execute(
        select(OperationDependency).where(
            OperationDependency.predecessor_id.in_(op_ids)
        )
    )
    dependencies = list(deps_result.scalars().all())

    # 5. Строим обновлённые данные для CPM
    # Заменяем duration на оставшуюся для in_progress
    # Фиксируем ES/EF для completed

    ops_dicts = []
    fixed_ops = {}  # operation_id → {es, ef, fixed}

    for op in operations:
        actual = actuals.get(op.id)
        duration = float(op.duration_base) + float(op.setup_time) + float(op.teardown_time)

        if actual and actual.status == "completed":
            if actual.fact_start and actual.fact_end:
                ops_dicts.append({
                    "id": str(op.id),
                    "name": op.name,
                    "duration_base": 0,  # completed — нулевая оставшаяся длительность
                    "setup_time": 0,
                    "teardown_time": 0,
                })
                fixed_ops[op.id] = {
                    "es": 0,
                    "ef": 0,
                    "fixed": True,
                    "fact_start": actual.fact_start,
                    "fact_end": actual.fact_end,
                }
            else:
                # Нет дат — используем baseline
                ops_dicts.append({
                    "id": str(op.id),
                    "name": op.name,
                    "duration_base": float(op.duration_base),
                    "setup_time": float(op.setup_time),
                    "teardown_time": float(op.teardown_time),
                })

        elif actual and actual.status == "in_progress":
            if actual.fact_start:
                elapsed_hours = 0  # TODO: вычислить elapsed от fact_start до now()
                remaining = max(0, duration - elapsed_hours)
                ops_dicts.append({
                    "id": str(op.id),
                    "name": op.name,
                    "duration_base": remaining,
                    "setup_time": 0,
                    "teardown_time": 0,
                })
                fixed_ops[op.id] = {
                    "es": elapsed_hours,  # ES фиксирован фактом старта
                    "ef": None,
                    "fixed": True,
                    "fact_start": actual.fact_start,
                }
            else:
                ops_dicts.append({
                    "id": str(op.id),
                    "name": op.name,
                    "duration_base": duration,
                    "setup_time": float(op.setup_time),
                    "teardown_time": float(op.teardown_time),
                })

        else:
            # not_started / delayed / cancelled
            ops_dicts.append({
                "id": str(op.id),
                "name": op.name,
                "duration_base": duration,
                "setup_time": float(op.setup_time),
                "teardown_time": float(op.teardown_time),
            })

    # 6. Запускаем CPM с модифицированным графом
    deps_dicts = [
        {
            "predecessor_id": str(dep.predecessor_id),
            "successor_id": str(dep.successor_id),
            "dependency_type": dep.dependency_type,
            "lag_time": float(dep.lag_time),
        }
        for dep in dependencies
    ]

    try:
        result = calculate_cpm(ops_dicts, deps_dicts)
    except ValueError as e:
        raise ValueError(f"Ошибка пересчёта прогноза: {e}")

    # 7. Сравниваем с baseline
    baseline_finish = Decimal("0")
    if baseline and baseline.snapshot_data:
        baseline_finish = Decimal(
            str(baseline.snapshot_data.get("total_duration", 0))
        )

    forecast_finish = result.total_duration
    delay = forecast_finish - baseline_finish

    # 8. Собираем отклонения
    deviations = []
    for node_id, node in result.nodes.items():
        op = next((o for o in operations if str(o.id) == node_id), None)
        if not op:
            continue

        actual = actuals.get(op.id)
        if actual and actual.status == "completed":
            status = "completed"
        elif actual and actual.status == "in_progress":
            status = "in_progress"
        elif actual and actual.status == "delayed":
            status = "delayed"
        else:
            status = "not_started"

        # Получаем baseline-значения если есть
        bl_es = Decimal("0")
        bl_ef = Decimal("0")
        if baseline and baseline.snapshot_data:
            bl_nodes = baseline.snapshot_data.get("nodes", [])
            bl_node = next((n for n in bl_nodes if n.get("id") == node_id), None)
            if bl_node:
                bl_es = Decimal(str(bl_node.get("early_start", 0)))
                bl_ef = Decimal(str(bl_node.get("early_finish", 0)))

        dev = ForecastDeviation(
            operation_id=op.id,
            operation_name=op.name,
            baseline_start=bl_es,
            baseline_end=bl_ef,
            forecast_start=node.early_start,
            forecast_end=node.early_finish,
            deviation_hours=node.early_finish - bl_ef,
            reason=f"Статус: {status}",
        )
        deviations.append(dev)

    # Считаем статусы
    completed_count = sum(
        1 for a in actuals.values() if a.status == "completed"
    )
    in_progress_count = sum(
        1 for a in actuals.values() if a.status == "in_progress"
    )
    not_started_count = len(operations) - completed_count - in_progress_count

    return ForecastResult(
        project_id=project_id,
        baseline_finish=baseline_finish,
        forecast_finish=forecast_finish,
        delay_hours=delay,
        total_operations=len(operations),
        completed_count=completed_count,
        in_progress_count=in_progress_count,
        not_started_count=not_started_count,
        deviations=deviations,
    )


def format_forecast_result(result: ForecastResult) -> dict:
    """Форматирует ForecastResult в JSON-ответ."""
    return {
        "project_id": str(result.project_id),
        "method": "Forecast Recalculation",
        "baseline_finish_hours": float(result.baseline_finish),
        "forecast_finish_hours": float(result.forecast_finish),
        "delay_hours": float(result.delay_hours),
        "is_delayed": result.delay_hours > 1,
        "operation_status": {
            "total": result.total_operations,
            "completed": result.completed_count,
            "in_progress": result.in_progress_count,
            "not_started": result.not_started_count,
        },
        "deviations": [
            {
                "operation_id": str(d.operation_id),
                "operation_name": d.operation_name,
                "baseline_start_hour": float(d.baseline_start),
                "baseline_end_hour": float(d.baseline_end),
                "forecast_start_hour": float(d.forecast_start),
                "forecast_end_hour": float(d.forecast_end),
                "deviation_hours": float(d.deviation_hours),
                "reason": d.reason,
            }
            for d in result.deviations
            if abs(float(d.deviation_hours)) > 0.01
        ],
    }
