"""Журнал сдвигов CCM: применение сдвига старта и откат (блок 6.33).

«Применить сдвиг» (мне или другому проекту) меняет дату старта проекта; каждое
применение сохраняется в журнале (проект, направление, дней, старт до→после) и
сопровождается автопересчётом затронутого проекта — запуск сохраняется в реестре
расчётов. «Вернуть» восстанавливает прежнюю дату старта, тоже пересчитывает
проект и помечает запись «(возвращено)»; запись не удаляется. Хранятся последние
100 записей на организацию.
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


@router.post("/v1/ccm/shifts/apply")
async def apply_shift(
    body: ShiftApplyRequest,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
    user: User = Depends(get_current_user),
):
    """Применить сдвиг: сохранить запись журнала, сдвинуть старт и пересчитать проект."""
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

    recalc: dict = {}
    try:
        run = await perform_project_run(
            db,
            project,
            tenant_id,
            author_id=user.id,
            auto_note=(
                "Автопересчёт после сдвига старта (CCM): %s → %s."
                % (
                    old_start.date().isoformat() if old_start else "—",
                    body.new_start.date().isoformat(),
                )
            ),
        )
        recalc = {"status": run.status, "run_id": str(run.id)}
    except Exception as exc:  # пересчёт не должен отменять сам сдвиг
        recalc = {"status": "failed", "error": str(exc)[:300]}

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


@router.post("/v1/ccm/shifts/{shift_id}/revert")
async def revert_shift(
    shift_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
    user: User = Depends(get_current_user),
):
    """Вернуть сдвиг: восстановить прежнюю дату старта и пересчитать проект."""
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

    recalc: dict = {}
    try:
        run = await perform_project_run(
            db,
            project,
            tenant_id,
            author_id=user.id,
            auto_note=(
                "Автопересчёт после возврата сдвига (CCM): старт возвращён к %s."
                % (rec.old_start.date().isoformat() if rec.old_start else "—")
            ),
        )
        recalc = {"status": run.status, "run_id": str(run.id)}
    except Exception as exc:
        recalc = {"status": "failed", "error": str(exc)[:300]}

    return {"record": ShiftOut.model_validate(rec), "recalc": recalc}
