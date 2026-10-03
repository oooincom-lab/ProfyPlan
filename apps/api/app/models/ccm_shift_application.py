"""Журнал сдвигов CCM (блок 6.33): применения сдвига старта проекта.

«Применить сдвиг» меняет дату старта проекта; каждое применение сохраняется:
проект, направление (свой/другой), сколько дней, старт до и после. «Вернуть»
восстанавливает прежнюю дату и помечает запись «(возвращено)» — запись не
удаляется, история честная. После применения и возврата проект автоматически
пересчитывается (запуск сохраняется в реестре расчётов).
"""
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class CcmShiftApplication(BaseModel):
    """Одно применение сдвига: сдвинули старт одного проекта — одна запись."""

    __tablename__ = "ccm_shift_applications"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    project_name: Mapped[str] = mapped_column(String(255), nullable=False)

    # Направление сдвига: self — «сдвиг мне», other — «сдвиг другому проекту».
    kind: Mapped[str] = mapped_column(String(10), nullable=False, default="self")
    shift_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    old_start: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    new_start: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    reverted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    reverted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # Сдвиг с контуром (03.10.2026): охват («проект» / выбранные кусты),
    # сколько заказов перенесено и пропущено, старые даты перенесённых — для возврата.
    scope: Mapped[str] = mapped_column(String(10), nullable=False, default="project")
    orders_shifted: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    orders_skipped: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    orders_moved: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    skipped_details: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)

    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
