"""Схемы справочника операций."""
from decimal import Decimal
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field


class CatalogOperationCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    code: Optional[str] = Field(None, max_length=64)
    article: Optional[str] = Field(None, max_length=128)
    article_source: Optional[str] = Field(None, max_length=128)
    op_type: str = Field("work", pattern="^(work|wait|milestone)$")
    unit: str = Field("hour", max_length=10)
    norm_typical: Optional[Decimal] = Field(None, ge=0)
    norm_min: Optional[Decimal] = Field(None, ge=0)
    norm_max: Optional[Decimal] = Field(None, ge=0)
    setup_time: Decimal = Field(default=Decimal("0"), ge=0)
    teardown_time: Decimal = Field(default=Decimal("0"), ge=0)
    default_resource_id: Optional[UUID] = None
    tags: Optional[str] = Field(None, max_length=255)
    notes: Optional[str] = None
    is_active: bool = True


class CatalogOperationUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    code: Optional[str] = Field(None, max_length=64)
    article: Optional[str] = Field(None, max_length=128)
    article_source: Optional[str] = Field(None, max_length=128)
    op_type: Optional[str] = Field(None, pattern="^(work|wait|milestone)$")
    unit: Optional[str] = Field(None, max_length=10)
    norm_typical: Optional[Decimal] = Field(None, ge=0)
    norm_min: Optional[Decimal] = Field(None, ge=0)
    norm_max: Optional[Decimal] = Field(None, ge=0)
    setup_time: Optional[Decimal] = Field(None, ge=0)
    teardown_time: Optional[Decimal] = Field(None, ge=0)
    default_resource_id: Optional[UUID] = None
    tags: Optional[str] = Field(None, max_length=255)
    notes: Optional[str] = None
    is_active: Optional[bool] = None
    updated_by: Optional[str] = Field(None, max_length=255)


class CatalogOperationOut(BaseModel):
    id: UUID
    tenant_id: UUID
    name: str
    code: Optional[str] = None
    article: Optional[str] = None
    article_source: Optional[str] = None
    op_type: str = "work"
    unit: str = "hour"
    norm_typical: Optional[Decimal] = None
    norm_min: Optional[Decimal] = None
    norm_max: Optional[Decimal] = None
    setup_time: Decimal = Decimal("0")
    teardown_time: Decimal = Decimal("0")
    default_resource_id: Optional[UUID] = None
    tags: Optional[str] = None
    notes: Optional[str] = None
    is_active: bool = True
    updated_by: Optional[str] = None
    updated_at: Optional[str] = None
    last_change: Optional[dict] = None

    model_config = {"from_attributes": True}
