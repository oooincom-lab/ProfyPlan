"""UID-ссылки в фиксации плана: стабильные идентификаторы для сопоставления (10.10.2026).

Строки снимка получают UID элементов справочников (подразделение, ресурс) и
внешние коды операций — чтобы сопоставление с внешними системами не слетало
при переименованиях. Без FK: снимок должен хранить идентификаторы даже если
элемент справочника позже удалён.

Revision ID: 0025_plan_snapshot_refs
Revises: 0024_operation_department
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0025_plan_snapshot_refs"
down_revision = "0024_operation_department"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("plan_snapshot_rows", sa.Column("operation_ext_id", sa.String(120), nullable=True))
    op.add_column("plan_snapshot_rows", sa.Column("department_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("plan_snapshot_rows", sa.Column("department_code", sa.String(60), nullable=True))
    op.add_column("plan_snapshot_rows", sa.Column("resource_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("plan_snapshot_rows", sa.Column("resource_ext_id", sa.String(120), nullable=True))


def downgrade() -> None:
    op.drop_column("plan_snapshot_rows", "resource_ext_id")
    op.drop_column("plan_snapshot_rows", "resource_id")
    op.drop_column("plan_snapshot_rows", "department_code")
    op.drop_column("plan_snapshot_rows", "department_id")
    op.drop_column("plan_snapshot_rows", "operation_ext_id")
