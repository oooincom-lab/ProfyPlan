"""Расширение справочника операций: код, артикул, вилка нормы, тип, теги,
активность и снимок последнего изменения; слияние дубля названий.

Revision ID: 0032_catalog_operations_ext
Revises: 0031_pins_flows_log
"""
from alembic import op
import sqlalchemy as sa

revision = "0032_catalog_operations_ext"
down_revision = "0031_pins_flows_log"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("catalog_operations", sa.Column("code", sa.String(64), nullable=True))
    op.add_column("catalog_operations", sa.Column("article", sa.String(128), nullable=True))
    op.add_column("catalog_operations", sa.Column("article_source", sa.String(128), nullable=True))
    op.add_column("catalog_operations", sa.Column("op_type", sa.String(20), nullable=False, server_default="work"))
    op.add_column("catalog_operations", sa.Column("unit", sa.String(10), nullable=False, server_default="hour"))
    op.add_column("catalog_operations", sa.Column("norm_typical", sa.Numeric(8, 2), nullable=True))
    op.add_column("catalog_operations", sa.Column("norm_min", sa.Numeric(8, 2), nullable=True))
    op.add_column("catalog_operations", sa.Column("norm_max", sa.Numeric(8, 2), nullable=True))
    op.add_column("catalog_operations", sa.Column("setup_time", sa.Numeric(8, 2), nullable=False, server_default="0"))
    op.add_column("catalog_operations", sa.Column("teardown_time", sa.Numeric(8, 2), nullable=False, server_default="0"))
    op.add_column("catalog_operations", sa.Column("default_resource_id", sa.Uuid(), nullable=True))
    op.add_column("catalog_operations", sa.Column("tags", sa.String(255), nullable=True))
    op.add_column("catalog_operations", sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column("catalog_operations", sa.Column("updated_by", sa.String(255), nullable=True))
    op.add_column("catalog_operations", sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("catalog_operations", sa.Column("last_change", sa.JSON(), nullable=True))

    # типовая норма = прежняя «длительность по умолчанию»
    op.execute("update catalog_operations set norm_typical = default_duration_hours where norm_typical is null")

    # слияние дубля: множественное число → единственное (связей у справочника нет)
    op.execute("""
        update operations set catalog_operation_id = (
            select id from catalog_operations where name = 'Надвижка пролётного строения' limit 1
        )
        where catalog_operation_id in (
            select id from catalog_operations where name = 'Надвижка пролётных строений'
        )
    """)
    op.execute("delete from catalog_operations where name = 'Надвижка пролётных строений'")

    op.create_index("ix_catalog_operations_name_lower", "catalog_operations",
                    [sa.text("lower(name)"), "tenant_id"], unique=True)
    op.create_index("ix_catalog_operations_code_lower", "catalog_operations",
                    [sa.text("lower(code)"), "tenant_id"], unique=True,
                    postgresql_where=sa.text("code is not null"))


def downgrade() -> None:
    op.drop_index("ix_catalog_operations_code_lower", table_name="catalog_operations")
    op.drop_index("ix_catalog_operations_name_lower", table_name="catalog_operations")
    for col in ("last_change", "updated_at", "updated_by", "is_active", "tags", "default_resource_id",
                "teardown_time", "setup_time", "norm_max", "norm_min", "norm_typical", "unit",
                "op_type", "article_source", "article", "code"):
        op.drop_column("catalog_operations", col)
