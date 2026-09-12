"""
Журнал сдвигов и закреплений по группам: кто, когда, что и на сколько сдвинул.

Используется для отката, аудита и воспроизводимости итеративного планирования
(порядок обхода заказов влияет на результат — прогон должен быть повторяемым).
"""
import uuid
from typing import Optional

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class GroupShiftLog(BaseModel):
    __tablename__ = "group_shift_logs"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    group_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("order_groups.id", ondelete="SET NULL"), nullable=True, index=True
    )
    project_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("projects.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # действие: pin | unpin | shift | promote | flow
    action: Mapped[str] = mapped_column(String(20), nullable=False)
    # подробности: закрепление, дельта, «до/после» по заказам и операциям
    payload: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    author_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
