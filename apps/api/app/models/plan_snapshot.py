"""Фиксация плана: снимок результата расчёта для передачи во внешние системы (09.10.2026).

План (операции с датами и длительностями) считается на лету; фиксация сохраняет
пооперационный снимок на момент расчёта — чтобы передавать его в другие системы
(например, 1С) и сравнивать версии. Шапка хранит метод, отпечаток входных данных
и автора; строки — плановые данные каждой операции.
"""
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class PlanSnapshot(BaseModel):
    """Шапка фиксации плана проекта."""

    __tablename__ = "plan_snapshots"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Метод расчёта (логика планирования) и отпечаток входных данных на момент фиксации
    planning_logic: Mapped[str] = mapped_column(String(10), nullable=False, default="cpm")
    data_fingerprint: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    start_anchor: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    rows_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class PlanSnapshotRow(BaseModel):
    """Строка фиксации: плановые данные одной операции."""

    __tablename__ = "plan_snapshot_rows"

    snapshot_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("plan_snapshots.id", ondelete="CASCADE"), nullable=False, index=True
    )

    order_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("production_orders.id", ondelete="SET NULL"), nullable=True
    )
    order_ext_id: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    order_ext_uid: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    resource_ext_uid: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    department_ext_uid: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    order_name: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    operation_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("operations.id", ondelete="SET NULL"), nullable=True
    )
    operation_name: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    operation_ext_id: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    department_name: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    department_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    department_code: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    resource_name: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    resource_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    resource_ext_id: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    resource_role: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    ktu: Mapped[Optional[Decimal]] = mapped_column(Numeric(8, 3), nullable=True)
    resource_load: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)

    start_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    finish_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    start_datetime: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=False), nullable=True)
    finish_datetime: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=False), nullable=True)

    duration_hours: Mapped[Optional[Decimal]] = mapped_column(Numeric(14, 3), nullable=True)
    quantity: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 6), nullable=True)
    unit: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)

    is_critical: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    position: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
