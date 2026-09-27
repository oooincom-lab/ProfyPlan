"""Связь операций с заказами (для статусов: черновик исключается из расчёта).

Revision ID: 0033_operations_order_id
Revises: 0032_catalog_operations_ext
"""
from alembic import op
import sqlalchemy as sa

revision = "0033_operations_order_id"
down_revision = "0032_catalog_operations_ext"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("operations", sa.Column("order_id", sa.Uuid(), nullable=True))
    op.create_index("ix_operations_order_id", "operations", ["order_id"])
    op.create_foreign_key("fk_operations_order", "operations", "production_orders", ["order_id"], ["id"], ondelete="CASCADE")

    # привязываем существующие операции к заказам по названию из состава заказа
    op.execute("""
        update operations o
        set order_id = ps.order_id
        from product_structures ps
        where ps.order_id is not null
          and ps.project_id = o.project_id
          and o.order_id is null
          and lower(o.name) in (
              select lower(ps2.nomenclature_name) from product_structures ps2 where ps2.order_id = ps.order_id
          )
    """)
    op.create_index("ix_operations_order_id_missing", "operations", ["project_id", "order_id"],
                    postgresql_where=sa.text("order_id is null"))


def downgrade() -> None:
    op.drop_index("ix_operations_order_id_missing", table_name="operations")
    op.drop_index("ix_operations_order_id", table_name="operations")
    op.drop_column("operations", "order_id")
