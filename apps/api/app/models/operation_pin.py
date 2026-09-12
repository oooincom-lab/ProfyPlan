"""
Закрепление операции (pin) — «маркер» на ресурсе, фиксирующий операцию по времени.

При закреплении операция становится статической: CPM её не сдвигает,
оптимизация идёт по остальным операциям.
"""
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class OperationPin(BaseModel):
    __tablename__ = "operation_pins"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    operation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("operations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # ресурс, на котором стоит маркер (может быть не задан — «привязка к дате»)
    resource_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("resources.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # группа заказов, в рамках которой поставлено закрепление (для потоковых сценариев)
    group_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("order_groups.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # тип ограничения: start_not_earlier | finish_at | finish_not_later | capacity_window
    pin_type: Mapped[str] = mapped_column(String(30), nullable=False)
    pin_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    is_hard: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
