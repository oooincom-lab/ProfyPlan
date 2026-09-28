"""Цель по области (блок 6.30 плана; спецификация — Дополнение 16).

Одна строка = цель одной области: проекта, куста/группы, ветки или заказа.
Даты и их источник хранятся раздельно, фиксация — только там, где её поставил человек.
"""
import uuid
from datetime import date
from typing import Optional

from sqlalchemy import Boolean, Date, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class Goal(BaseModel):
    __tablename__ = "goals"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # Область: project | cluster | group | order
    area_type: Mapped[str] = mapped_column(String(20), nullable=False, default="project")
    area_ref: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)

    contract_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    working_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    # Источник даты: calculated — поставлена расчётом, manual — человеком
    contract_source: Mapped[str] = mapped_column(String(20), nullable=False, default="manual")
    working_source: Mapped[str] = mapped_column(String(20), nullable=False, default="manual")

    # Фиксация хранится только на строке, где её поставил человек; у подчинённых выводится
    fixed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
