"""Pydantic-схемы для справочника контрагентов."""
from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class CounterpartyCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    inn: Optional[str] = Field(None, max_length=12)
    kpp: Optional[str] = Field(None, max_length=9)
    ogrn: Optional[str] = Field(None, max_length=15)
    note: Optional[str] = Field(None, max_length=1000)
    external_code: Optional[str] = Field(None, max_length=100)


class CounterpartyUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    inn: Optional[str] = Field(None, max_length=12)
    kpp: Optional[str] = Field(None, max_length=9)
    ogrn: Optional[str] = Field(None, max_length=15)
    note: Optional[str] = Field(None, max_length=1000)
    external_code: Optional[str] = Field(None, max_length=100)
    is_active: Optional[bool] = None


class CounterpartyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID
    name: str
    inn: Optional[str] = None
    kpp: Optional[str] = None
    ogrn: Optional[str] = None
    note: Optional[str] = None
    external_code: Optional[str] = None
    is_active: bool
    created_at: datetime
