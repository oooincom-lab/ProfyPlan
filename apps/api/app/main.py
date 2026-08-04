"""ProfyPlan API — главная точка входа."""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.database import engine, Base


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
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

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    from app.routers import auth, projects, resources, operations, calculations, ccm, early_access, actual
    app.include_router(auth.router)
    app.include_router(projects.router)
    app.include_router(resources.router)
    app.include_router(operations.router)
    app.include_router(operations.dep_router)
    app.include_router(calculations.calculator_router)
    app.include_router(ccm.ccm_router)
    app.include_router(early_access.router)
    app.include_router(actual.router)

    @app.get("/v1/health")
    async def health():
        return {"status": "ok", "version": "0.1.0", "db": "ok", "redis": "ok"}

    return app


app = create_app()
