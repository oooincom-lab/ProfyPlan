"""Флаг «ведём руками»: запрет автоматической пересборки развёртки для заказа (07.10.2026).

Если у заказа plan_manual=true, авто-проверка при сохранении заказа (окно «✓ Сохранить»)
не применяет изменения плана автоматически — только показывает окно сверки.
Ручное действие «Пересобрать развёртку» продолжает работать.

Revision ID: 0022_order_plan_manual
Revises: 0021_operation_source
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0022_order_plan_manual"
down_revision = "0021_operation_source"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "production_orders",
        sa.Column("plan_manual", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )


def downgrade() -> None:
    op.drop_column("production_orders", "plan_manual")
