"""Pydantic-схемы для регистра «Этапы проекта»."""
from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ProjectStageCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    code: Optional[str] = Field(None, max_length=50)
    position: Optional[int] = None  # если не задан — в конец списка


class ProjectStageUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    code: Optional[str] = Field(None, max_length=50)
    position: Optional[int] = None


class ProjectStageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID
    project_id: UUID
    name: str
    code: Optional[str] = None
    position: int
    created_at: datetime
