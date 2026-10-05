"""
Модель заявки на ранний доступ (блок 6.34, фаза 1: онбординг «по заявке»).

Заявка приходит с экрана входа (кнопка «Создать компанию»); по ней вендор
создаёт организацию и приглашает владельца. Заявки не привязаны к тенанту —
они существуют до его появления.
"""
from typing import Optional

from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class EarlyAccessRequest(BaseModel):
    """Заявка на создание организации."""
    __tablename__ = "early_access_requests"

    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    company: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="new")  # new / handled / rejected
