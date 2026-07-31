"""
CCM-роутер: multi-project merge, BOM-развёртка, resource leveling, forecast.
"""
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_tenant_id
from app.models.operation import Operation, OperationDependency
from app.models.project import Project
from app.models.plan_version import PlanBaseline, ActualExecution
from app.services.multi_project import merge_projects, format_merged_result
from app.services.resource_leveling import resource_leveling_sgs, format_leveling_result
from app.services.forecast import recalculate_forecast, format_forecast_result

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
