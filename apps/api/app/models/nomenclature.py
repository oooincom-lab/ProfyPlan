"""
Модель номенклатуры — продукты, материалы, полуфабрикаты, услуги.
"""
import uuid
from typing import Optional

from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class Nomenclature(BaseModel):
    """Единица номенклатуры."""
    __tablename__ = "nomenclature"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    project_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("projects.id", ondelete="SET NULL"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    code: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    article: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    ntype: Mapped[str] = mapped_column(
        String(20), nullable=False, default="material"
    )  # product / material / semi_finished / service
    unit: Mapped[str] = mapped_column(String(20), nullable=False, default="pcs")
    unit_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("units.id", ondelete="SET NULL"), nullable=True, index=True
    )
    description: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    ext_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
