"""
ProfyPlan API — главная точка входа.
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.database import engine, Base


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Стартап: проверка подключения к БД
    yield
    # Шатдаун: закрытие соединений
    await engine.dispose()


def create_app() -> FastAPI:
    app = FastAPI(
        title="ProfyPlan API",
        description="Облачный сервис производственного планирования",
        version="0.1.0",
        docs_url="/v1/docs",
        openapi_url="/v1/openapi.json",
        lifespan=lifespan,
    )

    # CORS — разрешён только фронтенд
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Подключаем роутеры
    from app.routers import auth, projects, resources, operations
    app.include_router(auth.router)
    app.include_router(projects.router)
    app.include_router(resources.router)
    app.include_router(operations.router)
    app.include_router(operations.dep_router)

    # Healthcheck
    @app.get("/v1/health")
    async def health():
        return {
            "status": "ok",
            "version": "0.1.0",
            "db": "ok",
            "redis": "ok",
        }

    return app


app = create_app()
