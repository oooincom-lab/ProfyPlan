"""
Модель операции — единица работы в производственном плане.
"""
import uuid
from decimal import Decimal
from typing import Optional

from sqlalchemy import Boolean, ForeignKey, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import BaseModel


class Operation(BaseModel):
    """Производственная операция."""
    __tablename__ = "operations"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    duration_base: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, default=1.0
    )
    duration_unit: Mapped[str] = mapped_column(
        String(10), default="hour"
    )  # sec / min / hour / day
    setup_time: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), default=0
    )
    teardown_time: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), default=0
    )

    # PERT-поля (для режима PERT)
    to_optimistic: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)
    tm_likely: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)
    tp_pessimistic: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)

    position: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    catalog_operation_id: Mapped[Optional[uuid.UUID]] = mapped_column(nullable=True)
    is_critical: Mapped[bool] = mapped_column(Boolean, default=False)

    # Связи
    dependencies_as_predecessor: Mapped[list["OperationDependency"]] = relationship(
        foreign_keys="OperationDependency.predecessor_id",
        back_populates="predecessor",
    )
    dependencies_as_successor: Mapped[list["OperationDependency"]] = relationship(
        foreign_keys="OperationDependency.successor_id",
        back_populates="successor",
    )


class OperationDependency(BaseModel):
    """Связь между операциями (FS/FF/SS/SF)."""
    __tablename__ = "operation_dependencies"

    predecessor_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("operations.id", ondelete="CASCADE"),
        nullable=False,
    )
    successor_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("operations.id", ondelete="CASCADE"),
        nullable=False,
    )
    dependency_type: Mapped[str] = mapped_column(
        String(10), nullable=False, default="FS"
    )  # FS / FF / SS / SF
    lag_time: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), default=0
    )
    lag_unit: Mapped[str] = mapped_column(
        String(10), default="hour"
    )  # sec / min / hour / day

    predecessor: Mapped["Operation"] = relationship(
        foreign_keys=[predecessor_id],
        back_populates="dependencies_as_predecessor",
    )
    successor: Mapped["Operation"] = relationship(
        foreign_keys=[successor_id],
        back_populates="dependencies_as_successor",
    )


class OperationResource(BaseModel):
    """M:N связь операций с ресурсами."""
    __tablename__ = "operation_resources"

    operation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("operations.id", ondelete="CASCADE"),
        nullable=False,
    )
    resource_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("resources.id", ondelete="CASCADE"),
        nullable=False,
    )
    role: Mapped[str] = mapped_column(
        String(20), default="primary"
    )  # primary / alternative / helper
    efficiency_factor: Mapped[Decimal] = mapped_column(
        Numeric(5, 3), default=1.0
    )
    capacity_demand: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), default=1.0
    )
    duration_override: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(10, 2), nullable=True
    )
    setup_time_override: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(10, 2), nullable=True
    )
    teardown_time_override: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(10, 2), nullable=True
    )
    priority: Mapped[int] = mapped_column(Integer, default=100)
