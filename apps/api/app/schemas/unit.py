"""Pydantic-схемы для единиц измерения."""
from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class UnitCreate(BaseModel):
    code: str = Field(..., min_length=1, max_length=10)
    symbol_int: str = Field(..., min_length=1, max_length=10)
    symbol_ru: str = Field(..., min_length=1, max_length=10)
    name_ru: str = Field(..., min_length=1, max_length=100)
    name_en: str = Field(..., min_length=1, max_length=100)
    factor: float = Field(default=1.0)
    is_base: bool = False


class UnitUpdate(BaseModel):
    code: Optional[str] = Field(None, max_length=10)
    symbol_int: Optional[str] = Field(None, max_length=10)
    symbol_ru: Optional[str] = Field(None, max_length=10)
    name_ru: Optional[str] = Field(None, max_length=100)
    name_en: Optional[str] = Field(None, max_length=100)
    factor: Optional[float] = None
    is_base: Optional[bool] = None
    is_active: Optional[bool] = None


class UnitOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID
    code: str
    symbol_int: str
    symbol_ru: str
    name_ru: str
    name_en: str
    factor: float
    is_base: bool
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime] = None
