"""Initial migration — tenants, users, projects, resources, operations, dependencies.

Revision ID: 0001_initial
Revises: None
Create Date: 2026-08-01
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '0001_initial'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'tenants',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('plan', sa.String(20), server_default='trial'),
        sa.Column('trial_ends_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('timezone', sa.String(50), server_default='Europe/Moscow'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        'users',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('email', sa.String(255), nullable=False, unique=True),
        sa.Column('hashed_password', sa.String(255), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('is_active', sa.Boolean(), server_default='true'),
        sa.Column('last_login_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        'user_tenants',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('role', sa.String(20), server_default='member'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('invited_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('joined_at', sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint('user_id', 'tenant_id'),
    )

    op.create_table(
        'projects',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('status', sa.String(20), server_default='draft'),
        sa.Column('mode', sa.String(20), server_default='quick'),
        sa.Column('default_method', sa.String(20), server_default='cpm'),
        sa.Column('country_code', sa.String(2), server_default='RU'),
        sa.Column('ext_id', sa.String(100), nullable=True),
        sa.Column('due_date', sa.DateTime(timezone=True), nullable=True),
        sa.Column('priority', sa.String(20), server_default='normal'),
        sa.Column('customer', sa.String(255), nullable=True),
        sa.Column('created_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        'resources',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=True),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('parent_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('resource_type', sa.String(20), nullable=False, server_default='equipment'),
        sa.Column('capacity_per_unit', sa.Numeric(10, 2), server_default='1.0'),
        sa.Column('capacity_unit', sa.String(10), server_default='hour'),
        sa.Column('unit', sa.String(20), nullable=True),
        sa.Column('is_active', sa.Boolean(), server_default='true'),
        sa.Column('ext_id', sa.String(100), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        'operations',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('duration_base', sa.Numeric(10, 2), nullable=False, server_default='1.0'),
        sa.Column('duration_unit', sa.String(10), server_default='hour'),
        sa.Column('setup_time', sa.Numeric(10, 2), server_default='0'),
        sa.Column('teardown_time', sa.Numeric(10, 2), server_default='0'),
        sa.Column('to_optimistic', sa.Numeric(10, 2), nullable=True),
        sa.Column('tm_likely', sa.Numeric(10, 2), nullable=True),
        sa.Column('tp_pessimistic', sa.Numeric(10, 2), nullable=True),
        sa.Column('position', sa.Integer(), nullable=True),
        sa.Column('catalog_operation_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('is_critical', sa.Boolean(), server_default='false'),
        sa.Column('output_product', sa.String(100), nullable=True),
        sa.Column('output_quantity', sa.Numeric(12, 2), nullable=True),
        sa.Column('yield_rate', sa.Numeric(5, 3), server_default='1.0'),
        sa.Column('input_materials', sa.Text(), nullable=True),
        sa.Column('operation_type', sa.String(20), server_default='production'),
        sa.Column('supplier_id', sa.String(100), nullable=True),
        sa.Column('is_milestone', sa.Boolean(), server_default='false'),
        sa.Column('expected_delivery', sa.DateTime(timezone=True), nullable=True),
        sa.Column('ext_id', sa.String(100), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        'operation_dependencies',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('predecessor_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('operations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('successor_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('operations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('dependency_type', sa.String(10), nullable=False, server_default='FS'),
        sa.Column('lag_time', sa.Numeric(10, 2), server_default='0'),
        sa.Column('lag_unit', sa.String(10), server_default='hour'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        'operation_resources',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('operation_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('operations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('resource_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('resources.id', ondelete='CASCADE'), nullable=False),
        sa.Column('role', sa.String(20), server_default='primary'),
        sa.Column('efficiency_factor', sa.Numeric(5, 3), server_default='1.0'),
        sa.Column('capacity_demand', sa.Numeric(10, 2), server_default='1.0'),
        sa.Column('duration_override', sa.Numeric(10, 2), nullable=True),
        sa.Column('setup_time_override', sa.Numeric(10, 2), nullable=True),
        sa.Column('teardown_time_override', sa.Numeric(10, 2), nullable=True),
        sa.Column('priority', sa.Integer(), server_default='100'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table('operation_resources')
    op.drop_table('operation_dependencies')
    op.drop_table('operations')
    op.drop_table('resources')
    op.drop_table('projects')
    op.drop_table('user_tenants')
    op.drop_table('users')
    op.drop_table('tenants')
