"""Конвейер обработки входящей очереди обмена (срез 2, 14.10.2026).

Применяет принятые пакеты к справочникам ProfyPlan:
- nomenclature  → Номенклатура (upsert по ext_id → код → имя);
- counterparty  → Контрагенты (upsert по external_code → ИНН → имя);
- department    → Подразделения (upsert по коду → имени);
- resource      → Ресурсы (upsert по ext_id → имени);
- order         → Заказы на производство (upsert по номеру/ext_id; новые — черновиками; не-черновики не трогаем).
- project       → Проекты (только сопоставление; отсутствующие — в «пропущено» с пояснением).

Сопоставление — по внешним идентификаторам (ext_id/код), никогда по порядку; каждое
применение фиксируется в статусе элемента очереди (applied/skipped/error).
"""
from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.counterparty import Counterparty
from app.models.department import Department
from app.models.integration import ExchangeInboxItem
from app.models.nomenclature import Nomenclature
from app.models.production_order import ProductionOrder
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

PRIORITY_MAP = {
    "низкий": "low", "low": "low",
    "обычный": "normal", "средний": "normal", "normal": "normal",
    "высокий": "high", "high": "high",
    "критический": "critical", "critical": "critical",
}


def _s(v) -> str:
    return str(v).strip() if v is not None else ""


async def _apply_nomenclature(db: AsyncSession, tenant_id: UUID, uid: Optional[str], f: dict) -> str:
    name = _s(f.get("name"))
    if not name:
        return "skipped: пустое наименование"
    uid_s = _s(uid) or None
    ext = _s(f.get("external_code")) or _s(f.get("ext_id")) or None
    code = _s(f.get("code")) or None
    obj = None
    if uid_s:
        res = await db.execute(
            select(Nomenclature).where(Nomenclature.tenant_id == tenant_id, Nomenclature.ext_uid == uid_s)
        )
        obj = res.scalars().first()
    if obj is None and ext:
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
        if uid_s and not obj.ext_uid:
            obj.ext_uid = uid_s
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
            ext_uid=uid_s,
        )
    )
    return "applied: создано"


async def _apply_counterparty(db: AsyncSession, tenant_id: UUID, uid: Optional[str], f: dict) -> str:
    name = _s(f.get("name"))
    if not name:
        return "skipped: пустое наименование"
    uid_s = _s(uid) or None
    ext = _s(f.get("external_code")) or _s(f.get("ext_id")) or None
    inn = _s(f.get("inn")) or None
    obj = None
    if uid_s:
        res = await db.execute(
            select(Counterparty).where(Counterparty.tenant_id == tenant_id, Counterparty.ext_uid == uid_s)
        )
        obj = res.scalars().first()
    if obj is None and ext:
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
        if uid_s and not obj.ext_uid:
            obj.ext_uid = uid_s
        return "applied: обновлено"
    db.add(Counterparty(id=uuid.uuid4(), tenant_id=tenant_id, name=name, inn=inn, external_code=ext or None, ext_uid=uid_s))
    return "applied: создано"


async def _apply_department(db: AsyncSession, tenant_id: UUID, uid: Optional[str], f: dict) -> str:
    name = _s(f.get("name"))
    if not name:
        return "skipped: пустое наименование"
    uid_s = _s(uid) or None
    code = _s(f.get("code")) or None
    obj = None
    if uid_s:
        res = await db.execute(
            select(Department).where(Department.tenant_id == tenant_id, Department.ext_uid == uid_s)
        )
        obj = res.scalars().first()
    if obj is None and code:
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
        if uid_s and not obj.ext_uid:
            obj.ext_uid = uid_s
        return "applied: обновлено"
    db.add(Department(id=uuid.uuid4(), tenant_id=tenant_id, name=name, code=code, ext_uid=uid_s))
    return "applied: создано"


async def _apply_resource(db: AsyncSession, tenant_id: UUID, uid: Optional[str], f: dict) -> str:
    name = _s(f.get("name"))
    if not name:
        return "skipped: пустое наименование"
    uid_s = _s(uid) or None
    ext = _s(f.get("external_code")) or _s(f.get("ext_id")) or None
    obj = None
    if uid_s:
        res = await db.execute(
            select(Resource).where(Resource.tenant_id == tenant_id, Resource.ext_uid == uid_s)
        )
        obj = res.scalars().first()
    if obj is None and ext:
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
        if uid_s and not obj.ext_uid:
            obj.ext_uid = uid_s
        return "applied: обновлено"
    db.add(
        Resource(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            name=name,
            ext_id=ext or None,
            ext_uid=uid_s,
            scope=f.get("scope") or "global",
            resource_type=(_s(f.get("resource_type")) or "equipment")[:20],
            capacity_per_unit=Decimal("1"),
            capacity_unit="h",
        )
    )
    return "applied: создано"


async def _apply_order(db: AsyncSession, tenant_id: UUID, uid: Optional[str], f: dict) -> str:
    """Приём заказа на производство из 1С: новые — черновиками; черновики обновляются; не-черновики не трогаем."""
    number = _s(f.get("number")) or _s(f.get("name"))
    ext = number or _s(uid)
    if not ext:
        return "skipped: нет номера заказа"
    qty_raw = f.get("quantity")
    try:
        qty = Decimal(str(qty_raw).replace(",", ".")) if qty_raw not in (None, "") else Decimal("1")
    except Exception:
        qty = Decimal("1")
    if qty <= 0:
        return "skipped: количество <= 0"
    unit = _s(f.get("unit")) or "pcs"
    start_date = _parse_date(f.get("start_date"))
    due_date = _parse_date(f.get("due_date") or f.get("date"))
    priority = PRIORITY_MAP.get(_s(f.get("priority")).lower()) or "normal"
    spec = (
        _s(f.get("specification_name"))
        or _s(f.get("specification"))
        or _s(f.get("product_name"))
        or _s(f.get("product"))
        or None
    )
    client = _s(f.get("client")) or None

    # Проект — только сопоставление (по коду/ext_id, затем по имени)
    project_id = None
    pcode = _s(f.get("project_code")) or _s(f.get("project_ext_id"))
    pname = _s(f.get("project_name")) or _s(f.get("project"))
    proj = None
    if pcode:
        proj = (
            await db.execute(select(Project).where(Project.tenant_id == tenant_id, Project.ext_id == pcode))
        ).scalars().first()
    if proj is None and pname:
        proj = (
            await db.execute(select(Project).where(Project.tenant_id == tenant_id, Project.name == pname))
        ).scalars().first()
    if proj is not None:
        project_id = proj.id

    obj = None
    uid_s = _s(uid) or None
    # Правило Дополнения №1: UID — главный ключ, номер — резервный.
    if uid_s:
        obj = (
            await db.execute(
                select(ProductionOrder).where(
                    ProductionOrder.tenant_id == tenant_id, ProductionOrder.ext_uid == uid_s
                )
            )
        ).scalars().first()
    if obj is None and ext:
        obj = (
            await db.execute(
                select(ProductionOrder).where(
                    ProductionOrder.tenant_id == tenant_id, ProductionOrder.ext_id == ext
                )
            )
        ).scalars().first()

    if obj is None:
        db.add(
            ProductionOrder(
                id=uuid.uuid4(),
                tenant_id=tenant_id,
                project_id=project_id,
                ext_id=ext,
                ext_uid=(_s(uid) or None),
                specification_name=spec,
                quantity=qty,
                unit=unit,
                start_date=start_date,
                due_date=due_date,
                priority=priority,
                client=client,
                status="draft",
                notes="Импорт из 1С (интеграция)",
            )
        )
        return "applied: создан черновик" + ("" if project_id else " (без проекта — сопоставьте в системе)")

    if obj.status == "draft" and obj.exploded_at is None:
        obj.quantity = qty
        obj.unit = unit
        if uid_s and not obj.ext_uid:
            obj.ext_uid = uid_s
        # Номер мог измениться в 1С; UID остаётся стабильным.
        if ext and obj.ext_uid == uid_s:
            obj.ext_id = ext
        if start_date:
            obj.start_date = start_date
        if due_date:
            obj.due_date = due_date
        obj.priority = priority
        if spec:
            obj.specification_name = spec
        if client:
            obj.client = client
        if project_id and obj.project_id is None:
            obj.project_id = project_id
        return "applied: обновлён черновик"

    return "skipped: заказ уже есть (не черновик) — оставлен без изменений"


async def _apply_project(db: AsyncSession, tenant_id: UUID, uid: Optional[str], f: dict) -> str:
    name = _s(f.get("name"))
    uid_s = _s(uid) or None
    ext = _s(f.get("ext_id")) or _s(f.get("code")) or None
    obj = None
    if uid_s:
        res = await db.execute(
            select(Project).where(Project.tenant_id == tenant_id, Project.ext_uid == uid_s)
        )
        obj = res.scalars().first()
    if obj is None and ext:
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
    if uid_s and not obj.ext_uid:
        obj.ext_uid = uid_s
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
                elif et in ("order", "заказ", "заказы", "orders", "производственный_заказ"):
                    msg = await _apply_order(db, tenant_id, item.entity_uid, f)
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
