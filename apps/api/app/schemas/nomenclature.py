"""Pydantic-схемы для номенклатуры."""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class NomenclatureCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    code: Optional[str] = None
    ntype: str = Field(default="material", pattern="^(product|material|semi_finished|service)$")
    unit: str = Field(default="pcs", max_length=20)
    description: Optional[str] = None
    ext_id: Optional[str] = None


class NomenclatureUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    code: Optional[str] = None
    ntype: Optional[str] = Field(None, pattern="^(product|material|semi_finished|service)$")
    unit: Optional[str] = Field(None, max_length=20)
    description: Optional[str] = None
    is_active: Optional[bool] = None
    ext_id: Optional[str] = None


class NomenclatureOut(BaseModel):
    id: str
    tenant_id: str
    project_id: Optional[str] = None
    name: str
    code: Optional[str] = None
    ntype: str
    unit: str
    description: Optional[str] = None
    is_active: bool
    ext_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
