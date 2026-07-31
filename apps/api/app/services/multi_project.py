"""
Multi-Project CPM: объединение нескольких проектов в единый граф.
"""
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.operation import Operation, OperationDependency
from app.models.plan_version import InterProjectDependency
from app.services.cpm import (
    CPMResult,
    Dependency,
    OperationNode,
    calculate_cpm,
)


@dataclass
class MergedProjectResult:
    """Результат объединения нескольких проектов."""
    projects: list[UUID]
    nodes: dict[str, OperationNode]
    critical_path: list[str]
    total_duration: Decimal
    node_count: int
    critical_count: int
    inter_project_deps_count: int


async def merge_projects(
    db: AsyncSession,
    project_ids: list[UUID],
    tenant_id: UUID,
) -> MergedProjectResult:
    """
    Объединить несколько проектов в единый CPM-граф и выполнить расчёт.

    Шаги:
    1. Загрузить все операции и зависимости по проектам
    2. Добавить межпроектные зависимости из InterProjectDependency
    3. Запустить CPM-расчёт на объединённом графе
    """
    # 1. Загружаем операции всех проектов
    all_operations = []
    all_deps = []

    for pid in project_ids:
        ops_result = await db.execute(
            select(Operation).where(
                Operation.project_id == pid,
                Operation.tenant_id == tenant_id,
            )
        )
        ops = ops_result.scalars().all()

        deps_result = await db.execute(
            select(OperationDependency).where(
                OperationDependency.predecessor_id.in_(
                    select(Operation.id).where(
                        Operation.project_id == pid,
                        Operation.tenant_id == tenant_id,
                    )
                )
            )
        )
        deps = deps_result.scalars().all()

        all_operations.extend(ops)
        all_deps.extend(deps)

    if len(all_operations) < 2:
        raise ValueError("Для сводного расчёта CPM необходимо минимум 2 операции")

    # Конвертируем в словари для движка
    ops_dicts = [
        {
            "id": str(op.id),
            "name": op.name,
            "duration_base": float(op.duration_base),
            "setup_time": float(op.setup_time),
            "teardown_time": float(op.teardown_time),
        }
        for op in all_operations
    ]

    deps_dicts = [
        {
            "predecessor_id": str(dep.predecessor_id),
            "successor_id": str(dep.successor_id),
            "dependency_type": dep.dependency_type,
            "lag_time": float(dep.lag_time),
        }
        for dep in all_deps
    ]

    # 2. Добавляем межпроектные зависимости
    inter_deps_result = await db.execute(
        select(InterProjectDependency).where(
            InterProjectDependency.source_project_id.in_(project_ids),
            InterProjectDependency.target_project_id.in_(project_ids),
        )
    )
    inter_deps = inter_deps_result.scalars().all()

    for idep in inter_deps:
        if idep.source_operation_id and idep.target_operation_id:
            deps_dicts.append(
                {
                    "predecessor_id": str(idep.source_operation_id),
                    "successor_id": str(idep.target_operation_id),
                    "dependency_type": idep.dependency_type,
                    "lag_time": float(idep.lag_hours),
                }
            )

    # 3. Расчёт CPM
    result = calculate_cpm(ops_dicts, deps_dicts)

    return MergedProjectResult(
        projects=project_ids,
        nodes=result.nodes,
        critical_path=result.critical_path,
        total_duration=result.total_duration,
        node_count=len(result.nodes),
        critical_count=len(result.critical_path),
        inter_project_deps_count=len(inter_deps),
    )


def format_merged_result(result: MergedProjectResult) -> dict:
    """Форматирует MergedProjectResult в JSON-ответ."""
    nodes = []
    for nid, node in result.nodes.items():
        nodes.append(
            {
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
            }
        )

    return {
        "projects": [str(p) for p in result.projects],
        "method": "Multi-Project CPM",
        "total_duration": float(result.total_duration),
        "critical_path": result.critical_path,
        "nodes": nodes,
        "node_count": result.node_count,
        "critical_count": result.critical_count,
        "inter_project_deps": result.inter_project_deps_count,
    }
