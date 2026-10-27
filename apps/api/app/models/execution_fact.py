"""Компактные факты выполнения, получаемые из 1С."""
import uuid
from datetime import date
from decimal import Decimal
from typing import Optional

from sqlalchemy import Date, ForeignKey, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class ExecutionFact(BaseModel):
    """Факт производства, закрытия наряда, прихода или перемещения."""
    __tablename__ = "execution_facts"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "fact_type", "source_document_uid", "source_row_uid",
            name="uq_execution_facts_source_row",
        ),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    fact_type: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    source_document_uid: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    source_row_uid: Mapped[str] = mapped_column(String(100), nullable=False, default="", server_default="")
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="1c", server_default="1c")
    external_revision: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    project_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("projects.id", ondelete="SET NULL"), nullable=True, index=True
    )
    pending_project_uid: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    pending_order_uid: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    production_order_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("production_orders.id", ondelete="SET NULL"), nullable=True, index=True
    )
    work_order_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("work_orders.id", ondelete="SET NULL"), nullable=True, index=True
    )
    work_order_line_uid: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    order_line_uid: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    operation_uid: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    stage_uid: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    executor_uid: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    executor_type: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    ktu: Mapped[Optional[Decimal]] = mapped_column(Numeric(8, 3), nullable=True)
    nomenclature_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("nomenclature.id", ondelete="SET NULL"), nullable=True, index=True
    )
    warehouse_from_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("warehouses.id", ondelete="SET NULL"), nullable=True
    )
    warehouse_to_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("warehouses.id", ondelete="SET NULL"), nullable=True
    )

    quantity: Mapped[Optional[Decimal]] = mapped_column(Numeric(14, 3), nullable=True)
    hours: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
    fact_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="posted", server_default="posted")
