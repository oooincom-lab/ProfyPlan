"""
Модель календаря доступности ресурса.
"""
import uuid
from datetime import date
from decimal import Decimal
from typing import Optional

from sqlalchemy import Boolean, Date, ForeignKey, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import BaseModel


class ResourceCalendar(BaseModel):
    """Календарь рабочего времени ресурса."""
    __tablename__ = "resource_calendars"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    resource_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("resources.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), default="Стандартный календарь")
    timezone: Mapped[str] = mapped_column(String(50), default="Europe/Moscow")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    slots = relationship("ResourceCalendarSlot", back_populates="calendar", cascade="all, delete-orphan")


class ResourceCalendarSlot(BaseModel):
    """Слот рабочего времени в календаре (день недели + часы)."""
    __tablename__ = "resource_calendar_slots"

    __table_args__ = (
        UniqueConstraint("calendar_id", "day_of_week", "start_hour", name="uq_calendar_slot"),
    )

    calendar_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("resource_calendars.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    day_of_week: Mapped[int] = mapped_column(
        Integer, nullable=False
    )  # 0=Пн ... 6=Вс, -1=исключение
    start_hour: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False
    )  # напр. 8.0 = 08:00, 13.5 = 13:30
    end_hour: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False
    )  # напр. 17.0 = 17:00
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    exception_date: Mapped[Date | None] = mapped_column(Date, nullable=True)  # для day_of_week=-1

    calendar = relationship("ResourceCalendar", back_populates="slots")
