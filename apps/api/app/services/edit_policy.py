"""Политика редактирования данных, импортированных из 1С."""
from __future__ import annotations

from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.production_order import ProductionOrder
from app.models.project import Project
from app.models.tenant import Tenant

POLICIES = {"planning", "strict_1c"}


async def get_edit_policy(db: AsyncSession, tenant_id: UUID) -> str:
    tenant = await db.get(Tenant, tenant_id)
    return getattr(tenant, "sync_edit_policy", "planning") or "planning"


def _is_imported(obj) -> bool:
    return bool(getattr(obj, "ext_uid", None) or getattr(obj, "source", None) == "1c")


def _locked() -> HTTPException:
    return HTTPException(
        status_code=409,
        detail={
            "code": "SYNC_LOCKED",
            "message": "Данные получены из 1С. Изменяйте их в 1С; локальные изменения запрещены.",
        },
    )


async def require_imported_editable(db: AsyncSession, tenant_id: UUID, obj) -> None:
    if await get_edit_policy(db, tenant_id) == "strict_1c" and _is_imported(obj):
        raise _locked()


async def require_project_editable(db: AsyncSession, tenant_id: UUID, project_id: UUID) -> None:
    if await get_edit_policy(db, tenant_id) != "strict_1c":
        return
    project = await db.get(Project, project_id)
    if project is not None and project.tenant_id == tenant_id and _is_imported(project):
        raise _locked()


async def require_order_editable(db: AsyncSession, tenant_id: UUID, order_id: UUID) -> None:
    if await get_edit_policy(db, tenant_id) != "strict_1c":
        return
    order = await db.get(ProductionOrder, order_id)
    if order is not None and order.tenant_id == tenant_id and _is_imported(order):
        raise _locked()
