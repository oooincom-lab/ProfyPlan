"""Глобальный каталог операций (Шаг 3 плана v2.15).

Единый справочник технологических операций: из него выбирается операция
маршрута; default_duration_hours подставляется как длительность по умолчанию.
"""
import uuid
from decimal import Decimal
from typing import Optional

from sqlalchemy import ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class CatalogOperation(BaseModel):
    """Операция из каталога (общий для всех проектов tenant)."""
    __tablename__ = "catalog_operations"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    default_duration_hours: Mapped[Decimal] = mapped_column(
        Numeric(8, 2), nullable=False, default=1
    )
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
