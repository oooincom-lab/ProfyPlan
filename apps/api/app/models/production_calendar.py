"""
Производственные календари (ProductionCalendar) — справочник рабочих/
выходных/праздничных дней по стране и году. Дни хранятся в дочерней таблице.
"""
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import BaseModel


class ProductionCalendar(BaseModel):
    """Календарь страны на год (например, РФ 2026)."""
    __tablename__ = "production_calendars"
    __table_args__ = (
        UniqueConstraint("tenant_id", "country_code", "year", name="uq_prodcal_country_year"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    country_code: Mapped[str] = mapped_column(String(2), nullable=False)  # ISO 3166-1 alpha-2
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    source: Mapped[str] = mapped_column(
        String(20), nullable=False, default="base"
    )  # xmlcalendar / base / excel / manual
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="fallback"
    )  # ok / fallback / missing / error
    last_error: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    source_synced_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    days = relationship(
        "ProductionCalendarDay",
        back_populates="calendar",
        cascade="all, delete-orphan",
    )


class ProductionCalendarDay(BaseModel):
    """Один день календаря: тип дня и часы."""
    __tablename__ = "production_calendar_days"
    __table_args__ = (
        UniqueConstraint("calendar_id", "date", name="uq_prodcal_day_date"),
    )

    calendar_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("production_calendars.id", ondelete="CASCADE"), nullable=False, index=True
    )
    date: Mapped[date] = mapped_column(Date, nullable=False)
    day_type: Mapped[str] = mapped_column(
        String(20), nullable=False, default="work"
    )  # work / weekend / holiday / preholiday
    hours: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(5, 2), nullable=True
    )  # рабочие часы (8.0, предпраздничный 7.0; NULL для выходного/праздника)

    calendar = relationship("ProductionCalendar", back_populates="days")
