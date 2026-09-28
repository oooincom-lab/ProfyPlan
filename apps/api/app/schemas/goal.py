"""Схемы целей по областям (блок 6.30)."""
from datetime import date
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

AREA_TYPES = "^(project|cluster|group|order)$"


class GoalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    area_type: str
    area_ref: Optional[UUID] = None
    contract_date: Optional[date] = None
    working_date: Optional[date] = None
    contract_source: str
    working_source: str
    fixed: bool


class GoalSet(BaseModel):
    """Поставить или изменить цель области. Передаются только изменяемые поля."""

    area_type: str = Field(default="project", pattern=AREA_TYPES)
    area_ref: Optional[UUID] = None
    contract_date: Optional[date] = None
    working_date: Optional[date] = None
    contract_source: Optional[str] = Field(default=None, pattern="^(calculated|manual)$")
    working_source: Optional[str] = Field(default=None, pattern="^(calculated|manual)$")
    fixed: Optional[bool] = None


class GoalList(BaseModel):
    items: list[GoalOut]
