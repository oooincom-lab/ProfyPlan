"""Архив во всех справочниках: колонка is_active для departments и project_stages.

Остальные справочники (номенклатура, единицы, контрагенты, организации, ресурсы,
графики работы, операции) уже имеют is_active с предыдущих ревизий.

Revision ID: 0034_archive_directories
Revises: 0033_operations_order_id
"""
from alembic import op
import sqlalchemy as sa

revision = "0034_archive_directories"
down_revision = "0033_operations_order_id"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table in ("departments", "project_stages"):
        op.add_column(table, sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()))
        op.create_index("ix_%s_is_active" % table, table, ["is_active"])


def downgrade() -> None:
    for table in ("departments", "project_stages"):
        op.drop_index("ix_%s_is_active" % table, table_name=table)
        op.drop_column(table, "is_active")
