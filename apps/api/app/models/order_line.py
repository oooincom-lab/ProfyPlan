"""Строки заказа: продукция для production_order, работы/услуги для work_order."""
from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Optional

from sqlalchemy import ForeignKey, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import BaseModel


class OrderLine(BaseModel):
    __tablename__ = "order_lines"
    __table_args__ = (
        UniqueConstraint("order_id", "line_uid", name="uq_order_lines_order_line"),
    )

    order_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("production_orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    operation_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("operations.id", ondelete="SET NULL"), nullable=True, index=True
    )
    line_uid: Mapped[str] = mapped_column(String(100), nullable=False)
    source_line_key: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    nomenclature_uid: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    nomenclature_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    nomenclature_kind: Mapped[str] = mapped_column(String(20), nullable=False, default="work")
    work_type_uid: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    work_type_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False, default=1)
    unit: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    duration_hours: Mapped[Decimal] = mapped_column(Numeric(10, 3), nullable=False, default=0)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
    department_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("departments.id", ondelete="SET NULL"), nullable=True
    )
    stage_uid: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    executor_uid: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    executor_type: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    resource_uid: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    ktu: Mapped[Decimal] = mapped_column(Numeric(8, 3), nullable=False, default=1)
    position: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    executors: Mapped[list["OrderLineExecutor"]] = relationship(
        back_populates="line",
        cascade="all, delete-orphan",
        order_by="OrderLineExecutor.created_at",
    )


class OrderLineExecutor(BaseModel):
    __tablename__ = "order_line_executors"
    __table_args__ = (
        UniqueConstraint("order_line_id", "executor_uid", name="uq_order_line_executor"),
    )

    order_line_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("order_lines.id", ondelete="CASCADE"), nullable=False, index=True
    )
    executor_uid: Mapped[str] = mapped_column(String(100), nullable=False)
    executor_type: Mapped[str] = mapped_column(String(20), nullable=False, default="employee")
    resource_uid: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="member")
    capacity_demand: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, default=1)
    ktu: Mapped[Decimal] = mapped_column(Numeric(8, 3), nullable=False, default=1)

    line: Mapped["OrderLine"] = relationship(back_populates="executors")
