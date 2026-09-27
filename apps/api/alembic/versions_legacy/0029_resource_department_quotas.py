"""Квоты ресурсов по подразделениям (resource_department_quotas)

Подразделение может использовать ресурс лишь на часть его мощности
(например, общий ресурс делится между цехами). quota_share — доля мощности
ресурса, доступная подразделению (0..1).

Revision ID: 0029_resource_department_quotas
Revises: 0028_resource_events_datetime
Create Date: 2026-09-11
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0029_resource_department_quotas"
down_revision = "0028_resource_events_datetime"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "resource_department_quotas",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "department_id",
            UUID(as_uuid=True),
            sa.ForeignKey("departments.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "resource_id",
            UUID(as_uuid=True),
            sa.ForeignKey("resources.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "quota_share", sa.Numeric(5, 3), nullable=False, server_default="1.0"
        ),
        sa.Column(
            "is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")
        ),
        sa.UniqueConstraint(
            "department_id", "resource_id", name="uq_dept_resource_quota"
        ),
    )
    op.create_index(
        "ix_rdq_tenant", "resource_department_quotas", ["tenant_id"]
    )
    op.create_index(
        "ix_rdq_department", "resource_department_quotas", ["department_id"]
    )
    op.create_index(
        "ix_rdq_resource", "resource_department_quotas", ["resource_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_rdq_resource", table_name="resource_department_quotas")
    op.drop_index("ix_rdq_department", table_name="resource_department_quotas")
    op.drop_index("ix_rdq_tenant", table_name="resource_department_quotas")
    op.drop_table("resource_department_quotas")
