"""
CRUD-роутер для операций и зависимостей.
"""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_tenant_id
from app.models.operation import Operation, OperationDependency
from app.schemas.operation import (
    DependencyCreate,
    DependencyOut,
    OperationCreate,
    OperationOut,
    OperationUpdate,
)

router = APIRouter(prefix="/v1/projects/{project_id}/operations", tags=["operations"])


# --- Operations CRUD ---

@router.get("", response_model=list[OperationOut])
async def list_operations(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    result = await db.execute(
        select(Operation)
        .where(
            Operation.project_id == project_id,
            Operation.tenant_id == tenant_id,
        )
        .order_by(Operation.position)
    )
    return [OperationOut.model_validate(o) for o in result.scalars().all()]


@router.post("", response_model=OperationOut, status_code=status.HTTP_201_CREATED)
async def create_operation(
    project_id: UUID,
    body: OperationCreate,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    operation = Operation(
        tenant_id=tenant_id,
        project_id=project_id,
        **body.model_dump(),
    )
    db.add(operation)
    await db.commit()
    await db.refresh(operation)
    return OperationOut.model_validate(operation)


@router.get("/{operation_id}", response_model=OperationOut)
async def get_operation(
    project_id: UUID,
    operation_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    result = await db.execute(
        select(Operation).where(
            Operation.id == operation_id,
            Operation.project_id == project_id,
            Operation.tenant_id == tenant_id,
        )
    )
    op = result.scalar_one_or_none()
    if not op:
        raise HTTPException(status_code=404, detail="Operation not found")
    return OperationOut.model_validate(op)


@router.put("/{operation_id}", response_model=OperationOut)
async def update_operation(
    project_id: UUID,
    operation_id: UUID,
    body: OperationUpdate,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    result = await db.execute(
        select(Operation).where(
            Operation.id == operation_id,
            Operation.project_id == project_id,
            Operation.tenant_id == tenant_id,
        )
    )
    op = result.scalar_one_or_none()
    if not op:
        raise HTTPException(status_code=404, detail="Operation not found")

    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(op, key, value)

    await db.commit()
    await db.refresh(op)
    return OperationOut.model_validate(op)


@router.delete("/{operation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_operation(
    project_id: UUID,
    operation_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    result = await db.execute(
        select(Operation).where(
            Operation.id == operation_id,
            Operation.project_id == project_id,
            Operation.tenant_id == tenant_id,
        )
    )
    op = result.scalar_one_or_none()
    if not op:
        raise HTTPException(status_code=404, detail="Operation not found")
    await db.delete(op)
    await db.commit()


# --- Dependencies ---

dep_router = APIRouter(
    prefix="/v1/projects/{project_id}/operation-dependencies",
    tags=["dependencies"],
)


@dep_router.get("", response_model=list[DependencyOut])
async def list_dependencies(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Все зависимости в проекте."""
    result = await db.execute(
        select(OperationDependency).join(
            Operation, OperationDependency.predecessor_id == Operation.id
        ).where(Operation.project_id == project_id)
    )
    return [DependencyOut.model_validate(d) for d in result.scalars().all()]


@dep_router.post("", response_model=DependencyOut, status_code=status.HTTP_201_CREATED)
async def create_dependency(
    project_id: UUID,
    body: DependencyCreate,
    db: AsyncSession = Depends(get_db),
):
    """Создать связь между операциями."""
    dep = OperationDependency(**body.model_dump())
    db.add(dep)
    await db.commit()
    await db.refresh(dep)
    return DependencyOut.model_validate(dep)


@dep_router.delete("/{dep_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_dependency(
    project_id: UUID,
    dep_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(OperationDependency).where(OperationDependency.id == dep_id)
    )
    dep = result.scalar_one_or_none()
    if not dep:
        raise HTTPException(status_code=404, detail="Dependency not found")
    await db.delete(dep)
    await db.commit()
