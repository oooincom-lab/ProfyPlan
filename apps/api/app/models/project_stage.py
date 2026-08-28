# -*- coding: utf-8 -*-
"""Регистр «Этапы проекта» — модель.

Используется для группировки операций маршрутов по этапам работ проекта
(например: Свайные работы, Бетонирование опор, Надвижка пролётов).
Поле-ссылка «Этап» в операции маршрута (Шаг 4 плана v2.15).
"""
import uuid
from typing import Optional

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class ProjectStage(BaseModel):
    """Этап проекта (регистр этапов, уникален в рамках проекта)."""
    __tablename__ = "project_stages"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    code: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
