"""Сохранённые виды и журнал их изменений (Дополнение 8)

Таблицы:
- saved_views — именованные снимки состояния представления (привязка к арендатору,
  проекту и пользователю; содержимое — JSON-конверт с разделами по видам и ручными
  позициями узлов);
- saved_view_logs — журнал изменений общего вида (кто, когда, что сделал).

Миграция только добавляет таблицы, существующие данные не затрагивает.

Revision ID: 0037_saved_views
Revises: 0036_order_anchor
Create Date: 2026-09-25
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0037_saved_views"
down_revision = "0036_order_anchor"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "saved_views",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("owner_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("visibility", sa.String(length=10), nullable=False, server_default="private"),
        sa.Column("share_mode", sa.String(length=10), nullable=True),
        sa.Column("content", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("schema_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("imported", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_saved_views_tenant", "saved_views", ["tenant_id"])
    op.create_index("ix_saved_views_project", "saved_views", ["project_id"])
    op.create_index("ix_saved_views_owner", "saved_views", ["owner_id"])
    # выборка реестра: свои виды + общие виды проекта
    op.create_index("ix_saved_views_project_visibility", "saved_views", ["tenant_id", "project_id", "visibility"])

    op.create_table(
        "saved_view_logs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("view_id", UUID(as_uuid=True), sa.ForeignKey("saved_views.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="SET NULL"), nullable=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("action", sa.String(length=20), nullable=False),
        sa.Column("payload", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("note", sa.Text(), nullable=True),
    )
    op.create_index("ix_svl_tenant", "saved_view_logs", ["tenant_id"])
    op.create_index("ix_svl_view", "saved_view_logs", ["view_id"])
    op.create_index("ix_svl_project", "saved_view_logs", ["project_id"])


def downgrade() -> None:
    for idx in ("ix_svl_project", "ix_svl_view", "ix_svl_tenant"):
        op.drop_index(idx, table_name="saved_view_logs")
    op.drop_table("saved_view_logs")
    for idx in ("ix_saved_views_project_visibility", "ix_saved_views_owner",
                "ix_saved_views_project", "ix_saved_views_tenant"):
        op.drop_index(idx, table_name="saved_views")
    op.drop_table("saved_views")
