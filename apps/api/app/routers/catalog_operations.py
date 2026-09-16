from pydantic import BaseModel
"""Справочник технологических операций.

Возможности: поиск, проверка дублей (код и нормализованное название), подсказка
похожих записей, проверка связей перед удалением и мастер удаления
(замена на другую операцию либо удаление вместе со связанными объектами).
"""
import uuid
from datetime import datetime, timezone
from difflib import SequenceMatcher
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_tenant_id
from app.models.catalog_operation import CatalogOperation
from app.models.operation import Operation
from app.schemas.catalog_operation import (
    CatalogOperationCreate,
    CatalogOperationOut,
    CatalogOperationUpdate,
)

router = APIRouter(prefix="/v1/catalog-operations", tags=["catalog-operations"])


def _norm(s: str) -> str:
    """Нормализация названия: регистр, «ё», кавычки, тире, пробелы."""
    s = (s or "").strip().lower().replace("ё", "е")
    for ch in ("«", "»", '"', "'", "(", ")", "[", "]"):
        s = s.replace(ch, "")
    for ch in ("–", "—", "−"):
        s = s.replace(ch, "-")
    return " ".join(s.split())


async def _find_duplicate(db: AsyncSession, tenant_id, name: str, code: Optional[str], exclude_id=None):
    stmt = select(CatalogOperation).where(
        CatalogOperation.tenant_id == tenant_id,
        func.lower(CatalogOperation.name) == (name or "").strip().lower(),
    )
    if exclude_id:
        stmt = stmt.where(CatalogOperation.id != exclude_id)
    dup = (await db.execute(stmt)).scalars().first()
    if dup:
        return dup, "название"
    if code:
        stmt2 = select(CatalogOperation).where(
            CatalogOperation.tenant_id == tenant_id,
            func.lower(CatalogOperation.code) == code.strip().lower(),
        )
        if exclude_id:
            stmt2 = stmt2.where(CatalogOperation.id != exclude_id)
        dup2 = (await db.execute(stmt2)).scalars().first()
        if dup2:
            return dup2, "код"
    return None, None


@router.get("", response_model=list[CatalogOperationOut])
@router.get("/", response_model=list[CatalogOperationOut])
async def list_items(
    search: str | None = None,
    include_archived: bool = False,
    limit: int = 500,
    offset: int = 0,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(CatalogOperation).where(CatalogOperation.tenant_id == tenant_id)
    if not include_archived:
        stmt = stmt.where(CatalogOperation.is_active.is_(True))
    if search:
        like = f"%{search.strip()}%"
        stmt = stmt.where(or_(
            CatalogOperation.name.ilike(like),
            CatalogOperation.notes.ilike(like),
            CatalogOperation.code.ilike(like),
            CatalogOperation.article.ilike(like),
            CatalogOperation.tags.ilike(like),
        ))
    stmt = stmt.order_by(CatalogOperation.name).offset(max(0, offset)).limit(max(1, min(limit, 2000)))
    res = await db.execute(stmt)
    return res.scalars().all()


@router.get("/similar", response_model=list[CatalogOperationOut])
async def similar_items(
    name: str = Query(..., min_length=1),
    threshold: float = Query(0.82, ge=0.5, le=1.0),
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    """Похожие записи справочника — подсказка при создании и при импорте."""
    res = await db.execute(select(CatalogOperation).where(CatalogOperation.tenant_id == tenant_id))
    items = res.scalars().all()
    target = _norm(name)
    scored = []
    for it in items:
        r = SequenceMatcher(None, target, _norm(it.name)).ratio()
        if r >= threshold:
            scored.append((r, it))
    scored.sort(key=lambda x: -x[0])
    return [it for _, it in scored[:10]]


@router.get("/{item_id}/relations")
async def item_relations(
    item_id: uuid.UUID,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    """Связанные объекты: операции заказов (по ссылке и по совпадению названия)."""
    item = (await db.execute(select(CatalogOperation).where(
        CatalogOperation.id == item_id, CatalogOperation.tenant_id == tenant_id
    ))).scalars().first()
    if not item:
        raise HTTPException(404, "Операция справочника не найдена")

    by_id = (await db.execute(
        select(func.count()).select_from(Operation).where(Operation.catalog_operation_id == item_id)
    )).scalar() or 0
    by_name = (await db.execute(
        select(func.count()).select_from(Operation).where(
            func.lower(Operation.name) == (item.name or "").lower(),
            Operation.catalog_operation_id.is_(None),
        )
    )).scalar() or 0
    sample = (await db.execute(
        select(Operation.id, Operation.name).where(
            or_(Operation.catalog_operation_id == item_id,
                func.lower(Operation.name) == (item.name or "").lower())
        ).limit(10)
    )).all()
    return {
        "item": {"id": str(item.id), "name": item.name, "code": item.code},
        "operations_linked": int(by_id),
        "operations_same_name": int(by_name),
        "total_operations": int(by_id) + int(by_name),
        "sample": [{"id": str(r[0]), "name": r[1]} for r in sample],
    }


@router.post("", response_model=CatalogOperationOut, status_code=201)
@router.post("/", response_model=CatalogOperationOut, status_code=201)
async def create_item(
    body: CatalogOperationCreate,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    dup, field = await _find_duplicate(db, tenant_id, body.name, body.code)
    if dup:
        raise HTTPException(409, f"Уже есть операция с таким {field}: «{dup.name}» (id={dup.id})")
    data = body.model_dump()
    if data.get("norm_typical") is None:
        data["norm_typical"] = data.get("default_duration_hours")
    item = CatalogOperation(id=uuid4(), tenant_id=tenant_id,
                            default_duration_hours=data.get("norm_typical") or 1, **data)
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


@router.patch("/{item_id}", response_model=CatalogOperationOut)
async def update_item(
    item_id: uuid.UUID,
    body: CatalogOperationUpdate,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    item = (await db.execute(select(CatalogOperation).where(
        CatalogOperation.id == item_id, CatalogOperation.tenant_id == tenant_id
    ))).scalars().first()
    if not item:
        raise HTTPException(404, "Операция справочника не найдена")

    data = {k: v for k, v in body.model_dump().items() if v is not None}
    who = data.pop("updated_by", None)
    if "name" in data or "code" in data:
        dup, field = await _find_duplicate(db, tenant_id, data.get("name", item.name),
                                           data.get("code", item.code), exclude_id=item.id)
        if dup:
            raise HTTPException(409, f"Уже есть операция с таким {field}: «{dup.name}» (id={dup.id})")

    watch = ("name", "code", "article", "norm_typical", "norm_min", "norm_max", "unit", "op_type", "tags")
    before = {k: (str(getattr(item, k)) if getattr(item, k) is not None else None) for k in watch}
    for k, v in data.items():
        setattr(item, k, v)
    if data.get("norm_typical") is not None:
        item.default_duration_hours = data["norm_typical"]
    after = {k: (str(getattr(item, k)) if getattr(item, k) is not None else None) for k in watch}
    changed = {k: {"before": before[k], "after": after[k]} for k in watch if before[k] != after[k]}
    if changed:
        item.last_change = {"by": who or "—", "at": datetime.now(timezone.utc).isoformat(), "changed": changed}
    item.updated_by = who or item.updated_by
    item.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(item)
    return item


@router.delete("/{item_id}", status_code=204)
async def delete_item(
    item_id: uuid.UUID,
    replace_with: Optional[uuid.UUID] = Query(None, description="Заменить ссылки на другую операцию справочника"),
    force: bool = Query(False, description="Удалить вместе со связанными операциями заказов"),
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    """Мастер удаления: без параметров — только если связей нет.

    replace_with — перенаправить операции заказов на другую операцию справочника.
    force — удалить связанные операции заказов вместе с записью справочника.
    """
    item = (await db.execute(select(CatalogOperation).where(
        CatalogOperation.id == item_id, CatalogOperation.tenant_id == tenant_id
    ))).scalars().first()
    if not item:
        raise HTTPException(404, "Операция справочника не найдена")

    linked = (await db.execute(select(Operation).where(Operation.catalog_operation_id == item_id))).scalars().all()
    if linked and not replace_with and not force:
        raise HTTPException(409, (
            "Операция используется: %d операций заказов. Выберите замену (replace_with) "
            "или подтвердите удаление вместе со связанными (force=true)." % len(linked)
        ))

    if replace_with:
        target = (await db.execute(select(CatalogOperation).where(
            CatalogOperation.id == replace_with, CatalogOperation.tenant_id == tenant_id
        ))).scalars().first()
        if not target:
            raise HTTPException(404, "Операция для замены не найдена")
        for op in linked:
            op.catalog_operation_id = target.id
    elif force:
        for op in linked:
            await db.delete(op)

    await db.delete(item)
    await db.commit()
    return None


# ── Пакетные операции (множественное выделение) ────────────────────────────────

class BulkStateIn(BaseModel):
    """Пакетное изменение состояния записей справочника."""
    ids: list[uuid.UUID]
    is_active: bool


class BulkStateOut(BaseModel):
    updated: int
    skipped: int


@router.patch("/bulk/state", response_model=BulkStateOut)
async def bulk_state(
    body: BulkStateIn,
    tenant_id: str = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    """Убрать в архив или вернуть из архива сразу несколько записей."""
    if not body.ids:
        return BulkStateOut(updated=0, skipped=0)
    rows = (await db.execute(select(CatalogOperation).where(
        CatalogOperation.tenant_id == tenant_id,
        CatalogOperation.id.in_(body.ids),
    ))).scalars().all()
    for row in rows:
        if bool(row.is_active) != bool(body.is_active):
            row.is_active = bool(body.is_active)
            row.updated_by = "массовая операция"
            row.updated_at = datetime.utcnow()
    await db.commit()
    return BulkStateOut(updated=len([r for r in rows if bool(r.is_active) == bool(body.is_active)]),
                        skipped=max(0, len(body.ids) - len(rows)))
