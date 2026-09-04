"""Справочник подразделений (Шаг 4 плана v2.15).

Подразделения предприятия (цеха, площадки, отделы) — выбираются в операциях
маршрутов и ресурсах.
"""
import uuid
from typing import Optional

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class Department(BaseModel):
    """Подразделение (общий для всех проектов tenant)."""
    __tablename__ = "departments"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    code: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    schedule_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("work_schedules.id", ondelete="SET NULL"), nullable=True
    )  # график подразделения (каскад календарей, уровень 2)
    parent_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("departments.id", ondelete="SET NULL"), nullable=True, index=True
    )  # родительское подразделение (иерархия: цех → участок → бригада)
