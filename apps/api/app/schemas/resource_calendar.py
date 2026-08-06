"""
Pydantic-схемы для календарей ресурсов.
"""
from datetime import date
from decimal import Decimal
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field


# ── Slot ──

class CalendarSlotBase(BaseModel):
    """Базовые поля слота."""
    day_of_week: int = Field(ge=-1, le=6, description="0=Пн..6=Вс, -1=исключение")
    start_hour: Decimal = Field(ge=0, le=24, decimal_places=2, description="Час начала (8.0 = 08:00)")
    end_hour: Decimal = Field(ge=0, le=24, decimal_places=2, description="Час конца (17.0 = 17:00)")
    is_active: bool = True
    exception_date: Optional[date] = None


class CalendarSlotCreate(CalendarSlotBase):
    """Создание слота."""
    pass


class CalendarSlotOut(CalendarSlotBase):
    """Вывод слота."""
    id: str
    calendar_id: str

    model_config = {"from_attributes": True}


# ── Calendar ──

class ResourceCalendarBase(BaseModel):
    """Базовые поля календаря."""
    name: str = "Стандартный календарь"
    timezone: str = "Europe/Moscow"
    is_active: bool = True


class ResourceCalendarCreate(ResourceCalendarBase):
    """Создание календаря (с опциональным набором слотов)."""
    slots: list[CalendarSlotCreate] = []


class ResourceCalendarUpdate(BaseModel):
    """Обновление календаря."""
    name: Optional[str] = None
    timezone: Optional[str] = None
    is_active: Optional[bool] = None


class ResourceCalendarOut(ResourceCalendarBase):
    """Вывод календаря."""
    id: str
    resource_id: str
    slots: list[CalendarSlotOut] = []

    model_config = {"from_attributes": True}
