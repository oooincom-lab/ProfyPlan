"""Версии графиков ресурса (Шаг A каскада календарей).

Назначение графика с даты действия: ресурс работает по schedule_id
с valid_from (история смены графиков: «с 01.10 — двухсменный»).
"""
import uuid
from datetime import date
from typing import Optional

from sqlalchemy import Date, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class ScheduleAssignment(BaseModel):
    """Назначение графика ресурсу с даты действия."""
    __tablename__ = "schedule_assignments"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    resource_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("resources.id", ondelete="CASCADE"), nullable=False, index=True
    )
    schedule_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("work_schedules.id", ondelete="CASCADE"), nullable=False
    )
    valid_from: Mapped[date] = mapped_column(Date, nullable=False)
    note: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
