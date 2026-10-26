"""Целостность связей операции с ресурсами: роль, КТУ, уникальность.

Revision ID: 0039_operation_resource_integrity
Revises: 0038_pending_links
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0039_op_resource_integrity"
down_revision = "0038_pending_links"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Новое поле КТУ; для старых связей — нейтральное значение.
    op.add_column(
        "operation_resources",
        sa.Column("ktu", sa.Numeric(8, 3), nullable=False, server_default="1.0"),
    )

    # Приводим старые роли к допустимому перечню.
    op.execute(
        """
        UPDATE operation_resources
        SET role = 'helper'
        WHERE role NOT IN ('primary', 'member', 'alternative', 'helper')
        """
    )

    # Удаляем дубли пары operation_id + resource_id, оставляя самую раннюю строку.
    op.execute(
        """
        DELETE FROM operation_resources a
        USING operation_resources b
        WHERE a.operation_id = b.operation_id
          AND a.resource_id = b.resource_id
          AND a.created_at > b.created_at
        """
    )
    op.execute(
        """
        DELETE FROM operation_resources a
        USING operation_resources b
        WHERE a.operation_id = b.operation_id
          AND a.resource_id = b.resource_id
          AND a.created_at = b.created_at
          AND a.id > b.id
        """
    )

    # У операции может быть только один primary; остальные понижаем до member.
    op.execute(
        """
        WITH ranked AS (
            SELECT id,
                   row_number() OVER (
                       PARTITION BY operation_id
                       ORDER BY created_at, id
                   ) AS rn
            FROM operation_resources
            WHERE role = 'primary'
        )
        UPDATE operation_resources r
        SET role = 'member'
        FROM ranked
        WHERE r.id = ranked.id AND ranked.rn > 1
        """
    )

    op.create_check_constraint(
        "ck_operation_resources_role",
        "operation_resources",
        "role IN ('primary', 'member', 'alternative', 'helper')",
    )
    op.create_check_constraint(
        "ck_operation_resources_ktu",
        "operation_resources",
        "ktu >= 0.1 AND ktu <= 3.0",
    )
    op.create_unique_constraint(
        "uq_operation_resources_operation_resource",
        "operation_resources",
        ["operation_id", "resource_id"],
    )
    op.create_index(
        "uq_operation_resources_primary",
        "operation_resources",
        ["operation_id"],
        unique=True,
        postgresql_where=sa.text("role = 'primary'"),
    )


def downgrade() -> None:
    op.drop_index("uq_operation_resources_primary", table_name="operation_resources")
    op.drop_constraint(
        "uq_operation_resources_operation_resource",
        "operation_resources",
        type_="unique",
    )
    op.drop_constraint(
        "ck_operation_resources_ktu",
        "operation_resources",
        type_="check",
    )
    op.drop_constraint(
        "ck_operation_resources_role",
        "operation_resources",
        type_="check",
    )
    op.drop_column("operation_resources", "ktu")
