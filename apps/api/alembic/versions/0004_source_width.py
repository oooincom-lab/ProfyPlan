"""Расширение поля источника оценок: добавляется значение «coefficient» (блок плана 6.17/6.18).

Источник оценок получил четвёртое значение — коэффициент: оценки выведены из одной длительности
по профилю разброса (±15 / ±25 / ±40 %). Это допущение, а не измерение, и оно должно быть видно
как допущение. Прежнее поле вмещало 10 символов, а «coefficient» — 11.

Revision ID: 0004_source_width
Revises: 0003_estimate_source
Create Date: 2026-09-27
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0004_source_width"
down_revision = "0003_estimate_source"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "operations",
        "estimate_source",
        existing_type=sa.String(10),
        type_=sa.String(20),
        existing_nullable=False,
        existing_server_default="expert",
    )


def downgrade() -> None:
    op.alter_column(
        "operations",
        "estimate_source",
        existing_type=sa.String(20),
        type_=sa.String(10),
        existing_nullable=False,
        existing_server_default="expert",
    )
