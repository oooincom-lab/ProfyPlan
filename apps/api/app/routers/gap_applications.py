"""Журнал применённых сжатий из разбора разрыва (блок 6.14е плана).

Применения сжатия сохраняются на сервере: журнал переживает перезагрузку страницы и
виден с любой машины. Ручных удалений нет; хранятся последние 100 записей на проект
(лимит согласован 01.10.2026) — при переполнении уходят самые старые.

Откат возвращает прежние оценки операции на сервере и помечает запись «возвращено»:
запись не исчезает, история честная.
"""
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_tenant_id, get_current_user
from app.models.gap_application import GapApplication
from app.models.operation import Operation
from app.models.project import Project
from app.models.tenant import User

router = APIRouter(tags=["gap-applications"])

LIMIT_PER_PROJECT = 100  # лимит журнала на проект (согласован 01.10.2026)


class GapApplicationCreate(BaseModel):
    """Новое применение сжатия: одна операция, процент и оценки до/после."""

    op_id: UUID
    op_name: str = Field(min_length=1, max_length=255)
    percent: int = Field(default=10, ge=1, le=90)
    before: list[float] = Field(min_length=3, max_length=3)
    after: list[float] = Field(min_length=3, max_length=3)
    gap_before: Optional[float] = None
    gap_after: Optional[float] = None


class GapApplicationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    op_id: UUID
    op_name: str
    percent: int
    before: list[float]
    after: list[float]
    gap_before: Optional[float] = None
    gap_after: Optional[float] = None
    reverted: bool
    reverted_at: Optional[datetime] = None
    created_at: datetime


class GapApplicationList(BaseModel):
    items: list[GapApplicationOut]
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


@router.get("/v1/projects/{project_id}/gap-applications", response_model=GapApplicationList)
async def list_gap_applications(
    project_id: UUID,
    limit: int = Query(default=LIMIT_PER_PROJECT, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
) -> GapApplicationList:
    """Журнал применённых сжатий проекта — от свежих к старым."""
    await _get_project(db, project_id, tenant_id)
    rows = (
        await db.execute(
            select(GapApplication)
            .where(
                GapApplication.tenant_id == tenant_id,
                GapApplication.project_id == project_id,
            )
            .order_by(GapApplication.created_at.desc())
            .limit(limit)
        )
    ).scalars().all()
    return GapApplicationList(
        items=[GapApplicationOut.model_validate(r) for r in rows], total=len(rows)
    )


@router.post(
    "/v1/projects/{project_id}/gap-applications",
    response_model=GapApplicationOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_gap_application(
    project_id: UUID,
    body: GapApplicationCreate,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
    user: User = Depends(get_current_user),
) -> GapApplicationOut:
    """Записать применение сжатия в журнал; лишние старые записи сверх лимита уходят."""
    await _get_project(db, project_id, tenant_id)
    entry = GapApplication(
        tenant_id=tenant_id,
        project_id=project_id,
        op_id=body.op_id,
        op_name=body.op_name,
        percent=body.percent,
        before=list(body.before),
        after=list(body.after),
        gap_before=body.gap_before,
        gap_after=body.gap_after,
        created_by=user.id,
    )
    db.add(entry)
    await db.flush()

    # Лимит журнала: держим последние LIMIT_PER_PROJECT записей на проект.
    total = (
        await db.execute(
            select(func.count())
            .select_from(GapApplication)
            .where(
                GapApplication.tenant_id == tenant_id,
                GapApplication.project_id == project_id,
            )
        )
    ).scalar_one()
    if total > LIMIT_PER_PROJECT:
        keep = (
            await db.execute(
                select(GapApplication.id)
                .where(
                    GapApplication.tenant_id == tenant_id,
                    GapApplication.project_id == project_id,
                )
                .order_by(GapApplication.created_at.desc())
                .limit(LIMIT_PER_PROJECT)
            )
        ).scalars().all()
        await db.execute(
            delete(GapApplication).where(
                GapApplication.tenant_id == tenant_id,
                GapApplication.project_id == project_id,
                ~GapApplication.id.in_(keep),
            )
        )

    await db.commit()
    await db.refresh(entry)
    return GapApplicationOut.model_validate(entry)


@router.post("/v1/gap-applications/{entry_id}/revert", response_model=GapApplicationOut)
async def revert_gap_application(
    entry_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
) -> GapApplicationOut:
    """Откат применения: возвращаем прежние оценки операции и помечаем запись.

    Идемпотентно: повторный откат уже возвращённой записи ничего не меняет.
    """
    entry = (
        await db.execute(
            select(GapApplication).where(
                GapApplication.id == entry_id,
                GapApplication.tenant_id == tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=404, detail="Запись журнала не найдена")

    if not entry.reverted:
        operation = (
            await db.execute(
                select(Operation).where(
                    Operation.id == entry.op_id, Operation.tenant_id == tenant_id
                )
            )
        ).scalar_one_or_none()
        if operation is not None and isinstance(entry.before, list) and len(entry.before) == 3:
            operation.to_optimistic = entry.before[0]
            operation.tm_likely = entry.before[1]
            operation.tp_pessimistic = entry.before[2]
        entry.reverted = True
        entry.reverted_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(entry)

    return GapApplicationOut.model_validate(entry)
