"""
CRUD-роутер для ресурсов.
"""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_tenant_id
from app.models.resource import Resource
from app.schemas.resource import ResourceCreate, ResourceOut, ResourceUpdate

router = APIRouter(prefix="/v1/projects/{project_id}/resources", tags=["resources"])


def _to_out(r: Resource) -> ResourceOut:
    return ResourceOut(
        id=str(r.id),
        project_id=str(r.project_id) if r.project_id else None,
        name=r.name,
        parent_id=str(r.parent_id) if r.parent_id else None,
        resource_type=r.resource_type,
        capacity_per_unit=r.capacity_per_unit,
        capacity_unit=r.capacity_unit,
        unit=r.unit,
        country_code=r.country_code,
        schedule_id=str(r.schedule_id) if r.schedule_id else None,
        is_active=r.is_active,
    )


@router.get("", response_model=list[ResourceOut])
async def list_resources(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    result = await db.execute(
        select(Resource).where(
            Resource.project_id == project_id,
            Resource.tenant_id == tenant_id,
        )
    )
    items = []
    for r in result.scalars().all():
        d = {k: str(v) if isinstance(v, UUID) else v for k, v in r.__dict__.items() if not k.startswith('_')}
        items.append(ResourceOut(**d))
    return items


@router.post("", response_model=ResourceOut, status_code=status.HTTP_201_CREATED)
async def create_resource(
    project_id: UUID,
    body: ResourceCreate,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    resource = Resource(
        tenant_id=tenant_id,
        project_id=project_id,
        schedule_id=UUID(body.schedule_id) if body.schedule_id else None,
        **body.model_dump(exclude={"parent_id", "schedule_id"}),
        parent_id=UUID(body.parent_id) if body.parent_id else None,
    )
    db.add(resource)
    await db.commit()
    await db.refresh(resource)
    return _to_out(resource)


@router.get("/{resource_id}", response_model=ResourceOut)
async def get_resource(
    project_id: UUID,
    resource_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    result = await db.execute(
        select(Resource).where(
            Resource.id == resource_id,
            Resource.project_id == project_id,
            Resource.tenant_id == tenant_id,
        )
    )
    resource = result.scalar_one_or_none()
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")
    return _to_out(resource)


@router.put("/{resource_id}", response_model=ResourceOut)
async def update_resource(
    project_id: UUID,
    resource_id: UUID,
    body: ResourceUpdate,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    result = await db.execute(
        select(Resource).where(
            Resource.id == resource_id,
            Resource.project_id == project_id,
            Resource.tenant_id == tenant_id,
        )
    )
    resource = result.scalar_one_or_none()
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")

    data = body.model_dump(exclude_unset=True)
    if "schedule_id" in data:
        data["schedule_id"] = UUID(data["schedule_id"]) if data["schedule_id"] else None
    for key, value in data.items():
        setattr(resource, key, value)

    await db.commit()
    await db.refresh(resource)
    return _to_out(resource)


@router.delete("/{resource_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_resource(
    project_id: UUID,
    resource_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    result = await db.execute(
        select(Resource).where(
            Resource.id == resource_id,
            Resource.project_id == project_id,
            Resource.tenant_id == tenant_id,
        )
    )
    resource = result.scalar_one_or_none()
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")
    await db.delete(resource)
    await db.commit()


