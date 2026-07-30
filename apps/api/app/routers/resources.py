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
    return [ResourceOut.model_validate(r) for r in result.scalars().all()]


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
        **body.model_dump(exclude={"parent_id"}),
        parent_id=UUID(body.parent_id) if body.parent_id else None,
    )
    db.add(resource)
    await db.commit()
    await db.refresh(resource)
    return ResourceOut.model_validate(resource)


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
    return ResourceOut.model_validate(resource)


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

    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(resource, key, value)

    await db.commit()
    await db.refresh(resource)
    return ResourceOut.model_validate(resource)


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
