"""Pydantic-схемы событий мощности ресурса (ResourceEvent)."""
from datetime import datetime
from decimal import Decimal
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

EVENT_TYPE_PATTERN = (
    "^(boost|reduced|breakdown|maintenance|modernization|condition_change|other)$"
)


class ResourceEventCreate(BaseModel):
    resource_id: UUID
    project_id: Optional[UUID] = None
    event_type: str = Field("boost", pattern=EVENT_TYPE_PATTERN)
    capacity_multiplier: Optional[Decimal] = Field(None, ge=0, le=100)
    capacity_absolute: Optional[Decimal] = Field(None, ge=0)
    reason: str = Field(..., min_length=1, max_length=2000)
    related_operation_id: Optional[UUID] = None
    base_document_type: Optional[str] = Field(None, max_length=50)
    base_document_id: Optional[UUID] = None
    date_from: datetime
    date_to: datetime


class ResourceEventUpdate(BaseModel):
    project_id: Optional[UUID] = None
    event_type: Optional[str] = Field(None, pattern=EVENT_TYPE_PATTERN)
    capacity_multiplier: Optional[Decimal] = Field(None, ge=0, le=100)
    capacity_absolute: Optional[Decimal] = Field(None, ge=0)
    reason: Optional[str] = Field(None, min_length=1, max_length=2000)
    related_operation_id: Optional[UUID] = None
    base_document_type: Optional[str] = Field(None, max_length=50)
    base_document_id: Optional[UUID] = None
    date_from: Optional[datetime] = None
    date_to: Optional[datetime] = None
    is_active: Optional[bool] = None


class ResourceEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID
    resource_id: UUID
    project_id: Optional[UUID] = None
    event_type: str
    capacity_multiplier: Optional[Decimal] = None
    capacity_absolute: Optional[Decimal] = None
    reason: str
    related_operation_id: Optional[UUID] = None
    base_document_type: Optional[str] = None
    base_document_id: Optional[UUID] = None
    date_from: datetime
    date_to: datetime
    is_active: bool
    created_at: datetime
