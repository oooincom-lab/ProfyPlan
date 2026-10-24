"""Склады: справочник для заказов поставщику и перемещений."""
import uuid
from typing import Optional

from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class Warehouse(BaseModel):
    """Склад или складская площадка."""
    __tablename__ = "warehouses"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    code: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    organization_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True, index=True
    )
    department_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("departments.id", ondelete="SET NULL"), nullable=True, index=True
    )
    ext_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    ext_uid: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="profyplan", server_default="profyplan")
    external_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    external_name_ack: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    name_overridden: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    external_revision: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    needs_mapping: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
