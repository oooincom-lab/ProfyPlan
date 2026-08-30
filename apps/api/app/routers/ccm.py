"""
CCM-роутер: multi-project merge, BOM-развёртка, resource leveling, forecast.
"""
import io
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_tenant_id
from app.models.operation import Operation, OperationDependency, OperationResource
from app.models.project import Project
from app.models.resource import Resource
from app.models.plan_version import PlanBaseline, ActualExecution
from app.services.multi_project import merge_projects, format_merged_result
from app.services.resource_leveling import resource_leveling_sgs, format_leveling_result
from app.services.forecast import recalculate_forecast, format_forecast_result
from app.services.batch_scheduling import analyze_batches, BatchScheduleResult
from app.services.bottleneck import analyze_bottlenecks, BottleneckResult

ccm_router = APIRouter(prefix="/v1/ccm", tags=["CCM"])


@ccm_router.post("/merge")
async def merge_projects_endpoint(
    project_ids: list[UUID],
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """
    Объединить несколько проектов в единый CPM-граф.

    Тело запроса: { "project_ids": ["uuid1", "uuid2", ...] }

    Возвращает: сводный CPM-расчёт с критическим путём
    """
    if len(project_ids) < 2:
        raise HTTPException(status_code=400, detail="Минимум 2 проекта для объединения")

    # Проверяем существование и принадлежность проектов
    for pid in project_ids:
        proj = await db.execute(
            select(Project).where(
                Project.id == pid, Project.tenant_id == tenant_id
            )
        )
        if not proj.scalar_one_or_none():
            raise HTTPException(
                status_code=404,
                detail=f"Проект {pid} не найден или нет доступа",
            )

    try:
        result = await merge_projects(db, project_ids, tenant_id)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    return format_merged_result(result)


@ccm_router.post("/projects/{project_id}/resource-leveling")
async def run_resource_leveling(
    project_id: UUID,
    use_cpm_result: bool = Query(True, description="Использовать предварительный CPM-расчёт"),
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """
    Запустить выравнивание ресурсов для проекта.

    Алгоритм: Serial SGS с приоритетами (LS → TF → -duration).
    """
    # Проверка проекта
    proj = await db.execute(
        select(Project).where(
            Project.id == project_id, Project.tenant_id == tenant_id
        )
    )
    if not proj.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Проект не найден")

    # Опционально: сначала CPM для получения приоритетов
    cpm_result = None
    if use_cpm_result:
        from app.routers.calculations import run_cpm
        try:
            cpm_result = await run_cpm(project_id, db, tenant_id)
        except HTTPException:
            pass  # Продолжаем без CPM

    try:
        result = await resource_leveling_sgs(db, project_id, tenant_id, cpm_result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка выравнивания: {e}")

    return format_leveling_result(result)


@ccm_router.post("/projects/{project_id}/recalculate-forecast")
async def recalculate_forecast_endpoint(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """
    Пересчитать прогноз с учётом фактического выполнения.

    Учитывает completed и in_progress операции из ActualExecution.
    Возвращает: forecast с отклонениями от baseline.
    """
    proj = await db.execute(
        select(Project).where(
            Project.id == project_id, Project.tenant_id == tenant_id
        )
    )
    if not proj.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Проект не найден")

    try:
        result = await recalculate_forecast(db, project_id, tenant_id)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    return format_forecast_result(result)


@ccm_router.post("/projects/{project_id}/baseline")
async def create_baseline(
    project_id: UUID,
    name: str,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """
    Создать baseline — заморозить текущий план как версию.

    Тело запроса: { "name": "План от 01.08.2026" }
    """
    proj = await db.execute(
        select(Project).where(
            Project.id == project_id, Project.tenant_id == tenant_id
        )
    )
    if not proj.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Проект не найден")

    # Деактивируем предыдущие baseline'ы
    prev_baselines = await db.execute(
        select(PlanBaseline).where(
            PlanBaseline.project_id == project_id,
            PlanBaseline.is_active == True,
        )
    )
    for bl in prev_baselines.scalars().all():
        bl.is_active = False

    # Собираем снапшот текущего графа
    ops_result = await db.execute(
        select(Operation).where(
            Operation.project_id == project_id,
            Operation.tenant_id == tenant_id,
        )
    )
    operations = list(ops_result.scalars().all())

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

    # Запускаем CPM для снапшота
    from app.services.cpm import calculate_cpm
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

    snapshot = None
    if ops_dicts and deps_dicts:
        try:
            cpm_result = calculate_cpm(ops_dicts, deps_dicts)
            snapshot = {
                "total_duration": float(cpm_result.total_duration),
                "critical_path": cpm_result.critical_path,
                "node_count": len(cpm_result.nodes),
                "nodes": [
                    {
                        "id": nid,
                        "name": node.name,
                        "early_start": float(node.early_start),
                        "early_finish": float(node.early_finish),
                        "late_start": float(node.late_start),
                        "late_finish": float(node.late_finish),
                        "total_float": float(node.total_float),
                        "free_float": float(node.free_float),
                        "is_critical": node.is_critical,
                    }
                    for nid, node in cpm_result.nodes.items()
                ],
            }
        except ValueError:
            snapshot = {"error": "CPM-расчёт не выполнен (возможен цикл)"}

    # Определяем версию
    max_ver_result = await db.execute(
        select(PlanBaseline.version).where(
            PlanBaseline.project_id == project_id
        ).order_by(PlanBaseline.version.desc()).limit(1)
    )
    max_ver = max_ver_result.scalar() or 0

    baseline = PlanBaseline(
        project_id=project_id,
        version=max_ver + 1,
        name=name,
        snapshot_data=snapshot,
        is_active=True,
    )
    db.add(baseline)
    await db.commit()

    return {
        "baseline_id": str(baseline.id),
        "project_id": str(project_id),
        "version": baseline.version,
        "name": baseline.name,
        "created_at": baseline.created_at.isoformat(),
        "node_count": len(operations),
    }


@ccm_router.get("/projects/{project_id}/baselines")
async def list_baselines(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """
    Получить список версий плана (baseline'ов) проекта.
    """
    result = await db.execute(
        select(PlanBaseline).where(
            PlanBaseline.project_id == project_id,
        ).order_by(PlanBaseline.version.desc())
    )
    baselines = result.scalars().all()

    return {
        "project_id": str(project_id),
        "baselines": [
            {
                "id": str(bl.id),
                "version": bl.version,
                "name": bl.name,
                "is_active": bl.is_active,
                "created_at": bl.created_at.isoformat(),
            }
            for bl in baselines
        ],
        "total": len(baselines),
    }


@ccm_router.post("/projects/{project_id}/facts")
async def import_facts(
    project_id: UUID,
    facts: list[dict],
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """
    Импортировать фактические данные выполнения.

    Тело запроса: {
        "facts": [
            {
                "operation_id": "uuid",
                "status": "completed",
                "fact_start": "2026-08-01T09:00:00Z",
                "fact_end": "2026-08-02T16:00:00Z",
                "quantity_completed": 100,
                "comment": "Без замечаний"
            }
        ]
    }
    """
    from datetime import datetime

    imported = 0
    errors = []

    for fact_data in facts:
        op_id = fact_data.get("operation_id")
        if not op_id:
            errors.append("operation_id обязателен")
            continue

        # Проверяем существование операции
        op_result = await db.execute(
            select(Operation).where(
                Operation.id == UUID(op_id),
                Operation.project_id == project_id,
                Operation.tenant_id == tenant_id,
            )
        )
        if not op_result.scalar_one_or_none():
            errors.append(f"Операция {op_id} не найдена")
            continue

        # Проверяем существующую запись
        existing = await db.execute(
            select(ActualExecution).where(
                ActualExecution.operation_id == UUID(op_id)
            )
        )
        existing_record = existing.scalar_one_or_none()

        if existing_record and existing_record.status == "completed":
            errors.append(f"Операция {op_id} уже завершена — обновление заблокировано")
            continue

        # Парсим даты
        fact_start = None
        fact_end = None
        if fact_data.get("fact_start"):
            fact_start = datetime.fromisoformat(
                fact_data["fact_start"].replace("Z", "+00:00")
            )
        if fact_data.get("fact_end"):
            fact_end = datetime.fromisoformat(
                fact_data["fact_end"].replace("Z", "+00:00")
            )

        if existing_record:
            # Обновление
            existing_record.status = fact_data.get("status", existing_record.status)
            existing_record.fact_start = fact_start or existing_record.fact_start
            existing_record.fact_end = fact_end or existing_record.fact_end
            existing_record.quantity_completed = fact_data.get("quantity_completed") or existing_record.quantity_completed
            existing_record.comment = fact_data.get("comment") or existing_record.comment
            existing_record.source = fact_data.get("source", "manual")
        else:
            # Новая запись
            actual = ActualExecution(
                operation_id=UUID(op_id),
                status=fact_data.get("status", "not_started"),
                fact_start=fact_start,
                fact_end=fact_end,
                quantity_completed=fact_data.get("quantity_completed"),
                quantity_defect=fact_data.get("quantity_defect"),
                deviation_reason=fact_data.get("deviation_reason"),
                comment=fact_data.get("comment"),
                source=fact_data.get("source", "manual"),
            )
            db.add(actual)

        imported += 1

    await db.commit()

    return {
        "imported": imported,
        "errors": errors,
        "project_id": str(project_id),
    }


@ccm_router.get("/projects/{project_id}/batch-scheduling")
async def analyze_batch_scheduling(
    project_id: UUID,
    batch_window_hours: float = Query(48.0, description="Окно группировки в часах"),
    min_batch_size: int = Query(2, description="Минимальный размер партии"),
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """
    Анализ возможностей пакетной обработки (Batch Scheduling).

    Группирует операции с одинаковым output_product в партии.
    Рассчитывает экономию setup/teardown. Возвращает предложения.
    """
    proj = await db.execute(
        select(Project).where(Project.id == project_id, Project.tenant_id == tenant_id)
    )
    if not proj.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Проект не найден")

    # Загружаем операции
    ops_result = await db.execute(
        select(Operation).where(
            Operation.project_id == project_id,
            Operation.tenant_id == tenant_id,
        )
    )
    operations = ops_result.scalars().all()

    # Загружаем ресурсы
    res_result = await db.execute(
        select(Resource).where(Resource.tenant_id == tenant_id)
    )
    resources = res_result.scalars().all()

    # Конвертируем в словари
    ops_dicts = [
        {
            "id": str(op.id),
            "name": op.name,
            "output_product": op.output_product,
            "output_quantity": float(op.output_quantity) if op.output_quantity else 0,
            "duration_base": float(op.duration_base),
            "setup_time": float(op.setup_time),
            "teardown_time": float(op.teardown_time),
            "early_start": float(op.duration_base),  # replaced by CPM values if available
            "early_finish": float(op.duration_base),
            "late_start": float(op.duration_base),
            "late_finish": float(op.duration_base),
        }
        for op in operations
    ]

    # Загружаем CPM-результаты для получения ES/EF/LS/LF
    try:
        cpm_ops = await db.execute(
            select(Operation).where(
                Operation.project_id == project_id,
                Operation.tenant_id == tenant_id,
            )
        )
        deps = await db.execute(
            select(OperationDependency).join(
                Operation, OperationDependency.predecessor_id == Operation.id
            ).where(Operation.project_id == project_id)
        )
        deps_list = deps.scalars().all()
        ops_list = cpm_ops.scalars().all()

        if ops_list and deps_list:
            from app.services.cpm import calculate_cpm
            cpm_ops_dicts = [
                {"id": str(o.id), "name": o.name,
                 "duration_base": float(o.duration_base),
                 "setup_time": float(o.setup_time),
                 "teardown_time": float(o.teardown_time)}
                for o in ops_list
            ]
            cpm_deps_dicts = [
                {"predecessor_id": str(d.predecessor_id),
                 "successor_id": str(d.successor_id),
                 "dependency_type": d.dependency_type,
                 "lag_time": float(d.lag_time)}
                for d in deps_list
            ]
            cpm_result = calculate_cpm(cpm_ops_dicts, cpm_deps_dicts)
            # Обновляем ops_dicts с CPM-значениями
            for od in ops_dicts:
                node = cpm_result.nodes.get(od["id"])
                if node:
                    od["early_start"] = float(node.early_start)
                    od["early_finish"] = float(node.early_finish)
                    od["late_start"] = float(node.late_start)
                    od["late_finish"] = float(node.late_finish)
    except Exception:
        pass  # Без CPM — используем duration как заглушку

    res_dicts = [
        {"id": str(r.id), "name": r.name, "resource_type": r.resource_type}
        for r in resources
    ]

    deps_dicts = []  # не нужны для batch-анализа

    result = analyze_batches(
        ops_dicts, deps_dicts, res_dicts,
        batch_window_hours=batch_window_hours,
        min_batch_size=min_batch_size,
    )
    result.project_id = str(project_id)

    return {
        "project_id": result.project_id,
        "batches": [
            {
                "output_product": b.output_product,
                "operation_ids": b.operation_ids,
                "operation_names": b.operation_names,
                "total_quantity": float(b.total_quantity),
                "total_duration": float(b.total_duration),
                "setup_savings": float(b.setup_savings),
                "optimized_duration": float(b.optimized_duration),
                "resource_ids": b.resource_ids,
                "earliest_start": b.earliest_start,
                "latest_finish": b.latest_finish,
                "batch_window_hours": b.batch_window_hours,
                "recommendation": b.recommendation,
            }
            for b in result.batches
        ],
        "total_setup_savings": float(result.total_setup_savings),
        "total_duration_savings": float(result.total_duration_savings),
        "affected_operations": result.affected_operations,
        "total_operations": result.total_operations,
        "warnings": result.warnings,
    }


@ccm_router.get("/projects/{project_id}/bottleneck")
async def analyze_bottleneck(
    project_id: UUID,
    bottleneck_threshold: float = Query(80.0, description="Порог предупреждения (%)"),
    critical_threshold: float = Query(95.0, description="Порог критической загрузки (%)"),
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """
    Анализ узких мест (Bottleneck Analysis).

    Оценивает загрузку ресурсов, выявляет перегруженные (>80%).
    Рассчитывает время ожидания в очередях. Даёт рекомендации.
    """
    proj = await db.execute(
        select(Project).where(Project.id == project_id, Project.tenant_id == tenant_id)
    )
    if not proj.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Проект не найден")

    # Загружаем операции
    ops_result = await db.execute(
        select(Operation).where(
            Operation.project_id == project_id,
            Operation.tenant_id == tenant_id,
        )
    )
    operations = ops_result.scalars().all()

    # Загружаем назначения ресурсов
    or_result = await db.execute(
        select(OperationResource).where(
            OperationResource.operation_id.in_(
                select(Operation.id).where(
                    Operation.project_id == project_id,
                    Operation.tenant_id == tenant_id,
                )
            )
        )
    )
    op_resources = or_result.scalars().all()

    # Загружаем ресурсы
    res_result = await db.execute(
        select(Resource).where(Resource.tenant_id == tenant_id)
    )
    resources = res_result.scalars().all()

    # CPM для получения ES/EF/LS/LF
    project_duration = 0.0
    ops_dicts = [
        {"id": str(op.id), "name": op.name,
         "duration_base": float(op.duration_base),
         "setup_time": float(op.setup_time),
         "teardown_time": float(op.teardown_time),
         "early_start": 0.0, "early_finish": 0.0,
         "late_start": 0.0, "late_finish": 0.0}
        for op in operations
    ]

    try:
        deps = await db.execute(
            select(OperationDependency).join(
                Operation, OperationDependency.predecessor_id == Operation.id
            ).where(Operation.project_id == project_id)
        )
        deps_list = deps.scalars().all()
        if ops_dicts and deps_list:
            from app.services.cpm import calculate_cpm
            cpm_deps_dicts = [
                {"predecessor_id": str(d.predecessor_id),
                 "successor_id": str(d.successor_id),
                 "dependency_type": d.dependency_type,
                 "lag_time": float(d.lag_time)}
                for d in deps_list
            ]
            cpm_result = calculate_cpm(ops_dicts, cpm_deps_dicts)
            for od in ops_dicts:
                node = cpm_result.nodes.get(od["id"])
                if node:
                    od["early_start"] = float(node.early_start)
                    od["early_finish"] = float(node.early_finish)
                    od["late_start"] = float(node.late_start)
                    od["late_finish"] = float(node.late_finish)
            project_duration = float(cpm_result.total_duration)
    except Exception:
        project_duration = sum(float(o.duration_base) for o in operations)

    or_dicts = [
        {"operation_id": str(or_.operation_id),
         "resource_id": str(or_.resource_id),
         "capacity_demand": float(or_.capacity_demand)}
        for or_ in op_resources
    ]

    res_dicts = [
        {"id": str(r.id), "name": r.name, "resource_type": r.resource_type,
         "capacity_per_unit": float(r.capacity_per_unit),
         "capacity_unit": r.capacity_unit}
        for r in resources
    ]

    result = analyze_bottlenecks(
        ops_dicts, or_dicts, res_dicts,
        project_duration_hours=project_duration,
        bottleneck_threshold=bottleneck_threshold,
        critical_threshold=critical_threshold,
    )
    result.project_id = str(project_id)

    return {
        "project_id": result.project_id,
        "resources": [
            {
                "resource_id": r.resource_id,
                "resource_name": r.resource_name,
                "resource_type": r.resource_type,
                "total_demand_hours": float(r.total_demand_hours),
                "available_hours": float(r.available_hours),
                "load_percent": float(round(r.load_percent, 1)),
                "assigned_operations": r.assigned_operations,
                "min_wait_hours": float(r.min_wait_hours),
                "max_wait_hours": float(r.max_wait_hours),
                "avg_wait_hours": float(round(r.avg_wait_hours, 2)),
                "bottleneck_level": r.bottleneck_level,
                "recommendations": r.recommendations,
            }
            for r in result.resources
        ],
        "critical_count": result.critical_count,
        "warning_count": result.warning_count,
        "total_resources": result.total_resources,
        "summary": result.summary,
        "recommendations": result.recommendations,
    }


@ccm_router.get("/projects/{project_id}/milestones")
async def list_milestones(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """
    Получить контрольные точки (milestones) проекта.

    Возвращает операции с is_milestone=true и их позиции на шкале.
    """
    proj = await db.execute(
        select(Project).where(Project.id == project_id, Project.tenant_id == tenant_id)
    )
    if not proj.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Проект не найден")

    ops_result = await db.execute(
        select(Operation).where(
            Operation.project_id == project_id,
            Operation.tenant_id == tenant_id,
            Operation.is_milestone == True,
        ).order_by(Operation.position)
    )
    milestones = ops_result.scalars().all()

    return {
        "project_id": str(project_id),
        "milestones": [
            {
                "id": str(m.id),
                "name": m.name,
                "position": m.position,
                "duration_base": float(m.duration_base),
                "is_critical": m.is_critical,
                "early_start": float(m.duration_base),  # placeholder — нужен CPM
                "early_finish": float(m.duration_base),
            }
            for m in milestones
        ],
        "count": len(milestones),
    }


@ccm_router.post("/projects/{project_id}/pert")
async def run_pert(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """
    PERT-анализ проекта.

    Использует поля to_optimistic, tm_likely, tp_pessimistic операций.
    Для операций без PERT-оценок используется детерминированная длительность.

    Возвращает: ожидаемые длительности, доверительные интервалы (±1σ, ±2σ).
    """
    from app.services.pert_monte_carlo import calculate_pert

    proj = await db.execute(
        select(Project).where(Project.id == project_id, Project.tenant_id == tenant_id)
    )
    if not proj.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Проект не найден")

    ops_result = await db.execute(
        select(Operation).where(
            Operation.project_id == project_id,
            Operation.tenant_id == tenant_id,
        )
    )
    operations = ops_result.scalars().all()

    if len(operations) < 2:
        raise HTTPException(status_code=400, detail="Минимум 2 операции для PERT-анализа")

    deps_result = await db.execute(
        select(OperationDependency).join(
            Operation, OperationDependency.predecessor_id == Operation.id
        ).where(Operation.project_id == project_id)
    )
    dependencies = deps_result.scalars().all()

    ops_dicts = [
        {
            "id": str(op.id),
            "name": op.name,
            "duration_base": float(op.duration_base),
            "to_optimistic": float(op.to_optimistic) if op.to_optimistic else None,
            "tm_likely": float(op.tm_likely) if op.tm_likely else None,
            "tp_pessimistic": float(op.tp_pessimistic) if op.tp_pessimistic else None,
        }
        for op in operations
    ]
    deps_dicts = [
        {
            "predecessor_id": str(d.predecessor_id),
            "successor_id": str(d.successor_id),
            "dependency_type": d.dependency_type,
            "lag_time": float(d.lag_time),
        }
        for d in dependencies
    ]

    result = calculate_pert(ops_dicts, deps_dicts)
    result.project_id = str(project_id)

    return {
        "project_id": result.project_id,
        "total_expected": round(result.total_expected, 2),
        "total_std_dev": round(result.total_std_dev, 2),
        "total_variance": round(result.total_variance, 2),
        "confidence_68": {
            "low": round(result.confidence_68_low, 2),
            "high": round(result.confidence_68_high, 2),
        },
        "confidence_95": {
            "low": round(result.confidence_95_low, 2),
            "high": round(result.confidence_95_high, 2),
        },
        "critical_path": result.critical_path,
        "critical_path_std_devs": [
            round(next(
                (o.std_dev for o in result.operations if o.id == nid), 0
            ), 2)
            for nid in result.critical_path
        ],
        "operations": [
            {
                "id": o.id,
                "name": o.name,
                "optimistic": o.optimistic,
                "most_likely": o.most_likely,
                "pessimistic": o.pessimistic,
                "expected": round(o.expected, 2),
                "std_dev": round(o.std_dev, 2),
            }
            for o in result.operations[:50]  # limit for payload size
        ],
        "warnings": result.warnings,
    }


@ccm_router.post("/projects/{project_id}/monte-carlo")
async def run_monte_carlo(
    project_id: UUID,
    iterations: int = Query(10000, ge=100, le=100000, description="Количество итераций"),
    seed: Optional[int] = Query(None, description="Сид для воспроизводимости"),
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """
    Монте-Карло симуляция проекта.

    Семплирует длительности из Beta-PERT распределения для каждой операции.
    Запускает CPM на каждой итерации. Возвращает распределение, процентили и S-кривую.

    Параметры:
    - iterations: количество итераций (100-100000, по умолчанию 10000)
    - seed: сид random для воспроизводимости
    """
    from app.services.pert_monte_carlo import run_monte_carlo as mc_run

    proj = await db.execute(
        select(Project).where(Project.id == project_id, Project.tenant_id == tenant_id)
    )
    if not proj.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Проект не найден")

    ops_result = await db.execute(
        select(Operation).where(
            Operation.project_id == project_id,
            Operation.tenant_id == tenant_id,
        )
    )
    operations = ops_result.scalars().all()

    if len(operations) < 2:
        raise HTTPException(status_code=400, detail="Минимум 2 операции для симуляции")

    deps_result = await db.execute(
        select(OperationDependency).join(
            Operation, OperationDependency.predecessor_id == Operation.id
        ).where(Operation.project_id == project_id)
    )
    dependencies = deps_result.scalars().all()

    ops_dicts = [
        {
            "id": str(op.id),
            "name": op.name,
            "duration_base": float(op.duration_base),
            "to_optimistic": float(op.to_optimistic) if op.to_optimistic else None,
            "tm_likely": float(op.tm_likely) if op.tm_likely else None,
            "tp_pessimistic": float(op.tp_pessimistic) if op.tp_pessimistic else None,
        }
        for op in operations
    ]
    deps_dicts = [
        {
            "predecessor_id": str(d.predecessor_id),
            "successor_id": str(d.successor_id),
            "dependency_type": d.dependency_type,
            "lag_time": float(d.lag_time),
        }
        for d in dependencies
    ]

    result = mc_run(ops_dicts, deps_dicts, iterations=iterations, seed=seed)
    result.project_id = str(project_id)

    # Сжимаем durations для передачи (гистограмма с шагом)
    durations_binned = _bin_durations(result.durations, bins=50)

    return {
        "project_id": result.project_id,
        "iterations": result.iterations,
        "deterministic_duration": result.deterministic_duration,
        "percentiles": {
            "p50": result.p50,
            "p80": result.p80,
            "p90": result.p90,
            "p95": result.p95,
            "p99": result.p99,
        },
        "mean": result.mean,
        "std_dev": result.std_dev,
        "min_duration": result.min_duration,
        "max_duration": result.max_duration,
        "s_curve": result.s_curve[:51],
        "histogram": durations_binned,
        "warnings": result.warnings,
    }


def _bin_durations(durations: list[float], bins: int = 50) -> list[dict]:
    """Сжатие списка длительностей в гистограмму."""
    if not durations or len(durations) < 2:
        return []
    d_min, d_max = durations[0], durations[-1]
    bin_width = (d_max - d_min) / bins if bins > 0 else 1
    result = []
    for i in range(bins):
        lo = d_min + i * bin_width
        hi = lo + bin_width
        count = sum(1 for d in durations if lo <= d < hi)
        # Последний бин включает максимум
        if i == bins - 1:
            count = sum(1 for d in durations if lo <= d <= d_max)
        if count > 0:
            result.append({"from": round(lo, 2), "to": round(hi, 2), "count": count})
    return result


@ccm_router.get("/projects/{project_id}/export-excel")
async def export_project_excel(
    project_id: UUID,
    include_pert: bool = Query(False, description="Включить PERT-лист"),
    include_monte_carlo: bool = Query(False, description="Включить Monte Carlo лист"),
    monte_carlo_iterations: int = Query(1000, ge=100, le=10000),
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """
    Экспорт проекта в Excel (.xlsx).

    Листы:
    - Ганта: операции с ES/EF/LS/LF, цветовое кодирование критического пути
    - CPM: расчётная таблица
    - Ресурсы: загрузка ресурсов с цветовым кодированием (>80% жёлтый, >95% красный)
    - PERT (опционально): доверительные интервалы
    - Monte Carlo (опционально): процентили, S-кривая
    """
    from app.services.cpm import calculate_cpm
    from app.services.excel_export import build_export_excel

    proj = await db.execute(
        select(Project).where(Project.id == project_id, Project.tenant_id == tenant_id)
    )
    project_row = proj.scalar_one_or_none()
    if not project_row:
        raise HTTPException(status_code=404, detail="Проект не найден")

    project_name = project_row.name

    # Загружаем всё
    ops_result = await db.execute(
        select(Operation).where(
            Operation.project_id == project_id,
            Operation.tenant_id == tenant_id,
        )
    )
    operations = ops_result.scalars().all()

    deps_result = await db.execute(
        select(OperationDependency).join(
            Operation, OperationDependency.predecessor_id == Operation.id
        ).where(Operation.project_id == project_id)
    )
    deps_list = deps_result.scalars().all()

    # CPM
    ops_dicts = [
        {"id": str(o.id), "name": o.name,
         "duration_base": float(o.duration_base),
         "setup_time": float(o.setup_time),
         "teardown_time": float(o.teardown_time)}
        for o in operations
    ]
    deps_dicts = [
        {"predecessor_id": str(d.predecessor_id),
         "successor_id": str(d.successor_id),
         "dependency_type": d.dependency_type,
         "lag_time": float(d.lag_time)}
        for d in deps_list
    ]

    cpm_result = None
    if ops_dicts:
        cpm_result = calculate_cpm(ops_dicts, deps_dicts)

    # Формируем операции с CPM-данными
    export_ops = []
    for op in operations:
        node = cpm_result.nodes.get(str(op.id)) if cpm_result else None
        export_ops.append({
            "id": str(op.id),
            "name": op.name,
            "duration_base": float(op.duration_base),
            "early_start": float(node.early_start) if node else 0,
            "early_finish": float(node.early_finish) if node else float(op.duration_base),
            "late_start": float(node.late_start) if node else 0,
            "late_finish": float(node.late_finish) if node else float(op.duration_base),
            "slack": float(node.total_float) if node else 0,
            "is_critical": bool(node.is_critical) if node else False,
        })

    export_deps = [
        {"predecessor_id": str(d.predecessor_id),
         "successor_id": str(d.successor_id),
         "dependency_type": d.dependency_type,
         "lag_time": float(d.lag_time)}
        for d in deps_list
    ]

    # PERT опционально
    pert_data = None
    if include_pert:
        from app.services.pert_monte_carlo import calculate_pert
        pert_ops = [
            {
                "id": str(op.id), "name": op.name,
                "duration_base": float(op.duration_base),
                "to_optimistic": float(op.to_optimistic) if op.to_optimistic else None,
                "tm_likely": float(op.tm_likely) if op.tm_likely else None,
                "tp_pessimistic": float(op.tp_pessimistic) if op.tp_pessimistic else None,
            }
            for op in operations
        ]
        try:
            pr = calculate_pert(pert_ops, deps_dicts)
            pert_data = {
                "total_expected": pr.total_expected,
                "total_std_dev": pr.total_std_dev,
                "total_variance": pr.total_variance,
                "confidence_68": {"low": pr.confidence_68_low, "high": pr.confidence_68_high},
                "confidence_95": {"low": pr.confidence_95_low, "high": pr.confidence_95_high},
                "critical_path": pr.critical_path,
            }
        except Exception:
            pass

    # Monte Carlo опционально
    mc_data = None
    if include_monte_carlo:
        from app.services.pert_monte_carlo import run_monte_carlo
        pert_ops = [
            {
                "id": str(op.id), "name": op.name,
                "duration_base": float(op.duration_base),
                "to_optimistic": float(op.to_optimistic) if op.to_optimistic else None,
                "tm_likely": float(op.tm_likely) if op.tm_likely else None,
                "tp_pessimistic": float(op.tp_pessimistic) if op.tp_pessimistic else None,
            }
            for op in operations
        ]
        try:
            mr = run_monte_carlo(pert_ops, deps_dicts, iterations=monte_carlo_iterations, seed=42)
            mc_data = {
                "iterations": mr.iterations,
                "deterministic_duration": mr.deterministic_duration,
                "mean": mr.mean,
                "std_dev": mr.std_dev,
                "min_duration": mr.min_duration,
                "max_duration": mr.max_duration,
                "p50": mr.p50,
                "p80": mr.p80,
                "p90": mr.p90,
                "p95": mr.p95,
                "p99": mr.p99,
            }
        except Exception:
            pass

    # Bottleneck для ресурсного листа
    export_resources = []
    try:
        from app.services.bottleneck import analyze_bottlenecks
        or_result = await db.execute(
            select(OperationResource).where(
                OperationResource.operation_id.in_(
                    select(Operation.id).where(
                        Operation.project_id == project_id,
                        Operation.tenant_id == tenant_id,
                    )
                )
            )
        )
        op_resources = or_result.scalars().all()

        res_result = await db.execute(
            select(Resource).where(Resource.tenant_id == tenant_id)
        )
        all_resources = res_result.scalars().all()

        if op_resources and all_resources:
            or_dicts = [
                {"operation_id": str(or_.operation_id),
                 "resource_id": str(or_.resource_id),
                 "capacity_demand": float(or_.capacity_demand)}
                for or_ in op_resources
            ]
            res_dicts = [
                {"id": str(r.id), "name": r.name, "resource_type": r.resource_type,
                 "capacity_per_unit": float(r.capacity_per_unit),
                 "capacity_unit": r.capacity_unit}
                for r in all_resources
            ]
            project_dur = float(cpm_result.total_duration) if cpm_result else sum(
                float(o.duration_base) for o in operations
            )
            bn_result = analyze_bottlenecks(ops_dicts, or_dicts, res_dicts, project_dur)
            export_resources = [
                {
                    "name": r.resource_name,
                    "load_percent": r.load_percent,
                    "bottleneck_level": r.bottleneck_level,
                    "assigned_operations": r.assigned_operations,
                    "recommendations": r.recommendations,
                }
                for r in bn_result.resources
            ]
    except Exception:
        pass

    xlsx_bytes = build_export_excel(
        operations=export_ops,
        dependencies=export_deps,
        resources=export_resources,
        project_name=project_name,
        include_pert=include_pert,
        pert_data=pert_data,
        monte_carlo_data=mc_data,
    )

    return StreamingResponse(
        io.BytesIO(xlsx_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f"attachment; filename=profyplan-export-{project_id}.xlsx"
        },
    )


@ccm_router.post("/projects/{project_id}/sync-google-sheets")
async def sync_to_google_sheets(
    project_id: UUID,
    spreadsheet_id: Optional[str] = Query(None, description="ID существующей таблицы"),
    spreadsheet_name: Optional[str] = Query(None, description="Имя новой таблицы"),
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """
    Синхронизация проекта в Google Sheets.

    Если spreadsheet_id передан — обновляет существующую таблицу.
    Иначе создаёт новую с именем spreadsheet_name (или авто-именем).

    Требует сервисный аккаунт Google Cloud.
    Установите GOOGLE_SHEETS_CREDENTIALS_JSON (путь к JSON-файлу) в docker-compose.

    Листы: Мета, Ганта, Ресурсы.
    """
    from app.services.cpm import calculate_cpm
    from app.services.google_sheets_sync import sync_to_sheets

    proj = await db.execute(
        select(Project).where(Project.id == project_id, Project.tenant_id == tenant_id)
    )
    project_row = proj.scalar_one_or_none()
    if not project_row:
        raise HTTPException(status_code=404, detail="Проект не найден")

    project_name = project_row.name

    # Загружаем CPM
    ops_result = await db.execute(
        select(Operation).where(
            Operation.project_id == project_id,
            Operation.tenant_id == tenant_id,
        )
    )
    operations = ops_result.scalars().all()

    deps_result = await db.execute(
        select(OperationDependency).join(
            Operation, OperationDependency.predecessor_id == Operation.id
        ).where(Operation.project_id == project_id)
    )
    deps_list = deps_result.scalars().all()

    ops_dicts = [
        {"id": str(o.id), "name": o.name,
         "duration_base": float(o.duration_base),
         "setup_time": float(o.setup_time),
         "teardown_time": float(o.teardown_time)}
        for o in operations
    ]
    deps_dicts = [
        {"predecessor_id": str(d.predecessor_id),
         "successor_id": str(d.successor_id),
         "dependency_type": d.dependency_type,
         "lag_time": float(d.lag_time)}
        for d in deps_list
    ]

    cpm_result = None
    if ops_dicts:
        cpm_result = calculate_cpm(ops_dicts, deps_dicts)

    export_ops = []
    for op in operations:
        node = cpm_result.nodes.get(str(op.id)) if cpm_result else None
        export_ops.append({
            "id": str(op.id),
            "name": op.name,
            "duration_base": float(op.duration_base),
            "early_start": float(node.early_start) if node else 0,
            "early_finish": float(node.early_finish) if node else float(op.duration_base),
            "late_start": float(node.late_start) if node else 0,
            "late_finish": float(node.late_finish) if node else float(op.duration_base),
            "slack": float(node.total_float) if node else 0,
            "is_critical": bool(node.is_critical) if node else False,
        })

    export_deps = [
        {"predecessor_id": str(d.predecessor_id),
         "successor_id": str(d.successor_id),
         "dependency_type": d.dependency_type,
         "lag_time": float(d.lag_time)}
        for d in deps_list
    ]

    # Resources
    export_resources = []
    try:
        from app.services.bottleneck import analyze_bottlenecks
        or_result = await db.execute(
            select(OperationResource).where(
                OperationResource.operation_id.in_(
                    select(Operation.id).where(
                        Operation.project_id == project_id,
                        Operation.tenant_id == tenant_id,
                    )
                )
            )
        )
        op_resources = or_result.scalars().all()
        res_result = await db.execute(
            select(Resource).where(Resource.tenant_id == tenant_id)
        )
        all_resources = res_result.scalars().all()
        if op_resources and all_resources:
            or_dicts = [
                {"operation_id": str(or_.operation_id),
                 "resource_id": str(or_.resource_id),
                 "capacity_demand": float(or_.capacity_demand)}
                for or_ in op_resources
            ]
            res_dicts = [
                {"id": str(r.id), "name": r.name, "resource_type": r.resource_type,
                 "capacity_per_unit": float(r.capacity_per_unit),
                 "capacity_unit": r.capacity_unit}
                for r in all_resources
            ]
            project_dur = float(cpm_result.total_duration) if cpm_result else sum(
                float(o.duration_base) for o in operations
            )
            bn_result = analyze_bottlenecks(ops_dicts, or_dicts, res_dicts, project_dur)
            export_resources = [
                {"name": r.resource_name, "load_percent": r.load_percent,
                 "bottleneck_level": r.bottleneck_level,
                 "assigned_operations": r.assigned_operations,
                 "recommendations": r.recommendations}
                for r in bn_result.resources
            ]
    except Exception:
        pass

    result = sync_to_sheets(
        operations=export_ops,
        dependencies=export_deps,
        resources=export_resources or None,
        project_name=project_name,
        spreadsheet_id=spreadsheet_id,
        spreadsheet_name=spreadsheet_name,
    )

    if result.errors:
        if "credentials" in str(result.errors[0]).lower():
            return {
                "status": "not_configured",
                "message": result.errors[0],
                "hint": "Установите GOOGLE_SHEETS_CREDENTIALS_JSON в docker-compose.yml",
            }
        raise HTTPException(status_code=500, detail="; ".join(result.errors))

    return {
        "status": "ok",
        "spreadsheet_id": result.spreadsheet_id,
        "spreadsheet_url": result.spreadsheet_url,
        "sheets_created": result.sheets_created,
        "rows_written": result.rows_written,
        "warnings": result.warnings,
    }


@ccm_router.get("/resource-usage")
async def resource_usage(
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    """Межпроектная сводка использования ресурсов (блок 2).

    По глобальным ресурсам (project_id NULL): в каких проектах используются
    (через ProjectResource/родительскую связь), суммарные часы операций маршрутов
    и число операций. is_shared = используется более чем в одном проекте
    (точка соприкосновения — кандидат на межпроектный конфликт)."""
    from collections import defaultdict
    from sqlalchemy import func
    from app.models.resource import Resource
    from app.models.routing import Routing, RoutingOperation
    from app.models.product_structure import ProductStructure
    from app.models.project import Project

    global_rows = (await db.execute(
        select(Resource).where(Resource.tenant_id == tenant_id, Resource.project_id.is_(None))
    )).scalars().all()
    globals_map = {str(r.id): r for r in global_rows}

    child_rows = (await db.execute(
        select(Resource).where(Resource.tenant_id == tenant_id, Resource.parent_id.isnot(None))
    )).scalars().all()
    parent_of = {str(r.id): str(r.parent_id) for r in child_rows}

    usage = defaultdict(lambda: {"hours": 0.0, "ops": 0, "projects": set()})
    rows = (await db.execute(
        select(
            RoutingOperation.resource_type_id,
            ProductStructure.project_id,
            func.sum(RoutingOperation.duration_hours),
            func.count(),
        )
        .join(Routing, RoutingOperation.routing_id == Routing.id)
        .join(ProductStructure, Routing.product_node_id == ProductStructure.id)
        .where(RoutingOperation.resource_type_id.isnot(None), Routing.tenant_id == tenant_id)
        .group_by(RoutingOperation.resource_type_id, ProductStructure.project_id)
    )).all()
    for rid, pid, hours, cnt in rows:
        if not rid:
            continue
        gid = parent_of.get(str(rid), str(rid))
        if gid in globals_map:
            u = usage[gid]
            u["hours"] += float(hours or 0)
            u["ops"] += int(cnt or 0)
            u["projects"].add(str(pid))

    proj_names = {str(x.id): x.name for x in (await db.execute(
        select(Project).where(Project.tenant_id == tenant_id)
    )).scalars().all()}

    out = []
    for gid, r in globals_map.items():
        u = usage.get(gid)
        projects = sorted([proj_names.get(p, p[:8]) for p in (u["projects"] if u else set())])
        out.append({
            "id": gid,
            "name": r.name,
            "type": r.resource_type,
            "capacity_per_unit": float(r.capacity_per_unit or 0),
            "capacity_unit": r.capacity_unit or "",
            "projects": projects,
            "project_count": len(projects),
            "total_hours": round(u["hours"], 2) if u else 0,
            "operation_count": u["ops"] if u else 0,
            "is_shared": len(projects) > 1,
        })
    out.sort(key=lambda x: (-x["is_shared"], -x["total_hours"]))
    return out
