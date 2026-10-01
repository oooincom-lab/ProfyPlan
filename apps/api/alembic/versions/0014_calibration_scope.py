"""Охват применения калибровки: scope (проект целиком или тип операции).

Выборочное применение по типу операции: запись журнала должна помнить, к чему
применяли — ко всем строкам проекта или к строкам конкретного типа
(«тип: производство»), чтобы журнал оставался однозначным.

Revision ID: 0014_calibration_scope
Revises: 0013_calibration_applications
Create Date: 2026-10-01
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0014_calibration_scope"
down_revision = "0013_calibration_applications"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("calibration_applications", sa.Column("scope", sa.String(80), nullable=True))


def downgrade() -> None:
    op.drop_column("calibration_applications", "scope")
