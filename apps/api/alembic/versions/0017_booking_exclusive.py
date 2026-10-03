"""Эксклюзивная бронь ресурса проекта (6.33.2).

Флаг у привязки ресурса к проекту (project_resources.exclusive): такая бронь
занимает ресурс целиком — любое пересечение с ней считается конфликтом,
независимо от доли мощности (например, «нужен весь кран», «переналадка участка»).

Revision ID: 0017_booking_exclusive
Revises: 0016_shift_scope
Create Date: 2026-10-04
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0017_booking_exclusive"
down_revision = "0016_shift_scope"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "project_resources",
        sa.Column("exclusive", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )


def downgrade() -> None:
    op.drop_column("project_resources", "exclusive")
