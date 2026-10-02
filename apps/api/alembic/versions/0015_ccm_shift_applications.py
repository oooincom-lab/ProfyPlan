"""Журнал сдвигов CCM: таблица ccm_shift_applications.

Применение сдвига старта проекта и его откат сохраняются на сервере: видно, когда
и на сколько дней сдвинут проект, каким был старт до и после. После применения и
возврата проект автоматически пересчитывается (Запуск в реестре расчётов).
Хранятся последние 100 записей на организацию; откат помечает запись «возвращено».

Revision ID: 0015_ccm_shift_applications
Revises: 0014_calibration_scope
Create Date: 2026-10-02
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0015_ccm_shift_applications"
down_revision = "0014_calibration_scope"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ccm_shift_applications",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("project_name", sa.String(255), nullable=False),
        sa.Column("kind", sa.String(10), nullable=False, server_default="self"),
        sa.Column("shift_days", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("old_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("new_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reverted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("reverted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_ccm_shift_applications_tenant_id", "ccm_shift_applications", ["tenant_id"])
    op.create_index("ix_ccm_shift_applications_project_id", "ccm_shift_applications", ["project_id"])
    op.create_index("ix_ccm_shift_applications_created_at", "ccm_shift_applications", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_ccm_shift_applications_created_at", table_name="ccm_shift_applications")
    op.drop_index("ix_ccm_shift_applications_project_id", table_name="ccm_shift_applications")
    op.drop_index("ix_ccm_shift_applications_tenant_id", table_name="ccm_shift_applications")
    op.drop_table("ccm_shift_applications")
