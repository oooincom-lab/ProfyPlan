"""
BOM-модель: структура изделия (ProductStructure).
Древовидный справочник состава продукции.
"""
import uuid
from decimal import Decimal
from typing import Optional

from sqlalchemy import Boolean, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class ProductStructure(BaseModel):
    """Узел структуры изделия (BOM-дерево)."""
    __tablename__ = "product_structures"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    project_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    parent_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("product_structures.id", ondelete="CASCADE"),
        nullable=True,
    )
    level: Mapped[int] = mapped_column(Integer, default=0)
    path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    node_type: Mapped[str] = mapped_column(
        String(20), nullable=False, default="material"
    )  # assembly / semi_finished / material

    nomenclature_id: Mapped[Optional[str]] = mapped_column(
        String(100), nullable=True
    )  # ext_id из ERP (1С)
    nomenclature_name: Mapped[str] = mapped_column(
        String(255), nullable=False
    )

    quantity_per_parent: Mapped[Decimal] = mapped_column(
        Numeric(12, 4), default=1.0
    )
    unit: Mapped[str] = mapped_column(
        String(20), default="pcs"
    )  # pcs / kg / m / l / set

    is_make_or_buy: Mapped[str] = mapped_column(
        String(10), nullable=False, default="buy"
    )  # make / buy

    procurement_lead_time_days: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(8, 2), nullable=True
    )
    is_phantom: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    routing_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("routings.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Связь с заказом-производителем: какой заказ делает этот узел BOM
    order_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("production_orders.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    ext_id: Mapped[Optional[str]] = mapped_column(
        String(255), nullable=True, comment="Внешний ID из ERP"
    )

    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
