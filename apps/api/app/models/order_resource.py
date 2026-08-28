"""Ресурсы заказа (Шаг 5 плана v2.15).

order_resources хранит ПЕРЕОПРЕДЕЛЕНИЯ ресурса в рамках заказа
(подразделение, доступная мощность). Сам состав ресурсов заказа производен
от операций маршрутов (источник истины — операции); GET /orders/{id}/resources
возвращает объединение: ресурсы из операций + переопределения.
"""
import uuid
from decimal import Decimal
from typing import Optional

from sqlalchemy import ForeignKey, Numeric, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class OrderResource(BaseModel):
    """Переопределение ресурса в рамках заказа."""
    __tablename__ = "order_resources"
    __table_args__ = (
        UniqueConstraint("order_id", "resource_id", name="uq_order_resources_order_resource"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    order_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("production_orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    resource_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("resources.id", ondelete="CASCADE"), nullable=False, index=True
    )
    department_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("departments.id", ondelete="SET NULL"), nullable=True
    )
    capacity: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(12, 3), nullable=True
    )
