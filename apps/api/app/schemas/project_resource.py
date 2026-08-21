"""
Pydantic-схемы для регистра ресурсов проекта (ProjectResource).
"""
from datetime import date
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field


class ProjectResourceCreate(BaseModel):
    resource_id: str
    schedule_id: Optional[str] = None
    capacity_share: Decimal = Field(default=1.0, ge=0, le=1)
    date_from: Optional[date] = None
    date_to: Optional[date] = None


class ProjectResourceUpdate(BaseModel):
    schedule_id: Optional[str] = None
    capacity_share: Optional[Decimal] = Field(default=None, ge=0, le=1)
    date_from: Optional[date] = None
    date_to: Optional[date] = None


class ProjectResourceOut(BaseModel):
    id: str
    project_id: str
    resource_id: str
    schedule_id: Optional[str] = None
    capacity_share: Decimal = 1.0
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    resource_name: Optional[str] = None
    schedule_name: Optional[str] = None

    class Config:
        from_attributes = True
