"""Очередь изменений имён из внешней системы."""
from __future__ import annotations

from typing import Optional
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.counterparty import Counterparty
from app.models.department import Department
from app.models.nomenclature import Nomenclature
from app.models.organization import Organization
from app.models.project import Project
from app.models.resource import Resource
from app.models.warehouse import Warehouse

ENTITY_MODELS = {
    "project": (Project, "Проект"),
    "nomenclature": (Nomenclature, "Номенклатура"),
    "counterparty": (Counterparty, "Контрагент"),
    "department": (Department, "Подразделение"),
    "resource": (Resource, "Ресурс"),
    "organization": (Organization, "Организация"),
    "warehouse": (Warehouse, "Склад"),
}


def _label(entity_type: str) -> str:
    return ENTITY_MODELS.get(entity_type, (None, entity_type))[1]


async def list_name_changes(db: AsyncSession, tenant_id: UUID) -> list[dict]:
    items: list[dict] = []
    for entity_type, (model, _) in ENTITY_MODELS.items():
        rows = (await db.execute(
            select(model).where(
                model.tenant_id == tenant_id,
                model.name_overridden.is_(True),
                model.external_name.is_not(None),
                or_(model.external_name_ack.is_(None), model.external_name != model.external_name_ack),
            ).order_by(model.name.asc()).limit(200)
        )).scalars().all()
        for obj in rows:
            items.append({
                "entity_type": entity_type,
                "entity_label": _label(entity_type),
                "id": str(obj.id),
                "name": obj.name,
                "external_name": obj.external_name,
                "external_revision": getattr(obj, "external_revision", None),
            })
    return items


async def decide_name_change(
    db: AsyncSession,
    tenant_id: UUID,
    entity_type: str,
    entity_id: UUID,
    accept: bool,
) -> Optional[dict]:
    entry = ENTITY_MODELS.get(entity_type)
    if entry is None:
        return None
    model = entry[0]
    obj = (await db.execute(
        select(model).where(model.id == entity_id, model.tenant_id == tenant_id)
    )).scalars().first()
    if obj is None:
        return None
    external_name = getattr(obj, "external_name", None)
    if accept:
        if not external_name:
            return None
        obj.name = external_name
        obj.external_name_ack = external_name
        obj.name_overridden = False
    else:
        obj.external_name_ack = external_name
        obj.name_overridden = True
    await db.commit()
    return {
        "entity_type": entity_type,
        "id": str(obj.id),
        "name": obj.name,
        "external_name": external_name,
        "name_overridden": bool(obj.name_overridden),
    }
