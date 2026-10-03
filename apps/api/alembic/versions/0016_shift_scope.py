"""Сдвиг контура: охват и перенесённые заказы в журнале сдвигов CCM.

Запись журнала теперь хранит: охват (весь проект или выбранные кусты), сколько
заказов перенесено и пропущено (закреплённые / без дат), а также список перенесённых
заказов со старыми датами — для точного возврата.

Revision ID: 0016_shift_scope
Revises: 0015_ccm_shift_applications
Create Date: 2026-10-03
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0016_shift_scope"
down_revision = "0015_ccm_shift_applications"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ccm_shift_applications",
        sa.Column("scope", sa.String(10), nullable=False, server_default="project"),
    )
    op.add_column(
        "ccm_shift_applications",
        sa.Column("orders_shifted", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "ccm_shift_applications",
        sa.Column("orders_skipped", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column("ccm_shift_applications", sa.Column("orders_moved", sa.JSON(), nullable=True))
    op.add_column("ccm_shift_applications", sa.Column("skipped_details", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("ccm_shift_applications", "skipped_details")
    op.drop_column("ccm_shift_applications", "orders_moved")
    op.drop_column("ccm_shift_applications", "orders_skipped")
    op.drop_column("ccm_shift_applications", "orders_shifted")
    op.drop_column("ccm_shift_applications", "scope")
