"""Точность нормо-часов: три знака после запятой.

Revision ID: 0036_hours_precision
Revises: 0035_sync_edit_policy
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0036_hours_precision"
down_revision = "0035_sync_edit_policy"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for column, old in [
        ("duration_base", sa.Numeric(10, 2)),
        ("setup_time", sa.Numeric(10, 2)),
        ("teardown_time", sa.Numeric(10, 2)),
        ("to_optimistic", sa.Numeric(10, 2)),
        ("tm_likely", sa.Numeric(10, 2)),
        ("tp_pessimistic", sa.Numeric(10, 2)),
        ("fact_hours", sa.Numeric(10, 2)),
    ]:
        op.alter_column(
            "operations", column,
            type_=sa.Numeric(10, 3), existing_type=old,
            postgresql_using="%s::numeric(10,3)" % column,
        )
    op.alter_column(
        "catalog_operations", "default_duration_hours",
        type_=sa.Numeric(8, 3), existing_type=sa.Numeric(8, 2),
        postgresql_using="default_duration_hours::numeric(8,3)",
    )
    op.alter_column(
        "plan_snapshot_rows", "duration_hours",
        type_=sa.Numeric(14, 3), existing_type=sa.Numeric(14, 4),
        postgresql_using="duration_hours::numeric(14,3)",
    )


def downgrade() -> None:
    op.alter_column(
        "plan_snapshot_rows", "duration_hours",
        type_=sa.Numeric(14, 4), existing_type=sa.Numeric(14, 3),
        postgresql_using="duration_hours::numeric(14,4)",
    )
    op.alter_column(
        "catalog_operations", "default_duration_hours",
        type_=sa.Numeric(8, 2), existing_type=sa.Numeric(8, 3),
        postgresql_using="default_duration_hours::numeric(8,2)",
    )
    for column in ["duration_base", "setup_time", "teardown_time", "to_optimistic", "tm_likely", "tp_pessimistic", "fact_hours"]:
        op.alter_column(
            "operations", column,
            type_=sa.Numeric(10, 2), existing_type=sa.Numeric(10, 3),
            postgresql_using="%s::numeric(10,2)" % column,
        )
