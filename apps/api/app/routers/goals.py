"""Цели по областям (блок 6.30 плана; Дополнение 16).

Цель области — договорная и рабочая даты плюс признак фиксации. Области: проект, куст/группа,
ветка (заказ верхнего уровня), заказ. Хранение одно на все области; флажок фиксации пишется
только на той строке, где его поставил человек — у подчинённых он выводится на стороне интерфейса.
"""
from datetime import date
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_tenant_id
from app.models.goal import Goal
from app.models.project import Project
from app.schemas.goal import GoalList, GoalOut, GoalSet

goals_router = APIRouter(tags=["goals"])


async def _project_or_404(db: AsyncSession, project_id: UUID, tenant_id: UUID) -> Project:
    project = (
        await db.execute(select(Project).where(Project.id == project_id, Project.tenant_id == tenant_id))
    ).scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Проект не найден")
    return project


@goals_router.get("/v1/projects/{project_id}/goals", response_model=GoalList)
async def list_goals(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """Все цели проекта: по областям. Проектная цель — запись «область = проект»."""
    await _project_or_404(db, project_id, tenant_id)
    rows = (
        await db.execute(select(Goal).where(Goal.project_id == project_id, Goal.tenant_id == tenant_id))
    ).scalars().all()
    return GoalList(items=[GoalOut.model_validate(r) for r in rows])


@goals_router.put("/v1/projects/{project_id}/goals", response_model=GoalOut)
async def set_goal(
    project_id: UUID,
    body: GoalSet,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """Поставить или изменить цель области (создаёт запись, если её ещё нет)."""
    await _project_or_404(db, project_id, tenant_id)

    goal = (
        await db.execute(
            select(Goal).where(
                Goal.project_id == project_id,
                Goal.tenant_id == tenant_id,
                Goal.area_type == body.area_type,
                Goal.area_ref.is_(None) if body.area_ref is None else Goal.area_ref == body.area_ref,
            )
        )
    ).scalar_one_or_none()

    if not goal:
        goal = Goal(
            tenant_id=tenant_id,
            project_id=project_id,
            area_type=body.area_type,
            area_ref=body.area_ref,
        )
        db.add(goal)

    data = body.model_dump(exclude_unset=True)
    for key in ("contract_date", "working_date", "contract_source", "working_source", "fixed"):
        if key in data:
            setattr(goal, key, data[key])
    if "contract_date" in data and "contract_source" not in data and data["contract_date"] is not None:
        goal.contract_source = "manual"
    if "working_date" in data and "working_source" not in data and data["working_date"] is not None:
        goal.working_source = "manual"

    await db.commit()
    await db.refresh(goal)
    return GoalOut.model_validate(goal)
