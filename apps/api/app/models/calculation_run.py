"""Запуск расчёта как объект (блок 6.16.3 плана).

Каждый расчёт сохраняется отдельной записью: область, обе оси методов, параметры,
отпечаток входных данных и сводка результата. Это основание для сравнения методов,
истории и прослеживаемости: по любой цифре видно, на какую дату и по какой версии
данных она получена. Результаты не удаляются — устаревший запуск помечается
неактуальным на уровне интерфейса (блок 6.21).
"""
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, JSON, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class CalculationRun(BaseModel):
    """Один запуск расчёта: когда, чем, по каким данным и с каким результатом."""

    __tablename__ = "calculation_runs"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # Область расчёта: проект / куст / группа / пул (блок 6.16.3)
    area: Mapped[str] = mapped_column(String(20), nullable=False, default="project")
    area_ref: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)

    # Обе оси метода (блок 6.16.2): логика планирования и модель оценки
    planning_logic: Mapped[str] = mapped_column(String(10), nullable=False, default="cpm")
    uncertainty_analysis: Mapped[str] = mapped_column(String(10), nullable=False, default="none")

    # Параметры запуска и отпечаток входных данных (версия данных)
    params: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    data_fingerprint: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    data_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # Результат: сводка; замечания о том, что ещё не считается, пишутся прямо в него
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="done")
    result: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # Запуск получен импортом реестра (файл), а не расчётом на этом стенде (остаток 6.22)
    imported: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
