"""Заказ-наряд: работы/услуги, исполнители и связи с операциями."""
from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from typing import Optional

from sqlalchemy import (
    Date,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import BaseModel


class WorkOrder(BaseModel):
    """Шапка заказ-наряда (Документ.ЗаказПокупателя + ВидОперации=ЗаказНаряд)."""

    __tablename__ = "work_orders"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    project_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("projects.id", ondelete="SET NULL"), nullable=True, index=True
    )
    organization_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True, index=True
    )
    customer_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("counterparties.id", ondelete="SET NULL"), nullable=True, index=True
    )
    parent_production_order_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("production_orders.id", ondelete="SET NULL"), nullable=True, index=True
    )

    ext_uid: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    ext_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    number: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    doc_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="draft")
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="1c", server_default="1c")
    external_revision: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    pending_project_uid: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    pending_organization_uid: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    pending_parent_uid: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    lines: Mapped[list["WorkOrderLine"]] = relationship(
        back_populates="work_order",
        cascade="all, delete-orphan",
        order_by="WorkOrderLine.sequence",
    )


class WorkOrderLine(BaseModel):
    """Строка работы/услуги. Для ProfyPlan это планировочная операция."""

    __tablename__ = "work_order_lines"
    __table_args__ = (
        UniqueConstraint("work_order_id", "line_uid", name="uq_work_order_lines_order_line"),
    )

    work_order_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("work_orders.id", ondelete="CASCADE"), nullable=False, index=True
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

    work_order: Mapped["WorkOrder"] = relationship(back_populates="lines")
    executors: Mapped[list["WorkOrderLineExecutor"]] = relationship(
        back_populates="line",
        cascade="all, delete-orphan",
        order_by="WorkOrderLineExecutor.created_at",
    )


class WorkOrderLineExecutor(BaseModel):
    """Исполнитель строки заказ-наряда с КТУ; M:N на уровне строки."""

    __tablename__ = "work_order_line_executors"
    __table_args__ = (
        UniqueConstraint(
            "work_order_line_id", "executor_uid", name="uq_work_order_line_executor"
        ),
    )

    work_order_line_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("work_order_lines.id", ondelete="CASCADE"), nullable=False, index=True
    )
    executor_uid: Mapped[str] = mapped_column(String(100), nullable=False)
    executor_type: Mapped[str] = mapped_column(String(20), nullable=False, default="employee")
    resource_uid: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="member")
    capacity_demand: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, default=1)
    ktu: Mapped[Decimal] = mapped_column(Numeric(8, 3), nullable=False, default=1)

    line: Mapped["WorkOrderLine"] = relationship(back_populates="executors")
