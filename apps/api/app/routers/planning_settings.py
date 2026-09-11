"""API настроек планирования с наследованием по уровням."""
from typing import Any, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_tenant_id
from app.models.planning_settings import PlanningSettings
from app.services.planning_settings import PARAMS_BY_KEY, resolve_settings

router = APIRouter(prefix="/v1/planning-settings", tags=["planning-settings"])


class SettingsPatch(BaseModel):
    scope: str                      # workspace | project | group
    scope_id: Optional[UUID] = None  # для project/group
    settings: dict[str, Any] = {}


async def _get_row(db: AsyncSession, tenant_id: UUID, scope: str, scope_id: Optional[UUID]):
    stmt = select(PlanningSettings).where(
        PlanningSettings.tenant_id == tenant_id, PlanningSettings.scope == scope
    )
    stmt = stmt.where(PlanningSettings.scope_id.is_(None)) if scope_id is None else stmt.where(PlanningSettings.scope_id == scope_id)
    return (await db.execute(stmt)).scalar_one_or_none()


@router.get("")
async def get_settings(
    project_id: Optional[UUID] = None,
    group_id: Optional[UUID] = None,
    tenant_id: UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    """Эффективные настройки с указанием источника каждого значения."""
    return await resolve_settings(db, tenant_id, project_id, group_id)


@router.get("/levels")
async def get_levels(
    project_id: Optional[UUID] = None,
    group_id: Optional[UUID] = None,
    tenant_id: UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    """Значения каждого уровня отдельно + эффективные (для экрана настроек)."""
    result: dict[str, Any] = {"effective": await resolve_settings(db, tenant_id, project_id, group_id), "scopes": {}}
    result["scopes"]["workspace"] = await _get_row(db, tenant_id, "workspace", None)
    result["scopes"]["workspace"] = dict(result["scopes"]["workspace"].settings or {}) if result["scopes"]["workspace"] else {}
    if project_id:
        row = await _get_row(db, tenant_id, "project", project_id)
        result["scopes"]["project"] = dict(row.settings or {}) if row else {}
    if group_id:
        row = await _get_row(db, tenant_id, "group", group_id)
        result["scopes"]["group"] = dict(row.settings or {}) if row else {}
    return result


@router.put("")
async def update_settings(
    body: SettingsPatch,
    tenant_id: UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    """Сохранить переопределения уровня. Значение null удаляет переопределение.

    Дополнительно: `scope=project` c `settings.source_scope='workspace'` —
    перенос текущих значений уровня в настройки рабочего стола (кнопка
    «сделать значениями по умолчанию»).
    """
    if body.scope not in ("workspace", "project", "group"):
        raise HTTPException(400, "scope должен быть workspace, project или group")
    if body.scope != "workspace" and not body.scope_id:
        raise HTTPException(400, "Для project/group нужен scope_id")

    # режим «сделать значениями по умолчанию»: копируем эффективные значения уровня на рабочий стол
    if body.settings.get("__promote_to_workspace__") and body.scope != "workspace":
        eff = await resolve_settings(db, tenant_id, body.scope_id if body.scope == "project" else None,
                                    body.scope_id if body.scope == "group" else None)
        row = await _get_row(db, tenant_id, "workspace", None)
        payload = {k: v["value"] for k, v in eff["values"].items()}
        if row:
            row.settings = {**(row.settings or {}), **payload}
        else:
            db.add(PlanningSettings(id=uuid4(), tenant_id=tenant_id, scope="workspace", scope_id=None, settings=payload))
        await db.commit()
        return {"ok": True, "promoted": len(payload)}

    data = {k: v for k, v in body.settings.items() if k in PARAMS_BY_KEY}
    row = await _get_row(db, tenant_id, body.scope, body.scope_id)
    if row is None:
        row = PlanningSettings(id=uuid4(), tenant_id=tenant_id, scope=body.scope,
                               scope_id=body.scope_id, settings={})
        db.add(row)
    current = dict(row.settings or {})
    for k, v in data.items():
        if v is None:
            current.pop(k, None)       # сброс к наследованию
        else:
            current[k] = v
    row.settings = current
    await db.commit()
    eff = await resolve_settings(db, tenant_id,
                                 body.scope_id if body.scope == "project" else None,
                                 body.scope_id if body.scope == "group" else None)
    return {"ok": True, "saved": len(data), "effective": eff["values"]}


@router.delete("")
async def reset_settings(
    scope: str,
    scope_id: Optional[UUID] = None,
    tenant_id: UUID = Depends(get_current_tenant_id),
    db: AsyncSession = Depends(get_db),
):
    """Сбросить все переопределения уровня (вернуть к наследованию)."""
    if scope not in ("workspace", "project", "group"):
        raise HTTPException(400, "scope должен быть workspace, project или group")
    row = await _get_row(db, tenant_id, scope, scope_id)
    if row:
        await db.delete(row)
        await db.commit()
    return {"ok": True}
