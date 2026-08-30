"""CRUD регистра «Этапы проекта» (Шаг 2 плана v2.15).

Список и создание — вложенными путями проекта:
  GET  /v1/projects/{project_id}/stages
  POST /v1/projects/{project_id}/stages
Изменение/удаление — плоскими:
  PATCH  /v1/project-stages/{stage_id}
  DELETE /v1/project-stages/{stage_id}
"""
import uuid
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_tenant_id
from app.models.project import Project
from app.models.project_stage import ProjectStage
from app.schemas.project_stage import (
    ProjectStageCreate,
    ProjectStageOut,
    ProjectStageUpdate,
)

router = APIRouter(prefix="/v1", tags=["project-stages"])


async def _stage_by_id(
    stage_id: str, tenant_id: str, db: AsyncSession
) -> ProjectStage:
    res = await db.execute(
        select(ProjectStage).where(
            ProjectStage.id == stage_id, ProjectStage.tenant_id == tenant_id
        )
    )
    item = res.scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Этап не найден")
    return item


async def _assert_project(
    project_id: str, tenant_id: str, db: AsyncSession
) -> Project:
    res = await db.execute(
        select(Project).where(
            Project.id == project_id, Project.tenant_id == tenant_id
        )
    )
    proj = res.scalar_one_or_none()
    if not proj:
        raise HTTPException(404, "Проект не найден")
    return proj


@router.get("/projects/{project_id}/stages", response_model=list[ProjectStageOut])
async def list_stages(
    project_id: str,
    search: str | None = None,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(ProjectStage).where(
        ProjectStage.tenant_id == tenant_id,
        ProjectStage.project_id == project_id,
    )
    if search:
        like = f"%{search.strip()}%"
        stmt = stmt.where(ProjectStage.name.ilike(like))
    stmt = stmt.order_by(ProjectStage.position, ProjectStage.name)
    res = await db.execute(stmt)
    return res.scalars().all()


@router.post("/projects/{project_id}/stages", response_model=ProjectStageOut, status_code=201)
async def create_stage(
    project_id: str,
    body: ProjectStageCreate,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    await _assert_project(project_id, tenant_id, db)
    position = body.position
    if position is None:
        res = await db.execute(
            select(func.max(ProjectStage.position)).where(
                ProjectStage.tenant_id == tenant_id,
                ProjectStage.project_id == project_id,
            )
        )
        position = (res.scalar() or -1) + 1
    item = ProjectStage(
        id=uuid4(),
        tenant_id=tenant_id,
        project_id=project_id,
        name=body.name.strip(),
        code=body.code,
        position=position,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


@router.patch("/project-stages/{stage_id}", response_model=ProjectStageOut)
async def update_stage(
    stage_id: str,
    body: ProjectStageUpdate,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    item = await _stage_by_id(stage_id, tenant_id, db)
    renamed = False
    if body.name is not None and body.name != item.name:
        renamed = True
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(item, k, v)
    await db.commit()
    await db.refresh(item)
    # Денормализация: переименование этапа обновляет stage_name в операциях маршрутов
    if renamed:
        from sqlalchemy import update as sa_update
        from app.models.routing import RoutingOperation
        await db.execute(
            sa_update(RoutingOperation)
            .where(RoutingOperation.stage_id == item.id)
            .values(stage_name=item.name)
        )
        await db.commit()
    return item


@router.delete("/project-stages/{stage_id}", status_code=204)
async def delete_stage(
    stage_id: str,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    item = await _stage_by_id(stage_id, tenant_id, db)
    await db.delete(item)
    await db.commit()
