"""События мощности ресурса: период с временем (date → timestamp)

Revision ID: 0028_resource_events_datetime
Revises: 0027_resource_events
Create Date: 2026-09-10

date_from/date_to переводятся из DATE в TIMESTAMP, чтобы период события
задавался с точностью до часов и минут.
Существующие записи трактуются как «весь день»:
date_from -> 00:00, date_to -> 23:59.
"""
from alembic import op
import sqlalchemy as sa

revision = "0028_resource_events_datetime"
down_revision = "0027_resource_events"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "resource_events",
        "date_from",
        existing_type=sa.Date(),
        type_=sa.DateTime(),
        existing_nullable=False,
        postgresql_using="date_from::timestamp",
    )
    op.alter_column(
        "resource_events",
        "date_to",
        existing_type=sa.Date(),
        type_=sa.DateTime(),
        existing_nullable=False,
        postgresql_using="date_to::timestamp + interval '23 hours 59 minutes'",
    )


def downgrade() -> None:
    op.alter_column(
        "resource_events",
        "date_to",
        existing_type=sa.DateTime(),
        type_=sa.Date(),
        existing_nullable=False,
        postgresql_using="date_to::date",
    )
    op.alter_column(
        "resource_events",
        "date_from",
        existing_type=sa.DateTime(),
        type_=sa.Date(),
        existing_nullable=False,
        postgresql_using="date_from::date",
    )
