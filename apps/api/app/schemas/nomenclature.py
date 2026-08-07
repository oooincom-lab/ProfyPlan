"""Pydantic-схемы для номенклатуры."""
from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class NomenclatureCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    code: Optional[str] = None
    article: Optional[str] = Field(None, max_length=100)
    ntype: str = Field(default="material", pattern="^(product|material|semi_finished|service)$")
    unit: str = Field(default="pcs", max_length=20)
    unit_id: Optional[UUID] = None
    description: Optional[str] = None
    ext_id: Optional[str] = None


class NomenclatureUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    code: Optional[str] = None
    article: Optional[str] = Field(None, max_length=100)
    ntype: Optional[str] = Field(None, pattern="^(product|material|semi_finished|service)$")
    unit: Optional[str] = Field(None, max_length=20)
    unit_id: Optional[UUID] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None
    ext_id: Optional[str] = None


class NomenclatureOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID
    project_id: Optional[UUID] = None
    name: str
    code: Optional[str] = None
    article: Optional[str] = None
    ntype: str
    unit: str
    unit_id: Optional[UUID] = None
    description: Optional[str] = None
    is_active: bool
    ext_id: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
