"""
Pydantic-схемы для ресурсов.
"""
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field


class ResourceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    parent_id: Optional[str] = None
    resource_type: str = Field(default="equipment")
    capacity_per_unit: Decimal = Field(default=1.0, ge=0)
    capacity_unit: str = Field(default="hour")
    unit: Optional[str] = None
    country_code: Optional[str] = Field(None, min_length=2, max_length=2)
    schedule_id: Optional[str] = None
    is_active: bool = True


class ResourceUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    resource_type: Optional[str] = None
    capacity_per_unit: Optional[Decimal] = None
    capacity_unit: Optional[str] = None
    unit: Optional[str] = None
    country_code: Optional[str] = Field(None, min_length=2, max_length=2)
    schedule_id: Optional[str] = None
    is_active: Optional[bool] = None


class ResourceOut(BaseModel):
    id: str
    project_id: Optional[str] = None
    name: str
    parent_id: Optional[str] = None
    resource_type: str
    capacity_per_unit: Decimal
    capacity_unit: str
    unit: Optional[str] = None
    country_code: Optional[str] = None
    schedule_id: Optional[str] = None
    is_active: bool

    class Config:
        from_attributes = True
