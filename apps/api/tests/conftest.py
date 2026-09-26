"""Подготовка стенда для тестов — автоматически, из моделей.

Зачем: тесты идут по живому стенду, им нужны схема, арендатор, пользователь-
планировщик planner@demo.ru / demo123 и хотя бы один проект. Раньше проверка
в репозитории такого стенда не готовила, поэтому прогон падал (реестр сверки,
R19).

Схема создаётся из моделей, а не миграциями, сознательно: цепочка миграций
сейчас не собирает базу с нуля — миграция добавляет связь с таблицей
production_orders раньше, чем эта таблица создаётся (реестр сверки, R21).
Для тестов создание из моделей корректно: модели и есть источник истины по
структуре данных.

Данные создаются только при отсутствии: повторный запуск ничего не ломает.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

import app.models  # noqa: F401  — регистрирует все модели в общих метаданных
from app.core.config import settings
from app.core.database import Base
from app.core.security import hash_password
from app.models.project import Project
from app.models.tenant import Tenant, User, UserTenant

DEMO_EMAIL = "planner@demo.ru"
DEMO_PASSWORD = "demo123"
DEMO_TENANT = "Стенд проверки"
DEMO_PROJECT = "Проект проверки"


def _sync_url() -> str:
    """Тот же адрес базы, но синхронным драйвером — для подготовки стенда."""
    return settings.database_url.replace("+asyncpg", "+psycopg2")


@pytest.fixture(scope="session", autouse=True)
def prepared_database() -> None:
    """Создаёт схему и минимальные данные, если их ещё нет."""
    engine = create_engine(_sync_url(), future=True)
    try:
        Base.metadata.create_all(engine, checkfirst=True)

        with Session(engine) as session:
            tenant = session.scalar(select(Tenant).where(Tenant.name == DEMO_TENANT))
            if tenant is None:
                tenant = Tenant(id=uuid.uuid4(), name=DEMO_TENANT)
                session.add(tenant)
                session.flush()

            user = session.scalar(select(User).where(User.email == DEMO_EMAIL))
            if user is None:
                user = User(
                    id=uuid.uuid4(),
                    email=DEMO_EMAIL,
                    hashed_password=hash_password(DEMO_PASSWORD),
                    name="Планировщик стенда",
                    is_active=True,
                )
                session.add(user)
                session.flush()

            link = session.scalar(
                select(UserTenant).where(
                    UserTenant.user_id == user.id,
                    UserTenant.tenant_id == tenant.id,
                )
            )
            if link is None:
                session.add(
                    UserTenant(
                        id=uuid.uuid4(),
                        user_id=user.id,
                        tenant_id=tenant.id,
                        role="planner",
                        joined_at=datetime.now(timezone.utc),
                    )
                )

            project = session.scalar(select(Project).where(Project.tenant_id == tenant.id))
            if project is None:
                session.add(
                    Project(
                        id=uuid.uuid4(),
                        tenant_id=tenant.id,
                        name=DEMO_PROJECT,
                        status="active",
                        created_by=user.id,
                    )
                )

            session.commit()
    finally:
        engine.dispose()
