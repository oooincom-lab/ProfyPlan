"""Pydantic-схемы для справочника графиков работы (WorkSchedule)."""
from datetime import datetime
from decimal import Decimal
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class WorkScheduleSlotCreate(BaseModel):
    day_of_week: Optional[int] = Field(None, ge=0, le=6)
    cycle_day: Optional[int] = Field(None, ge=1)
    start_hour: Decimal = Field(..., ge=0, le=24)
    end_hour: Decimal = Field(..., ge=0, le=24)
    kind: str = Field("work", pattern="^(work|break)$")


class WorkScheduleSlotOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    schedule_id: UUID
    day_of_week: Optional[int] = None
    cycle_day: Optional[int] = None
    start_hour: Decimal
    end_hour: Decimal
    kind: str


class WorkScheduleCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    fill_mode: str = Field("weekdays", pattern="^(weekdays|cycle)$")
    cycle_length: Optional[int] = Field(None, ge=1, le=60)
    timezone: str = Field("Europe/Moscow", max_length=50)
    slots: list[WorkScheduleSlotCreate] = []


class WorkScheduleUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    fill_mode: Optional[str] = Field(None, pattern="^(weekdays|cycle)$")
    cycle_length: Optional[int] = Field(None, ge=1, le=60)
    timezone: Optional[str] = Field(None, max_length=50)
    is_active: Optional[bool] = None
    slots: Optional[list[WorkScheduleSlotCreate]] = None


class WorkScheduleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID
    name: str
    fill_mode: str
    cycle_length: Optional[int] = None
    timezone: str
    is_active: bool
    created_at: datetime
    slots: list[WorkScheduleSlotOut] = []
