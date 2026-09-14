"""Глобальный справочник технологических операций.

Единый справочник: типовая норма времени с вилкой (мин–макс), код и артикул для
связи с внешними системами, тип операции, теги, активность (архив) и снимок
последнего изменения (кто, когда, что было).
"""
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, JSON, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class CatalogOperation(BaseModel):
    """Операция из справочника (общая для всех проектов организации)."""
    __tablename__ = "catalog_operations"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    # типовая норма и прежнее поле (оставлено для совместимости)
    default_duration_hours: Mapped[Decimal] = mapped_column(Numeric(8, 2), nullable=False, default=1)
    norm_typical: Mapped[Optional[Decimal]] = mapped_column(Numeric(8, 2), nullable=True)
    norm_min: Mapped[Optional[Decimal]] = mapped_column(Numeric(8, 2), nullable=True)
    norm_max: Mapped[Optional[Decimal]] = mapped_column(Numeric(8, 2), nullable=True)
    unit: Mapped[str] = mapped_column(String(10), nullable=False, default="hour")
    setup_time: Mapped[Decimal] = mapped_column(Numeric(8, 2), nullable=False, default=0)
    teardown_time: Mapped[Decimal] = mapped_column(Numeric(8, 2), nullable=False, default=0)

    # идентификация для внешних источников
    code: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    article: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    article_source: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)

    # классификация
    op_type: Mapped[str] = mapped_column(String(20), nullable=False, default="work")  # work|wait|milestone
    tags: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    default_resource_id: Mapped[Optional[uuid.UUID]] = mapped_column(nullable=True)

    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # снимок последнего изменения
    updated_by: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_change: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
