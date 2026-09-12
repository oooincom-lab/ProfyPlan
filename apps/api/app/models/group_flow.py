"""
Поток (участок) внутри группы заказов: набор операций, которые ведутся
последовательно по фронтам (захваткам) с непрерывностью ресурса.
"""
import uuid
from decimal import Decimal
from typing import Optional

from sqlalchemy import Boolean, ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class GroupFlow(BaseModel):
    __tablename__ = "group_flows"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    group_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("order_groups.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    # минимальный разрыв между фронтами, дней (0 — встык)
    min_gap_days: Mapped[Decimal] = mapped_column(Numeric(6, 2), default=0, nullable=False)
    # шаг потока (ритм), дней; NULL — вычисляется из ритмов фронтов
    takt_days: Mapped[Optional[Decimal]] = mapped_column(Numeric(6, 2), nullable=True)
    # приоритет потока при конфликте за общий ресурс
    priority: Mapped[int] = mapped_column(default=100, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class GroupFlowOperation(BaseModel):
    """Привязка операции к потоку (участку)."""
    __tablename__ = "group_flow_operations"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    flow_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("group_flows.id", ondelete="CASCADE"), nullable=False, index=True
    )
    operation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("operations.id", ondelete="CASCADE"), nullable=False, index=True
    )
