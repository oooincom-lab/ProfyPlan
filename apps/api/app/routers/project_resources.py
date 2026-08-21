"""
Регистр ресурсов проекта (ProjectResource) — привязка ресурсов к проекту
с переопределением графика работы.
"""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_tenant_id
from app.models.project_resource import ProjectResource
from app.models.resource import Resource
from app.models.work_schedule import WorkSchedule
from app.schemas.project_resource import (
    ProjectResourceCreate,
    ProjectResourceOut,
    ProjectResourceUpdate,
)

router = APIRouter(prefix="/v1/projects/{project_id}/project-resources", tags=["project-resources"])


@router.get("", response_model=list[ProjectResourceOut])
async def list_assignments(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    stmt = (
        select(ProjectResource, Resource.name, WorkSchedule.name)
        .outerjoin(Resource, Resource.id == ProjectResource.resource_id)
        .outerjoin(WorkSchedule, WorkSchedule.id == ProjectResource.schedule_id)
        .where(
            ProjectResource.project_id == project_id,
            ProjectResource.tenant_id == tenant_id,
        )
        .order_by(Resource.name)
    )
    res = await db.execute(stmt)
    items = []
    for pr, rname, sname in res.all():
        items.append(
            ProjectResourceOut(
                id=str(pr.id),
                project_id=str(pr.project_id),
                resource_id=str(pr.resource_id),
                schedule_id=str(pr.schedule_id) if pr.schedule_id else None,
                capacity_share=pr.capacity_share,
                date_from=pr.date_from,
                date_to=pr.date_to,
                resource_name=rname,
                schedule_name=sname,
            )
        )
    return items


@router.post("", response_model=ProjectResourceOut, status_code=status.HTTP_201_CREATED)
async def assign_resource(
    project_id: UUID,
    body: ProjectResourceCreate,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    resource = (
        await db.execute(
            select(Resource).where(Resource.id == UUID(body.resource_id), Resource.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")

    dup = (
        await db.execute(
            select(ProjectResource).where(
                ProjectResource.project_id == project_id,
                ProjectResource.resource_id == UUID(body.resource_id),
                ProjectResource.tenant_id == tenant_id,
            )
        )
    ).scalar_one_or_none()
    if dup:
        raise HTTPException(status_code=409, detail="Ресурс уже привязан к проекту")

    pr = ProjectResource(
        tenant_id=tenant_id,
        project_id=project_id,
        resource_id=UUID(body.resource_id),
        schedule_id=UUID(body.schedule_id) if body.schedule_id else None,
        capacity_share=body.capacity_share,
        date_from=body.date_from,
        date_to=body.date_to,
    )
    db.add(pr)
    await db.commit()
    await db.refresh(pr)
    return ProjectResourceOut(
        id=str(pr.id),
        project_id=str(pr.project_id),
        resource_id=str(pr.resource_id),
        schedule_id=str(pr.schedule_id) if pr.schedule_id else None,
        capacity_share=pr.capacity_share,
        date_from=pr.date_from,
        date_to=pr.date_to,
        resource_name=resource.name,
        schedule_name=None,
    )


@router.put("/{pr_id}", response_model=ProjectResourceOut)
async def update_assignment(
    project_id: UUID,
    pr_id: UUID,
    body: ProjectResourceUpdate,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    pr = (
        await db.execute(
            select(ProjectResource).where(
                ProjectResource.id == pr_id,
                ProjectResource.project_id == project_id,
                ProjectResource.tenant_id == tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not pr:
        raise HTTPException(status_code=404, detail="Not found")

    data = body.model_dump(exclude_unset=True)
    if "schedule_id" in data:
        pr.schedule_id = UUID(data["schedule_id"]) if data["schedule_id"] else None
    if "capacity_share" in data:
        pr.capacity_share = data["capacity_share"]
    if "date_from" in data:
        pr.date_from = data["date_from"]
    if "date_to" in data:
        pr.date_to = data["date_to"]

    await db.commit()
    await db.refresh(pr)

    rname = (await db.execute(select(Resource.name).where(Resource.id == pr.resource_id, Resource.tenant_id == tenant_id))).scalar_one_or_none()
    sname = None
    if pr.schedule_id:
        sname = (await db.execute(select(WorkSchedule.name).where(WorkSchedule.id == pr.schedule_id, WorkSchedule.tenant_id == tenant_id))).scalar_one_or_none()

    return ProjectResourceOut(
        id=str(pr.id),
        project_id=str(pr.project_id),
        resource_id=str(pr.resource_id),
        schedule_id=str(pr.schedule_id) if pr.schedule_id else None,
        capacity_share=pr.capacity_share,
        date_from=pr.date_from,
        date_to=pr.date_to,
        resource_name=rname,
        schedule_name=sname,
    )


@router.delete("/{pr_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unassign_resource(
    project_id: UUID,
    pr_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    pr = (
        await db.execute(
            select(ProjectResource).where(
                ProjectResource.id == pr_id,
                ProjectResource.project_id == project_id,
                ProjectResource.tenant_id == tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not pr:
        raise HTTPException(status_code=404, detail="Not found")
    await db.delete(pr)
    await db.commit()
