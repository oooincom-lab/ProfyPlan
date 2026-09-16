"""Пакетное изменение состояния записей справочников (архив / возврат из архива).

Один эндпоинт для всех справочников: клиент передаёт имя справочника, набор id и
целевое состояние. Поддерживаются только сущности, у которых есть поле is_active.
Благодаря этому общая таблица справочников (DirectoryTable) не знает деталей
каждого справочника и работает с архивом одинаково везде.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_tenant_id, get_db
from app.models.catalog_operation import CatalogOperation
from app.models.counterparty import Counterparty
from app.models.department import Department
from app.models.nomenclature import Nomenclature
from app.models.organization import Organization
from app.models.project_stage import ProjectStage
from app.models.resource import Resource
from app.models.unit import Unit
from app.models.work_schedule import WorkSchedule

router = APIRouter(prefix="/v1/directory", tags=["directory"])

# Справочники, поддерживающие архив (у модели есть поле is_active).
# Ключи совпадают с именем сущности, которое приходит из интерфейса.
ARCHIVE_MODELS = {
    "nomenclature": Nomenclature,
    "units": Unit,
    "unit": Unit,
    "counterparties": Counterparty,
    "counterparty": Counterparty,
    "organizations": Organization,
    "organization": Organization,
    "resources": Resource,
    "resource": Resource,
    "departments": Department,
    "department": Department,
    "stages": ProjectStage,
    "stage": ProjectStage,
    "work-schedules": WorkSchedule,
    "work_schedules": WorkSchedule,
    "operations": CatalogOperation,
    "catalog-operations": CatalogOperation,
    "catalog_operation": CatalogOperation,
}


def is_archivable(entity: str) -> bool:
    return entity in ARCHIVE_MODELS


class BulkStateIn(BaseModel):
    entity: str
    ids: list[uuid.UUID]
    is_active: bool


class BulkStateOut(BaseModel):
    updated: int
    skipped: int
    total: int


@router.get("/archivable")
async def archivable_entities():
    """Список справочников, для которых доступен архив."""
    return {"entities": sorted(set(ARCHIVE_MODELS.keys()))}


@router.patch("/bulk/state", response_model=BulkStateOut)
async def bulk_state(
    body: BulkStateIn,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    """Убрать в архив или вернуть из архива сразу несколько записей любого справочника."""
    model = ARCHIVE_MODELS.get(body.entity)
    if model is None:
        raise HTTPException(400, "Архив не поддерживается для «%s»" % body.entity)
    if not body.ids:
        return BulkStateOut(updated=0, skipped=0, total=0)

    rows = (await db.execute(select(model).where(
        model.tenant_id == tenant_id,
        model.id.in_(body.ids),
    ))).scalars().all()

    changed = 0
    for row in rows:
        if bool(row.is_active) != bool(body.is_active):
            row.is_active = bool(body.is_active)
            changed += 1
    await db.commit()
    return BulkStateOut(updated=changed, skipped=max(0, len(body.ids) - len(rows)), total=len(rows))
