"""
Модель проекта — корневая сущность ProfyPlan.
"""
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import BaseModel


class Project(BaseModel):
    """Производственный проект."""
    __tablename__ = "projects"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    status: Mapped[str] = mapped_column(
        String(20), default="draft"
    )  # draft / active / completed / archived
    mode: Mapped[str] = mapped_column(
        String(20), default="quick"
    )  # quick / project / recurring
    default_method: Mapped[str] = mapped_column(
        String(20), default="cpm"
    )  # cpm / pert_cpm / cpm_ccm / pert_ccm
    country_code: Mapped[str] = mapped_column(
        String(2), default="RU"
    )
    ext_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    start_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    due_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    priority: Mapped[str] = mapped_column(String(20), default="normal")
    customer: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    schedule_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("work_schedules.id", ondelete="SET NULL"), nullable=True
    )  # график проекта (каскад календарей, уровень 3)
    created_by: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
