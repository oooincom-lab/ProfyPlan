"""Каркас интеграций с внешними системами (14.10.2026).

Три сущности:
- IntegrationConnection — настройка подключения (конфигурация 1С, транспорт, параметры, активность);
- ExchangeLogEntry — журнал обмена (каждый пакет: что вошло/вышло, статус, ошибки);
- ExchangeInboxItem — входящие элементы пакетов (staging до обработки конвейером профиля).

Пакеты — единый конверт profyplan.exchange.v1 (см. services/integration_exchange.py).
"""
import uuid
from typing import Optional

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class IntegrationConnection(BaseModel):
    """Настройка подключения к внешней системе (1С:УНФ/КА/ERP и др.)."""

    __tablename__ = "integration_connections"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    # Профиль внешней системы: 1c_unf / 1c_ka / 1c_erp / custom
    profile: Mapped[str] = mapped_column(String(20), nullable=False, default="1c_unf")
    # Транспорт: file / http / odata
    transport: Mapped[str] = mapped_column(String(10), nullable=False, default="file")
    settings: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class ExchangeLogEntry(BaseModel):
    """Запись журнала обмена: один обработанный/сформированный пакет."""

    __tablename__ = "exchange_log"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    connection_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("integration_connections.id", ondelete="SET NULL"), nullable=True, index=True
    )
    direction: Mapped[str] = mapped_column(String(3), nullable=False, default="in")  # in / out
    kind: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="ok")  # ok / partial / error
    entities_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    file_name: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    packet_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    details: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)


class ExchangeInboxItem(BaseModel):
    """Входящий элемент пакета (staging): обрабатывается конвейером профиля (срез 2+)."""

    __tablename__ = "exchange_inbox_items"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    connection_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("integration_connections.id", ondelete="SET NULL"), nullable=True, index=True
    )
    log_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("exchange_log.id", ondelete="SET NULL"), nullable=True
    )
    entity_type: Mapped[str] = mapped_column(String(60), nullable=False, default="")
    entity_uid: Mapped[Optional[str]] = mapped_column(String(120), nullable=True, index=True)
    op: Mapped[str] = mapped_column(String(20), nullable=False, default="upsert")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")  # pending / applied / skipped / error
    payload: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
