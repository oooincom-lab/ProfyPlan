"""
Pydantic-схемы для проектов.
"""
from datetime import datetime
from typing import Optional

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: Optional[str] = None
    mode: str = Field(default="quick", pattern="^(quick|project|recurring)$")
    default_method: str = Field(default="cpm", pattern="^(cpm|pert_cpm|cpm_ccm|pert_ccm)$")
    country_code: str = Field(default="RU", min_length=2, max_length=2)
    start_date: Optional[datetime] = None


class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    description: Optional[str] = None
    status: Optional[str] = Field(default=None, pattern="^(draft|active|completed|archived)$")
    mode: Optional[str] = Field(default=None, pattern="^(quick|project|recurring)$")
    default_method: Optional[str] = Field(default=None, pattern="^(cpm|pert_cpm|cpm_ccm|pert_ccm)$")
    country_code: Optional[str] = Field(None, min_length=2, max_length=2)
    start_date: Optional[datetime] = None
    schedule_id: Optional[UUID] = None
    use_shared_resources: Optional[bool] = None


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID
    name: str
    description: Optional[str] = None
    status: str
    mode: str
    default_method: str
    country_code: str
    schedule_id: Optional[UUID] = None
    use_shared_resources: Optional[bool] = None
    start_date: Optional[datetime] = None
    due_date: Optional[datetime] = None
    created_by: Optional[UUID] = None
    created_at: datetime
    updated_at: Optional[datetime] = None


class ProjectList(BaseModel):
    """Список проектов с пагинацией."""
    items: list[ProjectOut]
    total: int
    page: int = 1
    page_size: int = 50
