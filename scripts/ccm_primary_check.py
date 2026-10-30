import asyncio
from sqlalchemy import select
from app.core.database import async_session
from app.models.project import Project
from app.services.resource_leveling import resource_leveling_sgs, ResourcePrimaryMissing


async def main():
    async with async_session() as db:
        projects = (await db.execute(select(Project).order_by(Project.created_at))).scalars().all()
        for name in ("Стройка", "Полигон B — Развязки (тест)"):
            p = next((x for x in projects if x.name == name), None)
            if not p:
                print(name, "not found"); continue
            try:
                r = await resource_leveling_sgs(db, p.id, p.tenant_id)
                print(name, "OK", len(r.scheduled), "ops")
            except ResourcePrimaryMissing as e:
                print(name, "BLOCKED", len(e.operations), [x["name"] for x in e.operations[:3]])
            except Exception as e:
                print(name, "ERROR", type(e).__name__, str(e)[:200])


asyncio.run(main())
