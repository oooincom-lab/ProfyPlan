"""
Квоты ресурсов по подразделениям (ResourceDepartmentQuota).

Подразделение может использовать ресурс лишь на часть его мощности
(например, общий ресурс делится между цехами).
"""
import uuid
from decimal import Decimal
from typing import Optional

from sqlalchemy import Boolean, ForeignKey, Numeric, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class ResourceDepartmentQuota(BaseModel):
    """Квота ресурса для подразделения: доля мощности ресурса (0..1)."""
    __tablename__ = "resource_department_quotas"
    __table_args__ = (
        UniqueConstraint("department_id", "resource_id", name="uq_dept_resource_quota"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    department_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("departments.id", ondelete="CASCADE"), nullable=False, index=True
    )
    resource_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("resources.id", ondelete="CASCADE"), nullable=False, index=True
    )
    quota_share: Mapped[Decimal] = mapped_column(
        Numeric(5, 3), default=Decimal("1.0"), nullable=False
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
