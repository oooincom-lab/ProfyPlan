"""Pydantic-схемы квот ресурсов по подразделениям."""
from decimal import Decimal
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class DeptQuotaCreate(BaseModel):
    department_id: UUID
    resource_id: UUID
    quota_share: Decimal = Field(default=Decimal("1.0"), ge=0, le=1)


class DeptQuotaUpdate(BaseModel):
    quota_share: Optional[Decimal] = Field(None, ge=0, le=1)
    is_active: Optional[bool] = None


class DeptQuotaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID
    department_id: UUID
    resource_id: UUID
    quota_share: Decimal
    is_active: bool
    department_name: Optional[str] = None
    resource_name: Optional[str] = None
