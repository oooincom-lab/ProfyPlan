"""
Модель единиц измерения — ОКЕИ + международные символы, bilingual.
"""
import uuid
from typing import Optional

from sqlalchemy import Boolean, ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class Unit(BaseModel):
    """Единица измерения (ОКЕИ-based)."""
    __tablename__ = "units"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    code: Mapped[str] = mapped_column(String(10), nullable=False, unique=True)  # код ОКЕИ: "796"
    symbol_int: Mapped[str] = mapped_column(String(10), nullable=False)  # международный: pcs, kg
    symbol_ru: Mapped[str] = mapped_column(String(10), nullable=False)  # русский: шт, кг
    name_ru: Mapped[str] = mapped_column(String(100), nullable=False)  # Штука
    name_en: Mapped[str] = mapped_column(String(100), nullable=False)  # Piece
    factor: Mapped[float] = mapped_column(default=1.0)  # множитель к базовой единице
    is_base: Mapped[bool] = mapped_column(Boolean, default=False)  # базовая единица
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
