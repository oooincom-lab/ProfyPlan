"""
Pydantic-схемы для календарей поставщиков.
"""
from datetime import time
from decimal import Decimal
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class SupplierSlot(BaseModel):
    """Временной слот поставщика."""
    day_of_week: int = Field(ge=0, le=6, description="0=Mon ... 6=Sun")
    is_working: bool = True
    start_time: Optional[time] = time(9, 0)
    end_time: Optional[time] = time(18, 0)


class SupplierCalendarUpsert(BaseModel):
    """Создание/обновление календаря поставщика."""
    supplier_name: Optional[str] = None
    lead_time_days: Decimal = Field(default=0, ge=0)
    min_order_qty: Optional[Decimal] = Field(default=None, ge=0)
    notes: Optional[str] = None
    slots: list[SupplierSlot] = Field(default_factory=list)


class SupplierCalendarOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID
    supplier_id: str
    supplier_name: Optional[str] = None
    day_of_week: int
    is_working: bool
    start_time: Optional[time] = None
    end_time: Optional[time] = None
    lead_time_days: Decimal
    min_order_qty: Optional[Decimal] = None
    notes: Optional[str] = None


class SupplierCalendarFull(BaseModel):
    """Полный календарь поставщика (все слоты)."""
    supplier_id: str
    supplier_name: Optional[str] = None
    lead_time_days: Decimal
    min_order_qty: Optional[Decimal] = None
    notes: Optional[str] = None
    slots: list[SupplierCalendarOut]


class ProcurementSummary(BaseModel):
    """Сводка закупок для multi-project."""
    supplier_id: str
    supplier_name: Optional[str] = None
    total_orders: int
    items: list[dict]
    earliest_order_date: Optional[str] = None
    latest_need_date: Optional[str] = None
