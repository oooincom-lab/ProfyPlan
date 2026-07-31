"""
Версионирование плана: Baseline, ActualExecution, InterProjectDependency.
"""
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class PlanBaseline(BaseModel):
    """Версия плана — замороженный снимок графа + результатов CPM."""
    __tablename__ = "plan_baselines"

    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    version: Mapped[int] = mapped_column(Integer, default=1)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    snapshot_data: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class ActualExecution(BaseModel):
    """Фактическое выполнение операции."""
    __tablename__ = "actual_executions"

    operation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("operations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    fact_start: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    fact_end: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    quantity_completed: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(12, 2), nullable=True
    )
    quantity_defect: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(12, 2), nullable=True
    )
    status: Mapped[str] = mapped_column(
        String(20), default="not_started"
    )  # not_started / in_progress / completed / delayed / cancelled
    deviation_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    recorded_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    source: Mapped[str] = mapped_column(
        String(20), default="manual"
    )  # manual / google_sheets / erp_sync


class InterProjectDependency(BaseModel):
    """Межпроектная зависимость."""
    __tablename__ = "inter_project_dependencies"

    source_project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    source_operation_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("operations.id", ondelete="CASCADE"),
        nullable=True,
    )
    target_project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    target_operation_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("operations.id", ondelete="CASCADE"),
        nullable=True,
    )
    dependency_type: Mapped[str] = mapped_column(
        String(10), default="FS"
    )  # FS / SS / FF
    lag_hours: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), default=0
    )
    lag_unit: Mapped[str] = mapped_column(
        String(10), default="hour"
    )
    created_by: Mapped[str] = mapped_column(
        String(20), default="manual"
    )  # manual / auto_from_bom / auto_from_resources
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
