"""Pydantic-схемы ресурсов заказа."""
from datetime import datetime
from decimal import Decimal
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class OrderResourceCreate(BaseModel):
    resource_id: UUID
    department_id: Optional[UUID] = None
    capacity: Optional[Decimal] = Field(None, ge=0)


class OrderResourceUpdate(BaseModel):
    department_id: Optional[UUID] = None
    capacity: Optional[Decimal] = Field(None, ge=0)


class OrderResourceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: Optional[UUID] = None  # id записи order_resources (null — без переопределения)
    order_id: UUID
    resource_id: UUID
    resource_name: str
    resource_unit: Optional[str] = None
    resource_type: Optional[str] = None
    department_id: Optional[UUID] = None
    department_name: Optional[str] = None
    capacity: Optional[Decimal] = None
    created_at: Optional[datetime] = None
