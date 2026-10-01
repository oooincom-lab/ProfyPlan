"""Журнал применений калибровки по истории (блок 6.24 плана).

Применение коэффициента калибровки сохраняется на сервере: видно, когда и с каким
основанием оценки умножались, и можно вернуть прежние значения одним действием
(«Вернуть» в панели «Калибровка по истории»). Хранятся последние 100 записей на
проект; откат помечает запись «возвращено» и восстанавливает оценки всех затронутых
операций — запись не исчезает, история честная.
"""
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import JSON, Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class CalibrationApplication(BaseModel):
    """Применение коэффициента калибровки: одно нажатие — много строк."""

    __tablename__ = "calibration_applications"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # Медиана отношения «факт / оценка», с которой применяли (×1.20 и т.п.).
    coefficient: Mapped[float] = mapped_column(Numeric(8, 4), nullable=False)
    observations_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    period_from: Mapped[Optional[object]] = mapped_column(Date, nullable=True)
    period_to: Mapped[Optional[object]] = mapped_column(Date, nullable=True)

    applied_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Сколько строк пропущено: заполненные из истории и без полной тройки.
    skipped_history: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    skipped_no_triple: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Охват применения: None — все строки проекта, иначе «тип: производство» и т.п.
    scope: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)

    # Строки применения: [{op_id, op_name, before: {to, tm, tp, source}, after: {to, tm, tp}}]
    items: Mapped[list] = mapped_column(JSON, nullable=False)

    reverted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    reverted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
