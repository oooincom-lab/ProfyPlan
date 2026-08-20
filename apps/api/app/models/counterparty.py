"""
Справочник контрагентов — заказчики, поставщики, подрядчики.
Используется как источник для поля «Клиент» заказа.
"""
import uuid
from typing import Optional

from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class Counterparty(BaseModel):
    """Контрагент (заказчик/поставщик)."""
    __tablename__ = "counterparties"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    inn: Mapped[Optional[str]] = mapped_column(String(12), nullable=True, index=True)
    kpp: Mapped[Optional[str]] = mapped_column(String(9), nullable=True)
    ogrn: Mapped[Optional[str]] = mapped_column(String(15), nullable=True)
    note: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    external_code: Mapped[Optional[str]] = mapped_column(
        String(100), nullable=True, index=True
    )  # внешний код для сопоставления с внешними системами (ERP)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
