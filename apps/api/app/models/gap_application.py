"""Журнал применённых сжатий из разбора разрыва (блок 6.14е плана).

Каждое применение сжатия пишется на сервер отдельной записью (одна операция = одна
запись): журнал переживает перезагрузку страницы и виден с любой машины. Записи не
удаляются вручную; хранятся последние записи на проект (лимит — 100, согласован
01.10.2026). Откат возвращает прежние оценки операции и помечает запись — история
остаётся честной: видно и что применялось, и что было возвращено.
"""
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class GapApplication(BaseModel):
    """Одно применение сжатия: какую операцию сжали, на сколько и что было до/после."""

    __tablename__ = "gap_applications"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # Операция хранится идентификатором без внешнего ключа: журнал — это история,
    # он должен переживать переименования и оставаться читаемым даже после удаления операции.
    op_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    op_name: Mapped[str] = mapped_column(String(255), nullable=False)

    percent: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
    # Тройные оценки до и после сжатия: [оптимистичная, вероятная, пессимистичная], часы
    before: Mapped[list] = mapped_column(JSON, nullable=False)
    after: Mapped[list] = mapped_column(JSON, nullable=False)
    # Разрыв к рабочей дате (дни, со знаком) до и после — для панели «что применено»
    gap_before: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    gap_after: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    reverted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    reverted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
