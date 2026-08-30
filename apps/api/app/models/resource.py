"""
Модель ресурса — оборудование, сотрудники, бригады.
"""
import uuid
from decimal import Decimal
from typing import Optional

from sqlalchemy import Boolean, ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class Resource(BaseModel):
    """Производственный ресурс."""
    __tablename__ = "resources"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    parent_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("resources.id", ondelete="SET NULL"),
        nullable=True,
    )  # для иерархии
    resource_type: Mapped[str] = mapped_column(
        String(20), nullable=False
    )  # equipment / employee / team / line / area
    capacity_per_unit: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), default=1.0
    )  # мощность за единицу
    capacity_unit: Mapped[str] = mapped_column(
        String(10), default="hour"
    )  # hour / day / shift
    unit: Mapped[Optional[str]] = mapped_column(
        String(20)
    )  # шт / кг / л (что производит)
    country_code: Mapped[Optional[str]] = mapped_column(
        String(2), nullable=True
    )  # страна производственного календаря ресурса (nullable = наследовать от проекта)
    schedule_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("work_schedules.id", ondelete="SET NULL"), nullable=True
    )  # график работы по умолчанию
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    ext_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    department_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("departments.id", ondelete="SET NULL"), nullable=True
    )  # принадлежность подразделению (каскад календарей, уровень 2)
