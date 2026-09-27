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
    # Расчёты (блок 6.16.7): две независимые оси. Если заданы — они источник истины,
    # default_method пересчитывается под них; если нет — оси выводятся из default_method.
    planning_logic: Optional[str] = Field(default=None, pattern="^(cpm|ccm)$")
    uncertainty_analysis: Optional[str] = Field(default=None, pattern="^(none|pert|mc)$")
    monte_carlo_runs: Optional[int] = Field(default=None, ge=100, le=1000000)
    confidence_level: Optional[float] = Field(default=None, ge=0.5, le=0.999)
    use_history: Optional[bool] = None
    date_policy: Optional[str] = Field(default=None, pattern="^(calculated|probability)$")
    date_probability: Optional[float] = Field(default=None, ge=0.5, le=0.999)
    country_code: str = Field(default="RU", min_length=2, max_length=2)
    start_date: Optional[datetime] = None
    priority: str = Field(default="normal", pattern="^(low|normal|high)$")


class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    description: Optional[str] = None
    status: Optional[str] = Field(default=None, pattern="^(draft|active|completed|archived)$")
    mode: Optional[str] = Field(default=None, pattern="^(quick|project|recurring)$")
    default_method: Optional[str] = Field(default=None, pattern="^(cpm|pert_cpm|cpm_ccm|pert_ccm)$")
    planning_logic: Optional[str] = Field(default=None, pattern="^(cpm|ccm)$")
    uncertainty_analysis: Optional[str] = Field(default=None, pattern="^(none|pert|mc)$")
    monte_carlo_runs: Optional[int] = Field(default=None, ge=100, le=1000000)
    confidence_level: Optional[float] = Field(default=None, ge=0.5, le=0.999)
    use_history: Optional[bool] = None
    date_policy: Optional[str] = Field(default=None, pattern="^(calculated|probability)$")
    date_probability: Optional[float] = Field(default=None, ge=0.5, le=0.999)
    country_code: Optional[str] = Field(None, min_length=2, max_length=2)
    start_date: Optional[datetime] = None
    priority: Optional[str] = Field(default=None, pattern="^(low|normal|high)$")
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
    planning_logic: Optional[str] = None
    uncertainty_analysis: Optional[str] = None
    monte_carlo_runs: Optional[int] = None
    confidence_level: Optional[float] = None
    use_history: Optional[bool] = None
    date_policy: Optional[str] = None
    date_probability: Optional[float] = None
    country_code: str
    schedule_id: Optional[UUID] = None
    use_shared_resources: Optional[bool] = None
    start_date: Optional[datetime] = None
    priority: Optional[str] = None
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
