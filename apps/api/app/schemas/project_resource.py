"""
Pydantic-схемы для регистра ресурсов проекта (ProjectResource).
"""
from typing import Optional

from pydantic import BaseModel, Field


class ProjectResourceCreate(BaseModel):
    resource_id: str
    schedule_id: Optional[str] = None


class ProjectResourceUpdate(BaseModel):
    schedule_id: Optional[str] = None


class ProjectResourceOut(BaseModel):
    id: str
    project_id: str
    resource_id: str
    schedule_id: Optional[str] = None
    resource_name: Optional[str] = None
    schedule_name: Optional[str] = None

    class Config:
        from_attributes = True
