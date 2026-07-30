"""
Роутер планирования: запуск CPM-расчёта, проверка статуса, получение результата.
"""
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_tenant_id
from app.models.operation import Operation, OperationDependency
from app.models.project import Project
from app.services.cpm import CPMResult, calculate_cpm

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
