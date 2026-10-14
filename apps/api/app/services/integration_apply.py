"""Конвейер обработки входящей очереди обмена (срез 2, 14.10.2026).

Применяет принятые пакеты к справочникам ProfyPlan:
- nomenclature  → Номенклатура (upsert по ext_id → код → имя);
- counterparty  → Контрагенты (upsert по external_code → ИНН → имя);
- department    → Подразделения (upsert по коду → имени);
- resource      → Ресурсы (upsert по ext_id → имени);
- project       → Проекты (только сопоставление; отсутствующие — в «пропущено» с пояснением).

Сопоставление — по внешним идентификаторам (ext_id/код), никогда по порядку; каждое
применение фиксируется в статусе элемента очереди (applied/skipped/error).
"""
from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.counterparty import Counterparty
from app.models.department import Department
from app.models.integration import ExchangeInboxItem
from app.models.nomenclature import Nomenclature
from app.models.project import Project
from app.models.resource import Resource

NTYPE_MAP = {
    "запас": "material",
    "материал": "material",
    "material": "material",
    "услуга": "service",
    "работа": "service",
    "service": "service",
    "полуфабрикат": "semi_finished",
    "semi_finished": "semi_finished",
    "продукция": "product",
    "product": "product",
    "операция": "service",
}


def _s(v) -> str:
    return str(v).strip() if v is not None else ""


async def _apply_nomenclature(db: AsyncSession, tenant_id: UUID, uid: Optional[str], f: dict) -> str:
    name = _s(f.get("name"))
    if not name:
        return "skipped: пустое наименование"
    ext = _s(f.get("ext_id")) or _s(uid)
    code = _s(f.get("code")) or None
    obj = None
    if ext:
        res = await db.execute(
            select(Nomenclature).where(Nomenclature.tenant_id == tenant_id, Nomenclature.ext_id == ext)
        )
        obj = res.scalars().first()
    if obj is None and code:
        res = await db.execute(
            select(Nomenclature).where(Nomenclature.tenant_id == tenant_id, Nomenclature.code == code)
        )
        obj = res.scalars().first()
    ntype = NTYPE_MAP.get(_s(f.get("type")).lower()) or NTYPE_MAP.get(_s(f.get("ntype")).lower()) or "material"
    article = _s(f.get("article")) or None
    unit = _s(f.get("unit")) or None
    if obj is not None:
        obj.name = name
        if code:
            obj.code = code
        if article:
            obj.article = article
        obj.ntype = ntype
        if unit:
            obj.unit = unit
        if ext and not obj.ext_id:
            obj.ext_id = ext
        return "applied: обновлено"
    db.add(
        Nomenclature(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            name=name,
            code=code,
            article=article,
            ntype=ntype,
            unit=unit,
            ext_id=ext or None,
        )
    )
    return "applied: создано"


async def _apply_counterparty(db: AsyncSession, tenant_id: UUID, uid: Optional[str], f: dict) -> str:
    name = _s(f.get("name"))
    if not name:
        return "skipped: пустое наименование"
    ext = _s(f.get("external_code")) or _s(f.get("ext_id")) or _s(uid)
    inn = _s(f.get("inn")) or None
    obj = None
    if ext:
        res = await db.execute(
            select(Counterparty).where(Counterparty.tenant_id == tenant_id, Counterparty.external_code == ext)
        )
        obj = res.scalars().first()
    if obj is None and inn:
        res = await db.execute(
            select(Counterparty).where(Counterparty.tenant_id == tenant_id, Counterparty.inn == inn)
        )
        obj = res.scalars().first()
    if obj is None and not ext and not inn:
        res = await db.execute(
            select(Counterparty).where(Counterparty.tenant_id == tenant_id, Counterparty.name == name)
        )
        obj = res.scalars().first()
    if obj is not None:
        obj.name = name
        if inn:
            obj.inn = inn
        if ext and not getattr(obj, "external_code", None):
            obj.external_code = ext
        return "applied: обновлено"
    db.add(Counterparty(id=uuid.uuid4(), tenant_id=tenant_id, name=name, inn=inn, external_code=ext or None))
    return "applied: создано"


async def _apply_department(db: AsyncSession, tenant_id: UUID, uid: Optional[str], f: dict) -> str:
    name = _s(f.get("name"))
    if not name:
        return "skipped: пустое наименование"
    code = _s(f.get("code")) or None
    obj = None
    if code:
        res = await db.execute(
            select(Department).where(Department.tenant_id == tenant_id, Department.code == code)
        )
        obj = res.scalars().first()
    if obj is None:
        res = await db.execute(
            select(Department).where(Department.tenant_id == tenant_id, Department.name == name)
        )
        obj = res.scalars().first()
    if obj is not None:
        obj.name = name
        if code:
            obj.code = code
        return "applied: обновлено"
    db.add(Department(id=uuid.uuid4(), tenant_id=tenant_id, name=name, code=code))
    return "applied: создано"


async def _apply_resource(db: AsyncSession, tenant_id: UUID, uid: Optional[str], f: dict) -> str:
    name = _s(f.get("name"))
    if not name:
        return "skipped: пустое наименование"
    ext = _s(f.get("ext_id")) or _s(uid)
    obj = None
    if ext:
        res = await db.execute(
            select(Resource).where(Resource.tenant_id == tenant_id, Resource.ext_id == ext)
        )
        obj = res.scalars().first()
    if obj is None:
        res = await db.execute(
            select(Resource).where(Resource.tenant_id == tenant_id, Resource.name == name)
        )
        obj = res.scalars().first()
    if obj is not None:
        obj.name = name
        if ext and not obj.ext_id:
            obj.ext_id = ext
        return "applied: обновлено"
    db.add(
        Resource(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            name=name,
            ext_id=ext or None,
            scope=f.get("scope") or "global",
            resource_type=(_s(f.get("resource_type")) or "equipment")[:20],
            capacity_per_unit=Decimal("1"),
            capacity_unit="h",
        )
    )
    return "applied: создано"


async def _apply_project(db: AsyncSession, tenant_id: UUID, uid: Optional[str], f: dict) -> str:
    name = _s(f.get("name"))
    ext = _s(f.get("ext_id")) or _s(uid)
    obj = None
    if ext:
        res = await db.execute(
            select(Project).where(Project.tenant_id == tenant_id, Project.ext_id == ext)
        )
        obj = res.scalars().first()
    if obj is None and name:
        res = await db.execute(
            select(Project).where(Project.tenant_id == tenant_id, Project.name == name)
        )
        obj = res.scalars().first()
    if obj is None:
        return "skipped: проект не найден — создайте его в интерфейсе или проверьте код"
    if name and obj.name != name:
        pass  # наименование проекта не перетираем автоматически
    return "applied: проект сопоставлен"


async def apply_pending(
    db: AsyncSession, tenant_id: UUID, connection_id: Optional[UUID] = None, limit: int = 500
) -> dict:
    """Применить ожидающие элементы очереди к справочникам."""
    q = (
        select(ExchangeInboxItem)
        .where(ExchangeInboxItem.tenant_id == tenant_id, ExchangeInboxItem.status == "pending")
        .order_by(ExchangeInboxItem.created_at.asc().nullslast())
        .limit(min(max(limit, 1), 2000))
    )
    if connection_id:
        q = q.where(ExchangeInboxItem.connection_id == connection_id)
    res = await db.execute(q)
    items = res.scalars().all()

    stats = {"applied": 0, "skipped": 0, "errors": 0, "total": len(items), "details": []}
    for item in items:
        et = (item.entity_type or "").lower().strip()
        f = item.payload.get("fields") if isinstance(item.payload, dict) else {}
        f = f if isinstance(f, dict) else {}
        try:
            async with db.begin_nested():
                if et in ("nomenclature", "номенклатура"):
                    msg = await _apply_nomenclature(db, tenant_id, item.entity_uid, f)
                elif et in ("counterparty", "контрагент", "контрагенты"):
                    msg = await _apply_counterparty(db, tenant_id, item.entity_uid, f)
                elif et in ("department", "подразделение", "подразделения"):
                    msg = await _apply_department(db, tenant_id, item.entity_uid, f)
                elif et in ("resource", "ресурс", "ресурсы"):
                    msg = await _apply_resource(db, tenant_id, item.entity_uid, f)
                elif et in ("project", "проект", "проекты"):
                    msg = await _apply_project(db, tenant_id, item.entity_uid, f)
                else:
                    msg = "skipped: тип не поддержан каркасом (%s)" % (item.entity_type or "?")
        except Exception as e:
            msg = "error: %s" % str(e)[:300]
        if msg.startswith("applied"):
            item.status = "applied"
            stats["applied"] += 1
        elif msg.startswith("skipped"):
            item.status = "skipped"
            stats["skipped"] += 1
        else:
            item.status = "error"
            stats["errors"] += 1
        stats["details"].append({"id": str(item.id), "type": item.entity_type, "result": msg})
    await db.commit()
    return stats
