"""Журнал сдвигов CCM: применение сдвига, откат и пересчёт проектов (блок 6.33).

«Применить сдвиг» (мне или другому проекту) меняет дату старта проекта и пишет
запись в журнал (проект, направление, дней, старт до→после). Пересчёт проектов
сдвига управляется флагом auto_recalc: по умолчанию выключен — «ручной режим»,
список проектов и кнопки на странице; при включении после каждого сдвига/возврата
пересчитываются все проекты сдвига в порядке хронологии занятости общих ресурсов
(по дате старта проекта: более ранние первыми — так более поздние видят актуальную
занятость). «Вернуть» восстанавливает прежнюю дату старта и помечает запись
«(возвращено)». Хранятся последние 100 записей на организацию.

Запрос параметра пересчёта — только у сдвига/возврата; статус для панели отдаёт
GET /v1/ccm/shift-recalc (кто сдвинут, кого нужно пересчитать).
"""
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_tenant_id, get_current_user
from app.models.calculation_run import CalculationRun
from app.models.ccm_shift_application import CcmShiftApplication
from app.models.project import Project
from app.models.tenant import User
from app.routers.calculation_runs import perform_project_run

router = APIRouter(tags=["ccm-shifts"])

LIMIT_PER_TENANT = 100  # лимит журнала сдвигов на организацию


class ShiftApplyRequest(BaseModel):
    """Применение сдвига: какой проект, новая дата старта, направление, дней."""

    project_id: UUID
    new_start: datetime
    kind: str = Field(default="self", pattern="^(self|other)$")
    shift_days: int = Field(default=0, ge=0, le=3650)
    # Автопересчёт (по умолчанию выключен — ручной режим со списком и кнопками).
    auto_recalc: bool = False


class ShiftRevertRequest(BaseModel):
    """Возврат сдвига: тем же флагом управляется пересчёт после отката."""

    auto_recalc: bool = False


class ShiftOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    project_name: str
    kind: str
    shift_days: int
    old_start: Optional[datetime] = None
    new_start: Optional[datetime] = None
    reverted: bool
    reverted_at: Optional[datetime] = None
    created_at: datetime


class ShiftList(BaseModel):
    items: list[ShiftOut]
    total: int


async def _trim(db: AsyncSession, tenant_id: UUID) -> None:
    """Держим журнал в пределах лимита: лишние самые старые записи уходят."""
    old_ids = (
        (
            await db.execute(
                select(CcmShiftApplication.id)
                .where(CcmShiftApplication.tenant_id == tenant_id)
                .order_by(CcmShiftApplication.created_at.desc())
                .offset(LIMIT_PER_TENANT)
            )
        )
        .scalars()
        .all()
    )
    if old_ids:
        await db.execute(delete(CcmShiftApplication).where(CcmShiftApplication.id.in_(old_ids)))
        await db.commit()


async def perform_shift_recalcs(
    db: AsyncSession,
    tenant_id: UUID,
    author_id: Optional[UUID] = None,
) -> list[dict]:
    """Пересчитать все проекты сдвига в порядке хронологии занятости ресурсов.

    Порядок: по дате старта проекта (с неё начинается окно занятости общих
    ресурсов) — более ранние пересчитываются первыми; проекты без дат — в конце.
    Используется автопересчётом после сдвига/возврата.
    """
    proj_ids = (
        (
            await db.execute(
                select(CcmShiftApplication.project_id)
                .where(CcmShiftApplication.tenant_id == tenant_id)
                .distinct()
            )
        )
        .scalars()
        .all()
    )
    if not proj_ids:
        return []
    projects = (
        (
            await db.execute(
                select(Project).where(Project.id.in_(proj_ids), Project.tenant_id == tenant_id)
            )
        )
        .scalars()
        .all()
    )
    projects.sort(key=lambda p: (p.start_date is None, p.start_date or datetime.now(timezone.utc)))
    out: list[dict] = []
    total = len(projects)
    for idx, project in enumerate(projects, 1):
        try:
            run = await perform_project_run(
                db,
                project,
                tenant_id,
                author_id=author_id,
                auto_note=f"Автопересчёт проектов сдвига (CCM): шаг {idx}/{total}.",
            )
            out.append(
                {
                    "project_id": str(project.id),
                    "project_name": project.name,
                    "status": run.status,
                    "run_id": str(run.id),
                }
            )
        except Exception as exc:  # один упавший пересчёт не останавливает остальные
            out.append(
                {
                    "project_id": str(project.id),
                    "project_name": project.name,
                    "status": "failed",
                    "error": str(exc)[:200],
                }
            )
    return out


@router.post("/v1/ccm/shifts/apply")
async def apply_shift(
    body: ShiftApplyRequest,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
    user: User = Depends(get_current_user),
):
    """Применить сдвиг: запись в журнал, сдвиг старта, пересчёт (по флагу)."""
    project = (
        await db.execute(
            select(Project).where(Project.id == body.project_id, Project.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Проект не найден")

    old_start = project.start_date
    project.start_date = body.new_start

    rec = CcmShiftApplication(
        tenant_id=tenant_id,
        project_id=project.id,
        project_name=project.name,
        kind=body.kind,
        shift_days=int(body.shift_days or 0),
        old_start=old_start,
        new_start=body.new_start,
        reverted=False,
        created_by=user.id,
    )
    db.add(rec)
    await db.commit()
    await db.refresh(rec)
    await _trim(db, tenant_id)

    if body.auto_recalc:
        recalc: dict = {"mode": "auto", "projects": await perform_shift_recalcs(db, tenant_id, user.id)}
    else:
        recalc = {
            "mode": "manual",
            "note": "Автопересчёт выключен: пересчитайте проекты сдвига в списке (по порядку).",
        }

    return {"record": ShiftOut.model_validate(rec), "recalc": recalc}


@router.get("/v1/ccm/shifts", response_model=ShiftList)
async def list_shifts(
    limit: int = Query(default=LIMIT_PER_TENANT, ge=1, le=LIMIT_PER_TENANT),
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """Журнал сдвигов: новые сверху, возвращённые записи хранятся и видны."""
    total = (
        await db.execute(
            select(func.count())
            .select_from(CcmShiftApplication)
            .where(CcmShiftApplication.tenant_id == tenant_id)
        )
    ).scalar() or 0
    rows = (
        (
            await db.execute(
                select(CcmShiftApplication)
                .where(CcmShiftApplication.tenant_id == tenant_id)
                .order_by(CcmShiftApplication.created_at.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return ShiftList(items=[ShiftOut.model_validate(r) for r in rows], total=total)


@router.get("/v1/ccm/shift-recalc")
async def shift_recalc_status(
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """Проекты сдвига и статус пересчёта — для панели «Пересчёт проектов сдвига».

    Порядок — хронология занятости общих ресурсов (по дате старта проекта);
    возвращённые сдвиги уходят вниз. «Требует пересчёта» — если последний сдвиг
    новее последнего запуска расчёта проекта.
    """
    recs = (
        (
            await db.execute(
                select(CcmShiftApplication)
                .where(CcmShiftApplication.tenant_id == tenant_id)
                .order_by(CcmShiftApplication.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    groups: dict[UUID, dict] = {}
    for r in recs:
        g = groups.setdefault(
            r.project_id,
            {
                "project_name": r.project_name,
                "last_shift_at": r.created_at,
                "has_active": False,
            },
        )
        if not r.reverted:
            g["has_active"] = True
    if not groups:
        return {"items": [], "total": 0}

    run_rows = (
        await db.execute(
            select(CalculationRun.project_id, func.max(CalculationRun.finished_at))
            .where(
                CalculationRun.tenant_id == tenant_id,
                CalculationRun.project_id.in_(list(groups.keys())),
            )
            .group_by(CalculationRun.project_id)
        )
    ).all()
    run_map = {row[0]: row[1] for row in run_rows}

    projects = (
        (
            await db.execute(
                select(Project).where(
                    Project.id.in_(list(groups.keys())), Project.tenant_id == tenant_id
                )
            )
        )
        .scalars()
        .all()
    )
    proj_map = {p.id: p for p in projects}

    items: list[dict] = []
    for pid, g in groups.items():
        p = proj_map.get(pid)
        last_run = run_map.get(pid)
        needs = (last_run is None) or (last_run < g["last_shift_at"])
        items.append(
            {
                "project_id": str(pid),
                "project_name": g["project_name"],
                "start_date": p.start_date.isoformat() if (p and p.start_date) else None,
                "last_shift_at": g["last_shift_at"].isoformat() if g["last_shift_at"] else None,
                "last_run_at": last_run.isoformat() if last_run else None,
                "needs_recalc": bool(needs),
                "state": "shifted" if g["has_active"] else "reverted",
            }
        )
    items.sort(key=lambda x: (x["state"] == "reverted", x["start_date"] or "9999"))
    return {"items": items, "total": len(items)}


@router.post("/v1/ccm/shifts/{shift_id}/revert")
async def revert_shift(
    shift_id: UUID,
    body: Optional[ShiftRevertRequest] = None,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
    user: User = Depends(get_current_user),
):
    """Вернуть сдвиг: восстановить прежнюю дату старта и пересчитать (по флагу)."""
    rec = (
        await db.execute(
            select(CcmShiftApplication).where(
                CcmShiftApplication.id == shift_id,
                CcmShiftApplication.tenant_id == tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not rec:
        raise HTTPException(status_code=404, detail="Запись сдвига не найдена")
    if rec.reverted:
        # Идемпотентно: повторный возврат ничего не делает.
        return {"record": ShiftOut.model_validate(rec), "recalc": {}, "already": True}

    project = (
        await db.execute(
            select(Project).where(Project.id == rec.project_id, Project.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Проект не найден")

    if rec.old_start is not None:
        project.start_date = rec.old_start
    rec.reverted = True
    rec.reverted_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(rec)

    auto = bool(body and body.auto_recalc)
    if auto:
        recalc: dict = {"mode": "auto", "projects": await perform_shift_recalcs(db, tenant_id, user.id)}
    else:
        recalc = {
            "mode": "manual",
            "note": "Автопересчёт выключен: пересчитайте проекты сдвига в списке (по порядку).",
        }

    return {"record": ShiftOut.model_validate(rec), "recalc": recalc}
