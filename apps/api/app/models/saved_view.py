"""
Сохранённые виды — именованные снимки состояния представления.

Сохранённый вид хранит «конверт настроек» рабочего поля (разделы по видам:
сетевой график, Гант, пулы, общее; версия схемы; ручные позиции узлов
«идентификатор операции → координаты + подпись раскладки») и метаданные:
имя, автор, дата создания, дата изменения.

Формат конверта — тот же, что и у будущего профиля проекта: вид является
поименованным снимком, профиль проекта — набором значений по умолчанию.

Хранение — только на сервере (привязка к арендатору, проекту и пользователю);
в браузере остаётся лишь кэш последнего применённого вида.

Общий вид проекта: пользователь может сделать общим ровно один свой вид.
Статус общего вида: «чтение» (применяют все, сохраняет владелец) и
«изменение» (применяют и сохраняют все участники проекта, ведётся журнал).
"""
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel

# Видимость вида: личный (виден только владельцу) или общий (виден всем участникам проекта).
VISIBILITY_PRIVATE = "private"
VISIBILITY_SHARED = "shared"
VISIBILITIES = (VISIBILITY_PRIVATE, VISIBILITY_SHARED)

# Статус общего вида: «чтение» — другие только применяют; «изменение» — и сохраняют.
SHARE_READ = "read"
SHARE_WRITE = "write"
SHARE_MODES = (SHARE_READ, SHARE_WRITE)

# Версия схемы конверта настроек.
DEFAULT_SCHEMA_VERSION = 1

# Разделы конверта по видам рабочего поля.
ENVELOPE_SECTIONS = ("cpm", "gantt", "pools", "general")


class SavedView(BaseModel):
    """Именованное сохранение состояния представления."""
    __tablename__ = "saved_views"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    # private | shared
    visibility: Mapped[str] = mapped_column(
        String(10), nullable=False, default=VISIBILITY_PRIVATE, server_default=VISIBILITY_PRIVATE
    )
    # read | write — только для общих видов (у личных NULL)
    share_mode: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    # конверт настроек: разделы по видам, версия схемы, ручные позиции узлов
    content: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    schema_version: Mapped[int] = mapped_column(
        Integer, nullable=False, default=DEFAULT_SCHEMA_VERSION, server_default="1"
    )
    # признак «сохранён при импорте» — для реестра и разбора
    imported: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True, onupdate=func.now()
    )


class SavedViewLog(BaseModel):
    """Журнал изменений общего вида: кто, когда и что сделал."""
    __tablename__ = "saved_view_logs"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    view_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("saved_views.id", ondelete="CASCADE"), nullable=False, index=True
    )
    project_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("projects.id", ondelete="SET NULL"), nullable=True, index=True
    )
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # create | save | rename | share | unshare | copy | delete | import | export
    action: Mapped[str] = mapped_column(String(20), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
