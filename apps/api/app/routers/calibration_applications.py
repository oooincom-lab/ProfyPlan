"""Журнал применений калибровки по истории (блок 6.24 плана).

Одно применение «умножить оценки на медиану ×k» сохраняется целиком: основание
(коэффициент, число наблюдений, период), список затронутых строк (оценки до и после)
и счётчики пропущенных. Журнал переживает перезагрузку и виден с любой машины;
хранятся последние 100 записей на проект — при переполнении уходят самые старые.

Откат («Вернуть») восстанавливает прежние оценки всех затронутых строк на сервере
и помечает запись «возвращено»; запись не исчезает, история честная.
"""
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_tenant_id, get_current_user
from app.models.calibration_application import CalibrationApplication
from app.models.operation import Operation
from app.models.project import Project
from app.models.tenant import User

router = APIRouter(tags=["calibration-applications"])

LIMIT_PER_PROJECT = 100  # лимит журнала на проект (как у журнала сжатий, 01.10.2026)


class CalibrationItem(BaseModel):
    """Одна затронутая строка: что было и что стало."""

    op_id: UUID
    op_name: str = Field(min_length=1, max_length=255)
    before: dict  # {to, tm, tp, source}
    after: dict  # {to, tm, tp}


class CalibrationApplicationCreate(BaseModel):
    """Новое применение: основание подсказки и список строк."""

    coefficient: float = Field(gt=0)
    observations_count: int = Field(ge=0)
    period_from: Optional[date] = None
    period_to: Optional[date] = None
    applied_count: int = Field(ge=0)
    skipped_history: int = Field(default=0, ge=0)
    skipped_no_triple: int = Field(default=0, ge=0)
    items: list[CalibrationItem] = Field(default_factory=list, max_length=2000)


class CalibrationApplicationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    coefficient: float
    observations_count: int
    period_from: Optional[date] = None
    period_to: Optional[date] = None
    applied_count: int
    skipped_history: int
    skipped_no_triple: int
    items: list[dict]
    reverted: bool
    reverted_at: Optional[datetime] = None
    created_at: datetime


class CalibrationApplicationList(BaseModel):
    items: list[CalibrationApplicationOut]
    total: int
    limit_per_project: int = LIMIT_PER_PROJECT


async def _get_project(db: AsyncSession, project_id: UUID, tenant_id: UUID) -> Project:
    project = (
        await db.execute(
            select(Project).where(Project.id == project_id, Project.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Проект не найден")
    return project


@router.get(
    "/v1/projects/{project_id}/calibration-applications",
    response_model=CalibrationApplicationList,
)
async def list_calibration_applications(
    project_id: UUID,
    limit: int = Query(default=LIMIT_PER_PROJECT, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
) -> CalibrationApplicationList:
    """Журнал применений калибровки проекта — от свежих к старым."""
    await _get_project(db, project_id, tenant_id)
    rows = (
        await db.execute(
            select(CalibrationApplication)
            .where(
                CalibrationApplication.tenant_id == tenant_id,
                CalibrationApplication.project_id == project_id,
            )
            .order_by(CalibrationApplication.created_at.desc())
            .limit(limit)
        )
    ).scalars().all()
    return CalibrationApplicationList(
        items=[CalibrationApplicationOut.model_validate(r) for r in rows], total=len(rows)
    )


@router.post(
    "/v1/projects/{project_id}/calibration-applications",
    response_model=CalibrationApplicationOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_calibration_application(
    project_id: UUID,
    body: CalibrationApplicationCreate,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
    user: User = Depends(get_current_user),
) -> CalibrationApplicationOut:
    """Записать применение калибровки; лишние старые записи сверх лимита уходят."""
    await _get_project(db, project_id, tenant_id)
    entry = CalibrationApplication(
        tenant_id=tenant_id,
        project_id=project_id,
        coefficient=body.coefficient,
        observations_count=body.observations_count,
        period_from=body.period_from,
        period_to=body.period_to,
        applied_count=body.applied_count,
        skipped_history=body.skipped_history,
        skipped_no_triple=body.skipped_no_triple,
        items=[item.model_dump(mode="json") for item in body.items],
        created_by=user.id,
    )
    db.add(entry)
    await db.flush()

    total = (
        await db.execute(
            select(func.count())
            .select_from(CalibrationApplication)
            .where(
                CalibrationApplication.tenant_id == tenant_id,
                CalibrationApplication.project_id == project_id,
            )
        )
    ).scalar_one()
    if total > LIMIT_PER_PROJECT:
        keep = (
            await db.execute(
                select(CalibrationApplication.id)
                .where(
                    CalibrationApplication.tenant_id == tenant_id,
                    CalibrationApplication.project_id == project_id,
                )
                .order_by(CalibrationApplication.created_at.desc())
                .limit(LIMIT_PER_PROJECT)
            )
        ).scalars().all()
        await db.execute(
            delete(CalibrationApplication).where(
                CalibrationApplication.tenant_id == tenant_id,
                CalibrationApplication.project_id == project_id,
                ~CalibrationApplication.id.in_(keep),
            )
        )

    await db.commit()
    await db.refresh(entry)
    return CalibrationApplicationOut.model_validate(entry)


def _as_decimal(value: object) -> Optional[Decimal]:
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except Exception:
        return None


@router.post(
    "/v1/calibration-applications/{entry_id}/revert",
    response_model=CalibrationApplicationOut,
)
async def revert_calibration_application(
    entry_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
) -> CalibrationApplicationOut:
    """Откат применения: возвращаем прежние оценки всех затронутых строк.

    Идемпотентно: повторный откат уже возвращённой записи ничего не меняет.
    """
    entry = (
        await db.execute(
            select(CalibrationApplication).where(
                CalibrationApplication.id == entry_id,
                CalibrationApplication.tenant_id == tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=404, detail="Запись журнала не найдена")

    if not entry.reverted:
        items = entry.items if isinstance(entry.items, list) else []
        for item in items:
            if not isinstance(item, dict):
                continue
            op_id = item.get("op_id")
            before = item.get("before") or {}
            if not op_id or not isinstance(before, dict):
                continue
            operation = (
                await db.execute(
                    select(Operation).where(
                        Operation.id == op_id, Operation.tenant_id == tenant_id
                    )
                )
            ).scalar_one_or_none()
            if operation is None:
                continue
            operation.to_optimistic = _as_decimal(before.get("to"))
            operation.tm_likely = _as_decimal(before.get("tm"))
            operation.tp_pessimistic = _as_decimal(before.get("tp"))
            source = before.get("source")
            if isinstance(source, str) and source:
                operation.estimate_source = source
        entry.reverted = True
        entry.reverted_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(entry)

    return CalibrationApplicationOut.model_validate(entry)
