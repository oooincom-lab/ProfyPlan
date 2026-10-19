"""UID источников у справочников обмена + UID ресурса/подразделения в снимках (19.10.2026).

Revision ID: 0028_ext_uids
Revises: 0027_order_ext_uid
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0028_ext_uids"
down_revision = "0027_order_ext_uid"
branch_labels = None
depends_on = None

GUID_RE = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"


def upgrade() -> None:
    for table in ("nomenclature", "counterparties", "departments", "resources", "projects"):
        op.add_column(table, sa.Column("ext_uid", sa.String(length=100), nullable=True))
        op.create_index("ix_%s_ext_uid" % table, table, ["ext_uid"])
    op.add_column("plan_snapshot_rows", sa.Column("resource_ext_uid", sa.String(length=120), nullable=True))
    op.add_column("plan_snapshot_rows", sa.Column("department_ext_uid", sa.String(length=120), nullable=True))

    # Бэкфилл: где прежний внешний код уже содержит GUID — копируем его в ext_uid (ext_id не трогаем)
    op.execute("UPDATE nomenclature SET ext_uid = ext_id WHERE ext_uid IS NULL AND ext_id ~ '%s'" % GUID_RE)
    op.execute("UPDATE counterparties SET ext_uid = external_code WHERE ext_uid IS NULL AND external_code ~ '%s'" % GUID_RE)
    op.execute("UPDATE resources SET ext_uid = ext_id WHERE ext_uid IS NULL AND ext_id ~ '%s'" % GUID_RE)
    op.execute("UPDATE projects SET ext_uid = ext_id WHERE ext_uid IS NULL AND ext_id ~ '%s'" % GUID_RE)


def downgrade() -> None:
    op.drop_column("plan_snapshot_rows", "department_ext_uid")
    op.drop_column("plan_snapshot_rows", "resource_ext_uid")
    for table in ("nomenclature", "counterparties", "departments", "resources", "projects"):
        op.drop_index("ix_%s_ext_uid" % table, table_name=table)
        op.drop_column(table, "ext_uid")
