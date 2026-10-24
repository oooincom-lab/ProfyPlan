"""Сотрудник — организационная единица, не ресурс планирования."""
import uuid
from typing import Optional

from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class Employee(BaseModel):
    __tablename__ = "employees"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    department_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("departments.id", ondelete="SET NULL"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    code: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    position: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")

    ext_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    ext_uid: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="profyplan", server_default="profyplan")
    external_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    external_name_ack: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    name_overridden: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    external_revision: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
