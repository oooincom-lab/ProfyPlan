"""Политика даты плана (блок плана 6.29, Дополнение 15).

Дата плана — решение руководителя, а не метод расчёта. Хранится отдельно от метода:
  date_policy       — calculated (по расчёту) или probability (по вероятности);
  date_probability  — какой процентиль берём за план, когда выбран режим вероятности.

Значения по умолчанию: политика — по расчёту, вероятность — 0,80. Это чтобы «цифра по умолчанию»
была обычным расчётом, а не скрытым обещанием вероятности.

Revision ID: 0005_date_policy
Revises: 0004_source_width
Create Date: 2026-09-28
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0005_date_policy"
down_revision = "0004_source_width"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("date_policy", sa.String(20), nullable=False, server_default="calculated"))
    op.add_column("projects", sa.Column("date_probability", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("projects", "date_probability")
    op.drop_column("projects", "date_policy")
