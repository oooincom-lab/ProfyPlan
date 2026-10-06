"""Поле imported у запусков расчёта (остаток блока 6.22: экспорт/импорт реестра).

Запуски, полученные импортом файла, помечаются — видно происхождение записи.

Revision ID: 0020_run_imported
Revises: 0019_team
Create Date: 2026-10-06
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0020_run_imported"
down_revision = "0019_team"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "calculation_runs",
        sa.Column("imported", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )


def downgrade() -> None:
    op.drop_column("calculation_runs", "imported")
