"""
Регистр ресурсов проекта (ProjectResource) — привязка ресурса к проекту
с возможным переопределением графика работы (schedule_id),
долей мощности (capacity_share) и периодом задействования (date_from/date_to).
"""
import uuid
from datetime import date
from decimal import Decimal
from typing import Optional

from sqlalchemy import Boolean, Date, ForeignKey, Numeric, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class ProjectResource(BaseModel):
    """Привязка ресурса к проекту + переопределение графика + доля мощности + период."""
    __tablename__ = "project_resources"
    __table_args__ = (
        UniqueConstraint("project_id", "resource_id", name="uq_project_resource"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    resource_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("resources.id", ondelete="CASCADE"), nullable=False, index=True
    )
    schedule_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("work_schedules.id", ondelete="SET NULL"), nullable=True
    )
    capacity_share: Mapped[Decimal] = mapped_column(
        Numeric(5, 3), default=1.0, nullable=False
    )
    exclusive: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false"), nullable=False
    )  # эксклюзивная бронь: ресурс занят целиком (нужен весь кран / переналадка участка),
       # любое пересечение с ней — конфликт независимо от доли мощности
    date_from: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    date_to: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
