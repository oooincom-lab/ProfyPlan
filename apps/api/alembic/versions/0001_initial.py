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
        sa.Column('is_active', sa.Boolean(), server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        'user_tenants',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('role', sa.String(20), server_default='member'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('user_id', 'tenant_id'),
    )

    op.create_table(
        'projects',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('code', sa.String(50), nullable=False),
        sa.Column('name', sa.String(500), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('specification_code', sa.String(100), nullable=True),
        sa.Column('quantity', sa.Integer(), server_default='1'),
        sa.Column('start_date', sa.Date(), nullable=False),
        sa.Column('end_date', sa.Date(), nullable=True),
        sa.Column('buffer_end_date', sa.Date(), nullable=True),
        sa.Column('priority', sa.String(20), server_default='normal'),
        sa.Column('status', sa.String(20), server_default='draft'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('tenant_id', 'code'),
    )

    op.create_table(
        'resources',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('code', sa.String(50), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('type', sa.String(20), server_default='equipment'),
        sa.Column('capacity_per_day', sa.Float(), server_default='8.0'),
        sa.Column('unit', sa.String(20), server_default='hours'),
        sa.Column('cost_per_hour', sa.Float(), nullable=True),
        sa.Column('calendar_id', sa.String(100), nullable=True),
        sa.Column('ext_id', sa.String(100), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        'operations',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False),
        sa.Column('code', sa.String(50), nullable=False),
        sa.Column('name', sa.String(500), nullable=False),
        sa.Column('duration', sa.Float(), nullable=False),
        sa.Column('work_center_code', sa.String(50), nullable=True),
        sa.Column('quantity', sa.Float(), server_default='1.0'),
        sa.Column('setup_time', sa.Float(), server_default='0'),
        sa.Column('run_time_per_unit', sa.Float(), server_default='0'),
        sa.Column('move_time', sa.Float(), server_default='0'),
        sa.Column('queue_time', sa.Float(), server_default='0'),
        sa.Column('es', sa.Float(), nullable=True),
        sa.Column('ef', sa.Float(), nullable=True),
        sa.Column('ls', sa.Float(), nullable=True),
        sa.Column('lf', sa.Float(), nullable=True),
        sa.Column('total_float', sa.Float(), nullable=True),
        sa.Column('free_float', sa.Float(), nullable=True),
        sa.Column('is_critical', sa.Boolean(), server_default='false'),
        sa.Column('progress', sa.Float(), server_default='0'),
        sa.Column('status', sa.String(20), server_default='pending'),
        sa.Column('actual_start', sa.DateTime(timezone=True), nullable=True),
        sa.Column('actual_end', sa.DateTime(timezone=True), nullable=True),
        sa.Column('bom_node_code', sa.String(100), nullable=True),
        sa.Column('routing_operation_code', sa.String(100), nullable=True),
        sa.Column('parent_operation_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('operations.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        'operation_dependencies',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('predecessor_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('operations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('successor_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('operations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('type', sa.String(10), server_default='FS'),
        sa.Column('lag', sa.Float(), server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('predecessor_id', 'successor_id'),
    )

    op.create_table(
        'operation_resources',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('operation_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('operations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('resource_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('resources.id', ondelete='CASCADE'), nullable=False),
        sa.Column('quantity', sa.Float(), server_default='1.0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('operation_id', 'resource_id'),
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
