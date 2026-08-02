"""
Конфигурация Alembic для миграций БД.
"""
from logging.config import fileConfig
from pathlib import Path
from alembic import context
from sqlalchemy import engine_from_config, pool

from app.core.config import settings
from app.core.database import Base

# Импорт всех моделей для autogenerate
from app.models.base import BaseModel  # noqa: F401
from app.models.tenant import Tenant, User, UserTenant  # noqa: F401
from app.models.project import Project  # noqa: F401
from app.models.resource import Resource  # noqa: F401
from app.models.operation import Operation, OperationDependency, OperationResource  # noqa: F401
from app.models.product_structure import ProductStructure  # noqa: F401
from app.models.routing import Routing, RoutingOperation  # noqa: F401
from app.models.plan_version import PlanBaseline, ActualExecution, InterProjectDependency  # noqa: F401

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Для офлайн-миграций (без подключения к БД)."""
    url = settings.database_url.replace("+asyncpg", "+psycopg2")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Для онлайн-миграций."""
    configuration = config.get_section(config.config_ini_section, {})
    configuration["sqlalchemy.url"] = settings.database_url.replace("+asyncpg", "+psycopg2")
    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
