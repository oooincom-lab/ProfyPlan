"""
Настройки планирования с наследованием по уровням:
рабочий стол → проект → группа.

Каждый уровень хранит только ПЕРЕОПРЕДЕЛЕНИЯ; эффективное значение
собирается по цепочке, ближайший уровень побеждает.
"""
import uuid
from typing import Optional

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class PlanningSettings(BaseModel):
    """Переопределения настроек планирования для уровня (workspace/project/group)."""
    __tablename__ = "planning_settings"
    __table_args__ = (
        UniqueConstraint("tenant_id", "scope", "scope_id", name="uq_planning_settings_scope"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # workspace — настройки рабочего стола (scope_id = NULL)
    # project   — настройки проекта (scope_id = project.id)
    # group     — настройки группы заказов (scope_id = order_groups.id)
    scope: Mapped[str] = mapped_column(String(20), nullable=False)
    scope_id: Mapped[Optional[uuid.UUID]] = mapped_column(nullable=True)
    settings: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
