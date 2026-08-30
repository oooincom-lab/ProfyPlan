"""Исключения доступности (Шаг B каскада календарей).

Ремонт, вынужденный простой, отпуск, форс-мажор, обслуживание — интервалы,
в которые ресурс/подразделение/проект недоступен (или ограничен).
Перекрывает любой график (каскад и дефолт).
"""
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class CalendarException(BaseModel):
    """Исключение доступности на уровне ресурса / подразделения / проекта."""
    __tablename__ = "calendar_exceptions"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    level: Mapped[str] = mapped_column(String(20), nullable=False)  # resource | department | project
    resource_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("resources.id", ondelete="CASCADE"), nullable=True, index=True
    )
    department_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("departments.id", ondelete="CASCADE"), nullable=True, index=True
    )
    project_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=True, index=True
    )
    kind: Mapped[str] = mapped_column(String(30), nullable=False)  # repair | downtime | vacation | force_majeure | maintenance
    date_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    date_to: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    hours_override: Mapped[Optional[float]] = mapped_column(Numeric(4, 2), nullable=True)  # доступные часы в день (null = полная недоступность)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
