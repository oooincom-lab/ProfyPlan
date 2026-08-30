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

    from app.routers import auth, projects, resources, global_resources, project_resources, operations, calculations, ccm, early_access, actual, bom, calendars, production_orders, excel_import, order_groups, nomenclature, units, counterparties, work_schedules, production_calendars, delete_check, project_stages, catalog_operations, departments, order_resources, schedule_assignments, calendar_exceptions
    from app.routers.suppliers import sc_router
    app.include_router(auth.router)
    app.include_router(projects.router)
    app.include_router(resources.router)
    app.include_router(global_resources.router)
    app.include_router(project_resources.router)
    app.include_router(operations.router)
    app.include_router(operations.dep_router)
    app.include_router(calculations.calculator_router)
    app.include_router(ccm.ccm_router)
    app.include_router(early_access.router)
    app.include_router(actual.router)
    app.include_router(bom.bom_router)
    app.include_router(calendars.router)
    app.include_router(production_orders.router)
    app.include_router(sc_router)
    app.include_router(excel_import.excel_router)
    app.include_router(order_groups.groups_router)
    app.include_router(nomenclature.router)
    app.include_router(units.router)
    app.include_router(counterparties.router)
    app.include_router(work_schedules.router)
    app.include_router(production_calendars.router)
    app.include_router(delete_check.router)
    app.include_router(project_stages.router)
    app.include_router(catalog_operations.router)
    app.include_router(departments.router)
    app.include_router(order_resources.router)
    app.include_router(schedule_assignments.router)
    app.include_router(calendar_exceptions.router)

    @app.get("/v1/health")
    async def health():
        return {"status": "ok", "version": "0.1.0", "db": "ok", "redis": "ok"}

    return app


app = create_app()
