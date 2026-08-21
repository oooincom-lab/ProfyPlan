"""
Справочник графиков работы (WorkSchedule) — переиспользуемые шаблоны
рабочего времени: по дням недели или по циклу (сменный график).
"""
import uuid
from decimal import Decimal
from typing import Optional

from sqlalchemy import Boolean, ForeignKey, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import BaseModel


class WorkSchedule(BaseModel):
    """График работы — шаблон, который создаёт пользователь сам."""
    __tablename__ = "work_schedules"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    fill_mode: Mapped[str] = mapped_column(
        String(20), nullable=False, default="weekdays"
    )  # weekdays / cycle
    cycle_length: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )  # для fill_mode='cycle' — длина цикла в днях
    timezone: Mapped[str] = mapped_column(String(50), default="Europe/Moscow")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    slots = relationship(
        "WorkScheduleSlot",
        back_populates="schedule",
        cascade="all, delete-orphan",
    )


class WorkScheduleSlot(BaseModel):
    """Слот (интервал) графика: рабочий сегмент или перерыв."""
    __tablename__ = "work_schedule_slots"

    schedule_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("work_schedules.id", ondelete="CASCADE"), nullable=False, index=True
    )
    day_of_week: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )  # 0=Пн … 6=Вс (для fill_mode='weekdays')
    cycle_day: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )  # 1..cycle_length (для fill_mode='cycle')
    start_hour: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False
    )  # 8.0 = 08:00, 13.5 = 13:30
    end_hour: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False
    )  # end < start = ночная смена через полночь
    kind: Mapped[str] = mapped_column(
        String(20), nullable=False, default="work"
    )  # work / break

    schedule = relationship("WorkSchedule", back_populates="slots")
