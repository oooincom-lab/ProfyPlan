"""Pydantic-схемы для производственных календарей (ProductionCalendar)."""
from datetime import date, datetime
from decimal import Decimal
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ProductionCalendarDayCreate(BaseModel):
    date: date
    day_type: str = Field("work", pattern="^(work|weekend|holiday|preholiday)$")
    hours: Optional[Decimal] = Field(None, ge=0, le=24)


class ProductionCalendarDayOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    calendar_id: UUID
    date: date
    day_type: str
    hours: Optional[Decimal] = None


class ProductionCalendarCreate(BaseModel):
    country_code: str = Field(..., min_length=2, max_length=2)
    year: int = Field(..., ge=2000, le=2100)
    name: Optional[str] = Field(None, max_length=255)
    days: list[ProductionCalendarDayCreate] = []


class ProductionCalendarUpdate(BaseModel):
    country_code: Optional[str] = Field(None, min_length=2, max_length=2)
    year: Optional[int] = Field(None, ge=2000, le=2100)
    name: Optional[str] = Field(None, max_length=255)
    days: Optional[list[ProductionCalendarDayCreate]] = None


class ProductionCalendarSeed(BaseModel):
    country_code: str = Field(..., min_length=2, max_length=2)
    year: int = Field(..., ge=2000, le=2100)


class ProductionCalendarOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID
    country_code: str
    year: int
    name: str
    created_at: datetime
    days: list[ProductionCalendarDayOut] = []
