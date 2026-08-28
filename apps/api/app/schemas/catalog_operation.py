"""Pydantic-схемы каталога операций."""
from datetime import datetime
from decimal import Decimal
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class CatalogOperationCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    default_duration_hours: Decimal = Field(default=Decimal("1"), ge=0)
    notes: Optional[str] = None


class CatalogOperationUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    default_duration_hours: Optional[Decimal] = Field(None, ge=0)
    notes: Optional[str] = None


class CatalogOperationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID
    name: str
    default_duration_hours: Decimal
    notes: Optional[str] = None
    created_at: datetime
