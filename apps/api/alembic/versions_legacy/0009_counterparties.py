"""Create counterparties table (справочник контрагентов)

Revision ID: 0009_counterparties
Revises: 0008_routing_op_stage_name
Create Date: 2026-08-20
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "0009_counterparties"
down_revision = "0008_routing_op_stage_name"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "counterparties",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("inn", sa.String(12), nullable=True),
        sa.Column("kpp", sa.String(9), nullable=True),
        sa.Column("ogrn", sa.String(15), nullable=True),
        sa.Column("note", sa.String(1000), nullable=True),
        sa.Column("external_code", sa.String(100), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=True),
    )
    op.create_index("ix_counterparties_tenant_id", "counterparties", ["tenant_id"])
    op.create_index("ix_counterparties_inn", "counterparties", ["inn"])
    op.create_index("ix_counterparties_external_code", "counterparties", ["external_code"])


def downgrade():
    op.drop_index("ix_counterparties_external_code", table_name="counterparties")
    op.drop_index("ix_counterparties_inn", table_name="counterparties")
    op.drop_index("ix_counterparties_tenant_id", table_name="counterparties")
    op.drop_table("counterparties")
