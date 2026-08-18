"""Add nomenclature_ref_id to product_structures (FK → nomenclature)

Revision ID: 0006_nomenclature_ref
Revises: 0005_order_parent_link
Create Date: 2026-08-18
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "0006_nomenclature_ref"
down_revision = "0005_order_parent_link"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "product_structures",
        sa.Column(
            "nomenclature_ref_id",
            UUID(as_uuid=True),
            sa.ForeignKey("nomenclature.id", ondelete="SET NULL"),
            nullable=True,
            comment="Ссылка на справочник номенклатуры (FK)",
        ),
    )
    op.create_index(
        "ix_product_structures_nomenclature_ref_id",
        "product_structures",
        ["nomenclature_ref_id"],
    )


def downgrade():
    op.drop_index(
        "ix_product_structures_nomenclature_ref_id",
        table_name="product_structures",
    )
    op.drop_column("product_structures", "nomenclature_ref_id")
