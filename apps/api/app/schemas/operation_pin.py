"""Схемы закреплений операций, потоков и журнала сдвигов."""
from datetime import datetime
from decimal import Decimal
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

PIN_TYPE_PATTERN = "^(start_not_earlier|finish_at|finish_not_later|capacity_window)$"


class PinCreate(BaseModel):
    operation_id: UUID
    pin_type: str = Field(pattern=PIN_TYPE_PATTERN)
    pin_at: datetime
    resource_id: Optional[UUID] = None
    group_id: Optional[UUID] = None
    is_hard: bool = True
    note: Optional[str] = None


class PinUpdate(BaseModel):
    pin_type: Optional[str] = Field(default=None, pattern=PIN_TYPE_PATTERN)
    pin_at: Optional[datetime] = None
    resource_id: Optional[UUID] = None
    is_hard: Optional[bool] = None
    note: Optional[str] = None


class PinOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    operation_id: UUID
    operation_name: Optional[str] = None
    resource_id: Optional[UUID] = None
    resource_name: Optional[str] = None
    group_id: Optional[UUID] = None
    pin_type: str
    pin_at: datetime
    is_hard: bool
    note: Optional[str] = None


class FlowCreate(BaseModel):
    group_id: UUID
    name: str = Field(min_length=1, max_length=200)
    min_gap_days: Decimal = Field(default=Decimal("0"), ge=0)
    takt_days: Optional[Decimal] = Field(default=None, ge=0)
    priority: int = 100


class FlowUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    min_gap_days: Optional[Decimal] = Field(default=None, ge=0)
    takt_days: Optional[Decimal] = Field(default=None, ge=0)
    priority: Optional[int] = None
    is_active: Optional[bool] = None


class FlowOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    group_id: UUID
    name: str
    min_gap_days: Decimal
    takt_days: Optional[Decimal] = None
    priority: int
    is_active: bool
    operations: list[UUID] = []


class ShiftLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    group_id: Optional[UUID] = None
    project_id: Optional[UUID] = None
    action: str
    payload: dict
    note: Optional[str] = None
    created_at: datetime
