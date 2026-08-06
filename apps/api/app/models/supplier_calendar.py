"""
Модель календаря поставщика (SupplierCalendar).
Аналог ResourceCalendar, но для операций закупки.
"""
import uuid
from datetime import time
from decimal import Decimal
from typing import Optional

from sqlalchemy import Boolean, ForeignKey, Integer, Numeric, String, Time
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class SupplierCalendar(BaseModel):
    """Календарь доступности поставщика."""
    __tablename__ = "supplier_calendars"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    supplier_id: Mapped[str] = mapped_column(
        String(100), nullable=False, index=True,
        comment="Внешний ID поставщика (из operation.supplier_id)"
    )
    supplier_name: Mapped[Optional[str]] = mapped_column(
        String(255), nullable=True
    )

    day_of_week: Mapped[int] = mapped_column(
        Integer, nullable=False,
        comment="0=Mon ... 6=Sun"
    )
    is_working: Mapped[bool] = mapped_column(
        Boolean, default=True
    )
    start_time: Mapped[Optional[time]] = mapped_column(
        Time, nullable=True, default=time(9, 0)
    )
    end_time: Mapped[Optional[time]] = mapped_column(
        Time, nullable=True, default=time(18, 0)
    )

    lead_time_days: Mapped[Decimal] = mapped_column(
        Numeric(8, 2), default=0,
        comment="Стандартное время поставки в днях"
    )
    min_order_qty: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(12, 4), nullable=True
    )
    notes: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
