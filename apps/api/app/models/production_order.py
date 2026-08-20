"""
ProductionOrder — заказ на производство.
Каждый заказ ссылается на спецификацию (BOM), которая разворачивается в граф операций.
"""
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class ProductionOrder(BaseModel):
    """Заказ на производство."""
    __tablename__ = "production_orders"

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
    ext_id: Mapped[Optional[str]] = mapped_column(
        String(100), nullable=True, index=True
    )  # внешний ID из ERP (напр. "ЗНП-001")

    # Привязка к спецификации (ID из product_structures, либо строка-имя)
    specification_id: Mapped[Optional[str]] = mapped_column(
        String(100), nullable=True
    )  # ext_id спецификации (напр. "SPEC-001")
    specification_name: Mapped[Optional[str]] = mapped_column(
        String(255), nullable=True
    )  # человекочитаемое имя

    quantity: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), default=1.0
    )
    unit: Mapped[str] = mapped_column(
        String(20), default="pcs"
    )

    start_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    due_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    priority: Mapped[str] = mapped_column(
        String(20), default="normal"
    )  # low / normal / high / critical

    client: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    client_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("counterparties.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )  # ссылка на справочник контрагентов
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    status: Mapped[str] = mapped_column(
        String(20), default="draft"
    )  # draft / planned / in_progress / completed

    # Когда был развёрнут BOM → CPM
    exploded_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Кол-во созданных операций при последней развёртке
    operations_created: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )

    # Группа / Пул (ровно одно из двух или оба NULL = в корне проекта)
    group_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("order_groups.id", ondelete="SET NULL"),
        nullable=True,
    )
    pool_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("order_pools.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Куст заказов: родительский заказ (self-FK).
    # Явная связь «этот заказ — подчинённый заказа X».
    # Может быть также выведена из order_id на BOM-узлах, но храним явно для надёжности.
    parent_order_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("production_orders.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
