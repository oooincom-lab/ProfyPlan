"""
CRUD-роутер для операций и зависимостей.
"""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_tenant_id
from app.models.operation import Operation, OperationDependency, OperationResource
from app.schemas.operation import (
    DependencyCreate,
    DependencyOut,
    OperationCreate,
    OperationOut,
    OperationUpdate,
    OperationResourceCreate,
    OperationResourceOut,
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
    items = []; [items.append(OperationOut(id=str(o.id), project_id=str(o.project_id), name=o.name, duration_base=o.duration_base, duration_unit=o.duration_unit, setup_time=o.setup_time, teardown_time=o.teardown_time, to_optimistic=o.to_optimistic, tm_likely=o.tm_likely, tp_pessimistic=o.tp_pessimistic, position=o.position, is_critical=o.is_critical)) for o in result.scalars().all()]; return items


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
    return OperationOut(id=str(operation.id), project_id=str(operation.project_id), name=operation.name, duration_base=operation.duration_base, duration_unit=operation.duration_unit, setup_time=operation.setup_time, teardown_time=operation.teardown_time, to_optimistic=operation.to_optimistic, tm_likely=operation.tm_likely, tp_pessimistic=operation.tp_pessimistic, position=operation.position, is_critical=operation.is_critical)


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
    return OperationOut(id=str(op.id), project_id=str(op.project_id), name=op.name, duration_base=op.duration_base, duration_unit=op.duration_unit, setup_time=op.setup_time, teardown_time=op.teardown_time, to_optimistic=op.to_optimistic, tm_likely=op.tm_likely, tp_pessimistic=op.tp_pessimistic, position=op.position, is_critical=op.is_critical)


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
    return OperationOut(id=str(op.id), project_id=str(op.project_id), name=op.name, duration_base=op.duration_base, duration_unit=op.duration_unit, setup_time=op.setup_time, teardown_time=op.teardown_time, to_optimistic=op.to_optimistic, tm_likely=op.tm_likely, tp_pessimistic=op.tp_pessimistic, position=op.position, is_critical=op.is_critical)


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
    return [
        DependencyOut(
            id=str(d.id),
            predecessor_id=str(d.predecessor_id),
            successor_id=str(d.successor_id),
            dependency_type=d.dependency_type,
            lag_time=d.lag_time,
            lag_unit=d.lag_unit,
        )
        for d in result.scalars().all()
    ]


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
    return DependencyOut(
        id=str(dep.id),
        predecessor_id=str(dep.predecessor_id),
        successor_id=str(dep.successor_id),
        dependency_type=dep.dependency_type,
        lag_time=dep.lag_time,
        lag_unit=dep.lag_unit,
    )


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


# --- Resource Assignments per Operation ---

@router.get("/{operation_id}/resources", response_model=list[OperationResourceOut])
async def list_operation_resources(
    project_id: UUID,
    operation_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """Список ресурсов, назначенных на операцию."""
    # Verify operation belongs to project
    op_result = await db.execute(
        select(Operation).where(
            Operation.id == operation_id,
            Operation.project_id == project_id,
            Operation.tenant_id == tenant_id,
        )
    )
    if not op_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Operation not found")

    result = await db.execute(
        select(OperationResource).where(
            OperationResource.operation_id == operation_id
        )
    )
    items = []
    for r in result.scalars().all():
        items.append(OperationResourceOut(id=str(r.id), operation_id=str(r.operation_id), resource_id=str(r.resource_id), role=r.role, efficiency_factor=r.efficiency_factor, capacity_demand=r.capacity_demand, duration_override=r.duration_override, setup_time_override=r.setup_time_override, teardown_time_override=r.teardown_time_override, priority=r.priority))
    return items


@router.post("/{operation_id}/resources", response_model=OperationResourceOut, status_code=status.HTTP_201_CREATED)
async def assign_resource_to_operation(
    project_id: UUID,
    operation_id: UUID,
    body: OperationResourceCreate,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """Назначить ресурс на операцию."""
    # Verify operation
    op_result = await db.execute(
        select(Operation).where(
            Operation.id == operation_id,
            Operation.project_id == project_id,
            Operation.tenant_id == tenant_id,
        )
    )
    if not op_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Operation not found")

    assignment = OperationResource(
        operation_id=operation_id,
        **body.model_dump(),
    )
    db.add(assignment)
    await db.commit()
    await db.refresh(assignment)
    return OperationResourceOut(id=str(assignment.id), operation_id=str(assignment.operation_id), resource_id=str(assignment.resource_id), role=assignment.role, efficiency_factor=assignment.efficiency_factor, capacity_demand=assignment.capacity_demand, duration_override=assignment.duration_override, setup_time_override=assignment.setup_time_override, teardown_time_override=assignment.teardown_time_override, priority=assignment.priority)


@router.delete("/{operation_id}/resources/{assignment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_resource_assignment(
    project_id: UUID,
    operation_id: UUID,
    assignment_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """Снять назначение ресурса с операции."""
    result = await db.execute(
        select(OperationResource).where(
            OperationResource.id == assignment_id,
            OperationResource.operation_id == operation_id,
        )
    )
    assignment = result.scalar_one_or_none()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    await db.delete(assignment)
    await db.commit()
