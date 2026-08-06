"""
Pydantic-схемы для операций.
"""
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field


class OperationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    duration_base: Decimal = Field(ge=0)
    duration_unit: str = "hour"
    setup_time: Decimal = Field(default=0, ge=0)
    teardown_time: Decimal = Field(default=0, ge=0)
    to_optimistic: Optional[Decimal] = None
    tm_likely: Optional[Decimal] = None
    tp_pessimistic: Optional[Decimal] = None
    position: Optional[int] = None


class OperationUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    duration_base: Optional[Decimal] = None
    duration_unit: Optional[str] = None
    setup_time: Optional[Decimal] = None
    teardown_time: Optional[Decimal] = None
    to_optimistic: Optional[Decimal] = None
    tm_likely: Optional[Decimal] = None
    tp_pessimistic: Optional[Decimal] = None
    position: Optional[int] = None


class OperationOut(BaseModel):
    id: str
    project_id: str
    name: str
    duration_base: Decimal
    duration_unit: str
    setup_time: Decimal
    teardown_time: Decimal
    to_optimistic: Optional[Decimal] = None
    tm_likely: Optional[Decimal] = None
    tp_pessimistic: Optional[Decimal] = None
    position: Optional[int] = None
    is_critical: bool = False

    class Config:
        from_attributes = True


class DependencyCreate(BaseModel):
    predecessor_id: str
    successor_id: str
    dependency_type: str = Field(default="FS", pattern="^(FS|FF|SS|SF)$")
    lag_time: Decimal = Field(default=0, ge=0)
    lag_unit: str = "hour"


class DependencyOut(BaseModel):
    id: str
    predecessor_id: str
    successor_id: str
    dependency_type: str
    lag_time: Decimal
    lag_unit: str

    class Config:
        from_attributes = True


class OperationResourceCreate(BaseModel):
    resource_id: str
    role: str = "primary"  # primary / alternative / helper
    efficiency_factor: Decimal = Field(default=Decimal("1.0"), ge=0, le=3)
    capacity_demand: Decimal = Field(default=Decimal("1.0"), ge=0)
    duration_override: Optional[Decimal] = None
    setup_time_override: Optional[Decimal] = None
    teardown_time_override: Optional[Decimal] = None
    priority: int = 100


class OperationResourceOut(BaseModel):
    id: str
    operation_id: str
    resource_id: str
    role: str
    efficiency_factor: Decimal
    capacity_demand: Decimal
    duration_override: Optional[Decimal] = None
    setup_time_override: Optional[Decimal] = None
    teardown_time_override: Optional[Decimal] = None
    priority: int

    class Config:
        from_attributes = True
