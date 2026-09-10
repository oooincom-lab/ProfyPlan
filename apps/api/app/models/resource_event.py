"""
События мощности ресурса (ResourceEvent) — форсаж/ограничение/поломка/ТО.
Модификаторы мощности на период: множитель (capacity_multiplier) или
абсолютная мощность (capacity_absolute). См. промт §3.5, §7.2.
"""
import uuid
from datetime import date
from decimal import Decimal
from typing import Optional

from sqlalchemy import Boolean, Date, ForeignKey, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel

# event_type: boost (форсаж) / reduced (снижение) / breakdown (поломка)
#             / maintenance (ТО) / modernization (модернизация)
#             / condition_change (изменение состояния) / other


class ResourceEvent(BaseModel):
    """Событие мощности ресурса на период (даты от/до)."""
    __tablename__ = "resource_events"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    resource_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("resources.id", ondelete="CASCADE"), nullable=False, index=True
    )
    project_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("projects.id", ondelete="SET NULL"), nullable=True, index=True
    )
    event_type: Mapped[str] = mapped_column(
        String(30), nullable=False, default="boost", index=True
    )
    # Модификатор: множитель мощности (1.25 / 1.5 / 0.6 …)
    capacity_multiplier: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(6, 3), nullable=True
    )
    # Или абсолютная мощность (замена на менее мощный ресурс) — ед. мощности/сутки
    capacity_absolute: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(14, 3), nullable=True
    )
    # Причина — обязательна (трассируемость «почему сдвиг»)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    related_operation_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("operations.id", ondelete="SET NULL"), nullable=True
    )
    # Документ-основание (аудит): тип + id
    base_document_type: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True
    )
    base_document_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    date_from: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    date_to: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
