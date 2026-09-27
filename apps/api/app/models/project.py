"""
Модель проекта — корневая сущность ProfyPlan.
"""
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text
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
    )  # cpm / pert_cpm / cpm_ccm / pert_ccm — совместимость: повторяет сочетание осей ниже

    # Расчёты (блок 6.16.7): две НЕЗАВИСИМЫЕ оси. Хранятся раздельно;
    # default_method остаётся для совместимости и держится в согласии с ними.
    planning_logic: Mapped[str] = mapped_column(
        String(10), nullable=False, default="cpm", server_default="cpm"
    )  # cpm / ccm
    uncertainty_analysis: Mapped[str] = mapped_column(
        String(10), nullable=False, default="none", server_default="none"
    )  # none / pert / mc
    monte_carlo_runs: Mapped[int] = mapped_column(
        Integer, nullable=False, default=10000, server_default="10000"
    )
    confidence_level: Mapped[float] = mapped_column(
        Float, nullable=False, default=0.8, server_default="0.8"
    )
    use_history: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )  # включается только решением пользователя

    # Политика даты плана (блок 6.29): расчётная дата или процентиль (p50/p80/заданный)
    date_policy: Mapped[str] = mapped_column(String(20), nullable=False, default="calculated", server_default="calculated")
    date_probability: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Цели проекта (блок 6.14г): назначения человека, при пересчёте не сбрасываются
    goal_contract_date: Mapped[Optional[object]] = mapped_column(Date, nullable=True)
    goal_working_date: Mapped[Optional[object]] = mapped_column(Date, nullable=True)
    country_code: Mapped[str] = mapped_column(
        String(2), default="RU"
    )
    ext_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    start_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    due_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    priority: Mapped[str] = mapped_column(String(20), default="normal")
    customer: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    use_shared_resources: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )  # использовать ли общие (shared) ресурсы каталога

    schedule_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("work_schedules.id", ondelete="SET NULL"), nullable=True
    )  # график проекта (каскад календарей, уровень 3)
    created_by: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
