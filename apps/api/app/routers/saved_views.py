"""API сохранённых видов и реестра сохранений (промт, Дополнение 8).

Сохранённый вид — именованный снимок состояния представления. Хранение — на
сервере (арендатор + проект + пользователь), содержимое — JSON-конверт с
разделами по видам, версией схемы и ручными позициями узлов.

Что здесь есть:
- список видов проекта (свои + общие виды других участников);
- создание, сохранение, получение, переименование, смена статуса и шаринг,
  удаление (с подтверждением);
- «Сохранить как свой» — ответвление личной копии от общего вида;
- экспорт в файл (одного вида или всех доступных) и импорт из файла;
- чтение лимита числа сохранений из общих настроек (механизм наследования
  «система → рабочий стол → проект → группа → пул»);
- журнал изменений общего вида (кто, когда, что сделал).

Правило шаринга: пользователь может сделать общим ровно один свой вид в рамках
проекта. Общий вид со статусом «чтение» применяют все, сохраняет только владелец;
со статусом «изменение» сохраняют все участники проекта, и каждое такое
сохранение попадает в журнал.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_tenant_id, get_current_user
from app.models.project import Project
from app.models.saved_view import (
    DEFAULT_SCHEMA_VERSION,
    ENVELOPE_SECTIONS,
    SHARE_MODES,
    SHARE_READ,
    SHARE_WRITE,
    VISIBILITY_PRIVATE,
    VISIBILITY_SHARED,
    SavedView,
    SavedViewLog,
)
from app.models.tenant import User
from app.services.planning_settings import resolve_settings

router = APIRouter(prefix="/v1/saved-views", tags=["saved-views"])

# Параметр общих настроек, задающий лимит числа сохранений.
LIMIT_KEY = "views.saved_limit"
DEFAULT_LIMIT = 10

SOURCE_LABELS = {
    "system": "значение системы",
    "workspace": "рабочий стол",
    "project": "проект",
    "group": "группа",
    "pool": "кластер",
}


# ── нормализация конверта ─────────────────────────────────────────────────────

def _norm_point(value: Any) -> Optional[dict]:
    """Координата узла: принимаем {x, y} и [x, y] — отдаём всегда {x, y}."""
    if isinstance(value, dict):
        x, y = value.get("x"), value.get("y")
    elif isinstance(value, (list, tuple)) and len(value) >= 2:
        x, y = value[0], value[1]
    else:
        return None
    try:
        return {"x": float(x), "y": float(y)}
    except (TypeError, ValueError):
        return None


def normalize_envelope(raw: Any) -> dict:
    """Приводит конверт настроек к каноническому виду.

    Разделы по видам (сетевой график, Гант, пулы, общее) всегда присутствуют;
    незнакомые разделы сохраняются как есть — ничего не теряем. Ручные позиции
    узлов — «подпись раскладки → идентификатор операции → координаты».
    Функция идемпотентна: повторная нормализация не меняет результат, поэтому
    «экспорт → импорт» даёт тот же конверт.
    """
    src = raw if isinstance(raw, dict) else {}

    try:
        version = int(src.get("schema_version"))
    except (TypeError, ValueError):
        version = DEFAULT_SCHEMA_VERSION
    if version < 1:
        version = DEFAULT_SCHEMA_VERSION

    raw_sections = src.get("sections") if isinstance(src.get("sections"), dict) else {}
    sections: dict[str, dict] = {key: {} for key in ENVELOPE_SECTIONS}
    for key in ENVELOPE_SECTIONS:
        value = raw_sections.get(key)
        if isinstance(value, dict):
            sections[key] = value
    for key, value in raw_sections.items():
        if key not in sections and isinstance(value, dict):
            sections[key] = value

    raw_positions = src.get("node_positions")
    positions: dict[str, dict] = {}
    if isinstance(raw_positions, dict):
        for layout, entries in raw_positions.items():
            if not isinstance(entries, dict):
                continue
            layout_positions: dict[str, dict] = {}
            for op_id, coords in entries.items():
                point = _norm_point(coords)
                if point is not None:
                    layout_positions[str(op_id)] = point
            if layout_positions:
                positions[str(layout)] = layout_positions

    layout = src.get("layout") if isinstance(src.get("layout"), dict) else {}

    return {
        "schema_version": version,
        "sections": sections,
        "node_positions": positions,
        "layout": layout,
    }


# ── доступ, лимит, служебное ──────────────────────────────────────────────────

def _can_read(view: SavedView, user_id: uuid.UUID) -> bool:
    """Личный вид читает только владелец; общий — все участники проекта."""
    if view.visibility == VISIBILITY_SHARED:
        return True
    return view.owner_id == user_id


def _can_write(view: SavedView, user_id: uuid.UUID) -> bool:
    """Пишет владелец; в общий вид со статусом «изменение» — любой участник."""
    if view.owner_id == user_id:
        return True
    return view.visibility == VISIBILITY_SHARED and view.share_mode == SHARE_WRITE


def _status_label(view: SavedView, is_own: bool) -> str:
    if view.visibility != VISIBILITY_SHARED:
        return "личный"
    mode = "изменение" if view.share_mode == SHARE_WRITE else "чтение"
    return f"общий — {mode}" if is_own else f"общий (чужой) — {mode}"


def _serialize(view: SavedView, user_id: uuid.UUID, owner_name: Optional[str] = None) -> dict:
    is_own = view.owner_id == user_id
    content = view.content or {}
    changed = view.updated_at or view.created_at
    return {
        "id": str(view.id),
        "project_id": str(view.project_id),
        "name": view.name,
        "owner_id": str(view.owner_id),
        "owner_name": owner_name,
        "is_own": is_own,
        "kind": "shared" if view.visibility == VISIBILITY_SHARED else "private",
        "visibility": view.visibility,
        "share_mode": view.share_mode,
        "status": _status_label(view, is_own),
        "schema_version": view.schema_version,
        "imported": bool(view.imported),
        "sections": sorted((content.get("sections") or {}).keys()),
        "node_positions": sum(len(v) for v in (content.get("node_positions") or {}).values()),
        "can_write": _can_write(view, user_id),
        "can_manage": is_own,
        "created_at": view.created_at.isoformat() if view.created_at else None,
        "updated_at": changed.isoformat() if changed else None,
    }


async def _project_or_404(db: AsyncSession, tenant_id: uuid.UUID, project_id: uuid.UUID) -> Project:
    project = (await db.execute(select(Project).where(
        Project.id == project_id, Project.tenant_id == tenant_id
    ))).scalar_one_or_none()
    if project is None:
        raise HTTPException(404, "Проект не найден")
    return project


async def _own_count(db: AsyncSession, tenant_id: uuid.UUID, project_id: uuid.UUID,
                     owner_id: uuid.UUID) -> int:
    return int((await db.execute(select(func.count()).select_from(SavedView).where(
        SavedView.tenant_id == tenant_id,
        SavedView.project_id == project_id,
        SavedView.owner_id == owner_id,
    ))).scalar_one())


async def _limit_info(db: AsyncSession, tenant_id: uuid.UUID, project_id: uuid.UUID,
                      owner_id: uuid.UUID, group_id: Optional[uuid.UUID] = None,
                      pool_id: Optional[uuid.UUID] = None) -> dict:
    """Лимит числа сохранений из общих настроек (с наследованием по уровням)."""
    resolved = await resolve_settings(db, tenant_id, project_id, group_id, pool_id)
    entry = (resolved.get("values") or {}).get(LIMIT_KEY) or {}
    raw = entry.get("value", DEFAULT_LIMIT)
    try:
        limit = int(raw)
    except (TypeError, ValueError):
        limit = DEFAULT_LIMIT
    if limit < 0:
        limit = 0
    used = await _own_count(db, tenant_id, project_id, owner_id)
    source = entry.get("source", "system")
    return {
        "key": LIMIT_KEY,
        "value": limit,
        "source": source,
        "source_label": SOURCE_LABELS.get(source, source),
        "used": used,
        "remaining": max(0, limit - used),
    }


def _limit_reached(info: dict, needed: int = 1) -> HTTPException:
    """Отказ по лимиту: понятное сообщение и что делать дальше."""
    return HTTPException(409, detail={
        "code": "view_limit_reached",
        "message": (
            f"Лимит сохранённых видов исчерпан: сохранено {info['used']} из {info['value']} "
            f"(источник лимита — {info['source_label']}). Сохранить ещё {needed} нельзя."
        ),
        "limit": info["value"],
        "used": info["used"],
        "remaining": info["remaining"],
        "source": info["source"],
        "hint": "Удалите ненужный вид или выгрузите его в файл, затем повторите сохранение.",
    })


async def _name_taken(db: AsyncSession, tenant_id: uuid.UUID, project_id: uuid.UUID,
                      owner_id: uuid.UUID, name: str, exclude_id: Optional[uuid.UUID] = None) -> bool:
    stmt = select(func.count()).select_from(SavedView).where(
        SavedView.tenant_id == tenant_id,
        SavedView.project_id == project_id,
        SavedView.owner_id == owner_id,
        func.lower(SavedView.name) == name.strip().lower(),
    )
    if exclude_id is not None:
        stmt = stmt.where(SavedView.id != exclude_id)
    return int((await db.execute(stmt)).scalar_one()) > 0


async def _unique_name(db: AsyncSession, tenant_id: uuid.UUID, project_id: uuid.UUID,
                       owner_id: uuid.UUID, base: str) -> str:
    """Свободное имя: «имя (копия)», затем «имя (копия 2)», «(копия 3)»…"""
    name = f"{base} (копия)"
    n = 2
    while await _name_taken(db, tenant_id, project_id, owner_id, name):
        name = f"{base} (копия {n})"
        n += 1
    return name


async def _owner_names(db: AsyncSession, owner_ids: list[uuid.UUID]) -> dict[uuid.UUID, str]:
    if not owner_ids:
        return {}
    rows = (await db.execute(select(User.id, User.name).where(User.id.in_(set(owner_ids))))).all()
    return {row[0]: row[1] for row in rows}


async def _log(db: AsyncSession, tenant_id: uuid.UUID, view: SavedView, user_id: uuid.UUID,
               action: str, payload: Optional[dict] = None, note: Optional[str] = None) -> None:
    db.add(SavedViewLog(
        tenant_id=tenant_id, view_id=view.id, project_id=view.project_id,
        user_id=user_id, action=action, payload=payload or {}, note=note,
    ))


async def _get_view(db: AsyncSession, tenant_id: uuid.UUID, view_id: uuid.UUID) -> SavedView:
    view = (await db.execute(select(SavedView).where(
        SavedView.id == view_id, SavedView.tenant_id == tenant_id
    ))).scalar_one_or_none()
    if view is None:
        raise HTTPException(404, "Сохранённый вид не найден")
    return view


# ── входные схемы ─────────────────────────────────────────────────────────────

class CreateIn(BaseModel):
    project_id: uuid.UUID
    name: str
    content: dict[str, Any] = {}
    schema_version: Optional[int] = None


class SaveIn(BaseModel):
    content: dict[str, Any] = {}
    schema_version: Optional[int] = None


class RenameIn(BaseModel):
    name: str


class ShareIn(BaseModel):
    mode: str = SHARE_READ


class ImportIn(BaseModel):
    project_id: uuid.UUID
    payload: dict[str, Any]
    # переименование при совпадении имён: {старое имя: новое имя}
    renames: dict[str, str] = {}


# ── список и создание ─────────────────────────────────────────────────────────

@router.get("")
async def list_saved_views(
    project_id: uuid.UUID,
    group_id: Optional[uuid.UUID] = None,
    pool_id: Optional[uuid.UUID] = None,
    tenant_id: uuid.UUID = Depends(get_current_tenant_id),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Реестр сохранений проекта: свои виды + общие виды участников, и текущий лимит."""
    await _project_or_404(db, tenant_id, project_id)

    rows = (await db.execute(select(SavedView).where(
        SavedView.tenant_id == tenant_id,
        SavedView.project_id == project_id,
        or_(SavedView.owner_id == user.id, SavedView.visibility == VISIBILITY_SHARED),
    ).order_by(SavedView.created_at.desc()))).scalars().all()

    names = await _owner_names(db, [v.owner_id for v in rows])
    my_shared = next((v for v in rows if v.owner_id == user.id and v.visibility == VISIBILITY_SHARED), None)
    info = await _limit_info(db, tenant_id, project_id, user.id, group_id, pool_id)

    return {
        "items": [_serialize(v, user.id, names.get(v.owner_id)) for v in rows],
        "limit": info,
        "schema_version": DEFAULT_SCHEMA_VERSION,
        "sections": list(ENVELOPE_SECTIONS),
        "my_shared_view_id": str(my_shared.id) if my_shared else None,
    }


@router.post("", status_code=201)
async def create_saved_view(
    body: CreateIn,
    tenant_id: uuid.UUID = Depends(get_current_tenant_id),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Сохранить новый личный вид. Упор в лимит — отказ с пояснением."""
    await _project_or_404(db, tenant_id, body.project_id)

    name = (body.name or "").strip()
    if not name:
        raise HTTPException(400, "Имя вида не может быть пустым")
    if await _name_taken(db, tenant_id, body.project_id, user.id, name):
        raise HTTPException(409, detail={
            "code": "view_name_taken",
            "message": f"Вид с именем «{name}» уже сохранён. Выберите другое имя или переименуйте существующий.",
            "name": name,
        })

    info = await _limit_info(db, tenant_id, body.project_id, user.id)
    if info["used"] + 1 > info["value"]:
        raise _limit_reached(info)

    version = int(body.schema_version) if body.schema_version else DEFAULT_SCHEMA_VERSION
    view = SavedView(
        tenant_id=tenant_id,
        project_id=body.project_id,
        owner_id=user.id,
        name=name,
        visibility=VISIBILITY_PRIVATE,
        share_mode=None,
        content=normalize_envelope({**body.content, "schema_version": version}),
        schema_version=version,
        updated_at=datetime.now(timezone.utc),
    )
    db.add(view)
    await db.flush()
    await _log(db, tenant_id, view, user.id, "create", {"name": name})
    await db.commit()
    return {"item": _serialize(view, user.id, user.name), "limit": info}


# ── экспорт и импорт ──────────────────────────────────────────────────────────

@router.get("/export")
async def export_saved_views(
    project_id: uuid.UUID,
    ids: Optional[str] = Query(default=None, description="Идентификаторы видов через запятую; без них — все доступные"),
    tenant_id: uuid.UUID = Depends(get_current_tenant_id),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Выгрузка в файл: один вид или все доступные. Файл — JSON с версией схемы."""
    await _project_or_404(db, tenant_id, project_id)

    wanted: Optional[list[uuid.UUID]] = None
    if ids:
        wanted = []
        for chunk in ids.split(","):
            chunk = chunk.strip()
            if not chunk:
                continue
            try:
                wanted.append(uuid.UUID(chunk))
            except ValueError:
                raise HTTPException(400, f"Некорректный идентификатор вида: {chunk}")

    stmt = select(SavedView).where(
        SavedView.tenant_id == tenant_id,
        SavedView.project_id == project_id,
        or_(SavedView.owner_id == user.id, SavedView.visibility == VISIBILITY_SHARED),
    )
    if wanted is not None:
        stmt = stmt.where(SavedView.id.in_(wanted))
    rows = (await db.execute(stmt.order_by(SavedView.created_at))).scalars().all()

    if wanted is not None and not rows:
        raise HTTPException(404, "Доступных для выгрузки видов не найдено")

    for view in rows:
        if view.visibility == VISIBILITY_SHARED:
            await _log(db, tenant_id, view, user.id, "export", {"name": view.name})
    await db.commit()

    return {
        "app": "ProfyPlan",
        "kind": "saved-views",
        "schema_version": DEFAULT_SCHEMA_VERSION,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "count": len(rows),
        "views": [
            {
                "name": v.name,
                "schema_version": v.schema_version,
                "content": v.content or {},
            }
            for v in rows
        ],
    }


@router.post("/import", status_code=201)
async def import_saved_views(
    body: ImportIn,
    tenant_id: uuid.UUID = Depends(get_current_tenant_id),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Импорт файла: виды добавляются личными. Совпадение имён требует переименования."""
    await _project_or_404(db, tenant_id, body.project_id)

    raw_views = body.payload.get("views")
    if not isinstance(raw_views, list):
        # принимаем и одиночный вид-конверт, а не только файл целиком
        raw_views = [body.payload] if body.payload.get("name") else []
    if not raw_views:
        raise HTTPException(400, "В файле нет ни одного сохранённого вида")

    prepared: list[dict] = []
    conflicts: list[str] = []
    seen: set[str] = set()
    for raw in raw_views:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name") or "").strip() or "Импортированный вид"
        content = raw.get("content") if isinstance(raw.get("content"), dict) else {}
        version = raw.get("schema_version")
        try:
            version = int(version) if version is not None else DEFAULT_SCHEMA_VERSION
        except (TypeError, ValueError):
            version = DEFAULT_SCHEMA_VERSION

        final_name = (body.renames.get(name) or name).strip() or name
        low = final_name.lower()
        if low in seen or await _name_taken(db, tenant_id, body.project_id, user.id, final_name):
            conflicts.append(name)
            continue
        seen.add(low)
        prepared.append({"name": final_name, "schema_version": version, "content": content})

    if conflicts:
        raise HTTPException(409, detail={
            "code": "view_name_conflict",
            "message": "В списке уже есть вид с таким именем — переименуйте его перед импортом.",
            "conflicts": conflicts,
            "suggestions": {name: f"{name} (копия)" for name in conflicts},
            "hint": "Передайте новые имена в поле renames: {«старое имя»: «новое имя»} и повторите импорт.",
        })

    if not prepared:
        raise HTTPException(400, "В файле нет видов, пригодных для импорта")

    info = await _limit_info(db, tenant_id, body.project_id, user.id)
    if info["used"] + len(prepared) > info["value"]:
        raise _limit_reached(info, needed=len(prepared))

    created = []
    for item in prepared:
        view = SavedView(
            tenant_id=tenant_id,
            project_id=body.project_id,
            owner_id=user.id,
            name=item["name"],
            visibility=VISIBILITY_PRIVATE,
            share_mode=None,
            content=normalize_envelope({**item["content"], "schema_version": item["schema_version"]}),
            schema_version=item["schema_version"],
            imported=True,
            updated_at=datetime.now(timezone.utc),
        )
        db.add(view)
        await db.flush()
        await _log(db, tenant_id, view, user.id, "import", {"name": item["name"]})
        created.append(view)

    await db.commit()
    renamed = [{"from": k, "to": body.renames[k]} for k in body.renames if body.renames[k]]
    return {
        "created": [{"id": str(v.id), "name": v.name} for v in created],
        "renamed": renamed,
        "limit": {**info, "used": info["used"] + len(created),
                  "remaining": max(0, info["value"] - info["used"] - len(created))},
    }


# ── отдельный вид ─────────────────────────────────────────────────────────────

@router.get("/{view_id}")
async def get_saved_view(
    view_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant_id),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Получить вид целиком (включая конверт) — это же действие «применить»."""
    view = await _get_view(db, tenant_id, view_id)
    if not _can_read(view, user.id):
        raise HTTPException(403, "Вид принадлежит другому пользователю")
    names = await _owner_names(db, [view.owner_id])
    return {"item": _serialize(view, user.id, names.get(view.owner_id)), "content": view.content or {}}


@router.put("/{view_id}")
async def save_saved_view(
    view_id: uuid.UUID,
    body: SaveIn,
    tenant_id: uuid.UUID = Depends(get_current_tenant_id),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Сохранить состояние в существующий вид.

    Пишет владелец; в общий вид со статусом «изменение» — любой участник проекта
    (с записью в журнал изменений).
    """
    view = await _get_view(db, tenant_id, view_id)
    if not _can_write(view, user.id):
        raise HTTPException(403, "В этот вид нельзя сохранять: он общий со статусом «чтение»")

    version = int(body.schema_version) if body.schema_version else view.schema_version
    view.content = normalize_envelope({**body.content, "schema_version": version})
    view.schema_version = version
    view.updated_at = datetime.now(timezone.utc)
    if view.visibility == VISIBILITY_SHARED:
        await _log(db, tenant_id, view, user.id, "save",
                   {"schema_version": version, "by_owner": view.owner_id == user.id})
    await db.commit()
    names = await _owner_names(db, [view.owner_id])
    return {"item": _serialize(view, user.id, names.get(view.owner_id)), "content": view.content}


@router.post("/{view_id}/rename")
async def rename_saved_view(
    view_id: uuid.UUID,
    body: RenameIn,
    tenant_id: uuid.UUID = Depends(get_current_tenant_id),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Переименовать вид — только владелец."""
    view = await _get_view(db, tenant_id, view_id)
    if view.owner_id != user.id:
        raise HTTPException(403, "Переименовать вид может только его автор")
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(400, "Имя вида не может быть пустым")
    if await _name_taken(db, tenant_id, view.project_id, user.id, name, exclude_id=view.id):
        raise HTTPException(409, detail={
            "code": "view_name_taken",
            "message": f"Вид с именем «{name}» уже сохранён. Выберите другое имя.",
            "name": name,
        })
    old = view.name
    view.name = name
    view.updated_at = datetime.now(timezone.utc)
    await _log(db, tenant_id, view, user.id, "rename", {"from": old, "to": name})
    await db.commit()
    return {"item": _serialize(view, user.id, user.name)}


@router.post("/{view_id}/share")
async def share_saved_view(
    view_id: uuid.UUID,
    body: ShareIn,
    tenant_id: uuid.UUID = Depends(get_current_tenant_id),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Сделать вид общим. Общим может быть только один свой вид в рамках проекта."""
    view = await _get_view(db, tenant_id, view_id)
    if view.owner_id != user.id:
        raise HTTPException(403, "Сделать общим свой вид может только его автор")
    if body.mode not in SHARE_MODES:
        raise HTTPException(400, "Статус общего вида: read или write")

    other = (await db.execute(select(SavedView).where(
        SavedView.tenant_id == tenant_id,
        SavedView.project_id == view.project_id,
        SavedView.owner_id == user.id,
        SavedView.visibility == VISIBILITY_SHARED,
        SavedView.id != view.id,
    ))).scalars().first()
    if other is not None:
        raise HTTPException(409, detail={
            "code": "shared_view_limit",
            "message": f"Общим уже сделан вид «{other.name}». Общим может быть только один свой вид — верните его в личные.",
            "current_shared_view_id": str(other.id),
            "current_shared_view_name": other.name,
        })

    view.visibility = VISIBILITY_SHARED
    view.share_mode = body.mode
    view.updated_at = datetime.now(timezone.utc)
    await _log(db, tenant_id, view, user.id, "share", {"mode": body.mode})
    await db.commit()
    return {"item": _serialize(view, user.id, user.name)}


@router.post("/{view_id}/unshare")
async def unshare_saved_view(
    view_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant_id),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Вернуть общий вид в личные — только владелец."""
    view = await _get_view(db, tenant_id, view_id)
    if view.owner_id != user.id:
        raise HTTPException(403, "Вернуть вид в личные может только его автор")
    mode = view.share_mode
    view.visibility = VISIBILITY_PRIVATE
    view.share_mode = None
    view.updated_at = datetime.now(timezone.utc)
    await _log(db, tenant_id, view, user.id, "unshare", {"mode": mode})
    await db.commit()
    return {"item": _serialize(view, user.id, user.name)}


@router.post("/{view_id}/copy", status_code=201)
async def copy_saved_view(
    view_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant_id),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """«Сохранить как свой»: от вида ответвляется личная копия."""
    view = await _get_view(db, tenant_id, view_id)
    if not _can_read(view, user.id):
        raise HTTPException(403, "Вид принадлежит другому пользователю")

    info = await _limit_info(db, tenant_id, view.project_id, user.id)
    if info["used"] + 1 > info["value"]:
        raise _limit_reached(info)

    name = await _unique_name(db, tenant_id, view.project_id, user.id, view.name)
    copy = SavedView(
        tenant_id=tenant_id,
        project_id=view.project_id,
        owner_id=user.id,
        name=name,
        visibility=VISIBILITY_PRIVATE,
        share_mode=None,
        content=view.content or {},
        schema_version=view.schema_version,
        updated_at=datetime.now(timezone.utc),
    )
    db.add(copy)
    await db.flush()
    await _log(db, tenant_id, copy, user.id, "copy", {"from": str(view.id), "name": name})
    if view.visibility == VISIBILITY_SHARED:
        await _log(db, tenant_id, view, user.id, "copy", {"to": str(copy.id), "name": name})
    await db.commit()
    return {"item": _serialize(copy, user.id, user.name), "source_id": str(view.id)}


@router.delete("/{view_id}")
async def delete_saved_view(
    view_id: uuid.UUID,
    confirm: bool = Query(default=False, description="Удаление требует явного подтверждения"),
    tenant_id: uuid.UUID = Depends(get_current_tenant_id),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Удалить вид — только владелец и только с подтверждением."""
    view = await _get_view(db, tenant_id, view_id)
    if view.owner_id != user.id:
        raise HTTPException(403, "Удалить вид может только его автор")
    if not confirm:
        raise HTTPException(409, detail={
            "code": "confirm_required",
            "message": f"Удаление вида «{view.name}» требует подтверждения.",
            "hint": "Повторите запрос с confirm=true.",
        })
    name = view.name
    await db.delete(view)
    await db.commit()
    return {"ok": True, "deleted": str(view_id), "name": name}


@router.get("/{view_id}/log")
async def saved_view_log(
    view_id: uuid.UUID,
    limit: int = Query(default=50, ge=1, le=500),
    tenant_id: uuid.UUID = Depends(get_current_tenant_id),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Журнал изменений вида: кто и когда. Доступен тем, кто видит сам вид."""
    view = await _get_view(db, tenant_id, view_id)
    if not _can_read(view, user.id):
        raise HTTPException(403, "Вид принадлежит другому пользователю")

    rows = (await db.execute(select(SavedViewLog).where(
        SavedViewLog.tenant_id == tenant_id,
        SavedViewLog.view_id == view_id,
    ).order_by(SavedViewLog.created_at.desc()).limit(limit))).scalars().all()
    names = await _owner_names(db, [r.user_id for r in rows if r.user_id])

    return {
        "view_id": str(view_id),
        "items": [
            {
                "id": str(r.id),
                "action": r.action,
                "at": r.created_at.isoformat() if r.created_at else None,
                "user_id": str(r.user_id) if r.user_id else None,
                "user_name": names.get(r.user_id),
                "payload": r.payload or {},
                "note": r.note,
            }
            for r in rows
        ],
    }
