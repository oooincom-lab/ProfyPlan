import asyncio
import json
from pathlib import Path
from uuid import uuid4

from sqlalchemy import func, select

from app.core.database import async_session
from app.models.project import Project
from app.models.operation import Operation, OperationResource
from app.models.resource import Resource
from app.models.integration import IntegrationConnection
from app.services.plan_snapshots import build_snapshot
from app.services.integration_exchange import export_plan_snapshot


async def main():
    async with async_session() as db:
        row = (await db.execute(
            select(Project, func.count(Operation.id).label("ops"))
            .join(Operation, Operation.project_id == Project.id)
            .group_by(Project.id)
            .having(func.count(Operation.id) >= 2)
            .order_by(Project.created_at)
            .limit(1)
        )).first()
        if not row:
            print("no project"); return
        project = row[0]
        tenant_id = project.tenant_id
        ops = (await db.execute(
            select(Operation).where(Operation.project_id == project.id, Operation.tenant_id == tenant_id)
        )).scalars().all()
        assignments = (await db.execute(
            select(OperationResource).where(OperationResource.operation_id.in_([o.id for o in ops]))
        )).scalars().all()
        primary = next((a for a in assignments if a.role == "primary"), None)
        if not primary:
            print("no primary"); return
        resources = (await db.execute(
            select(Resource).where(Resource.tenant_id == tenant_id, Resource.is_active.is_(True))
        )).scalars().all()
        second = next((r for r in resources if r.id != primary.resource_id), None)
        member = None
        if second:
            member = next((a for a in assignments if a.operation_id == primary.operation_id and a.resource_id == second.id), None)
            if member is None:
                member = OperationResource(
                    id=uuid4(), operation_id=primary.operation_id, resource_id=second.id,
                    role="member", capacity_demand=1, ktu=0.8,
                )
                db.add(member)
            else:
                member.role = "member"
                member.ktu = 0.8
            await db.commit()
        conn = (await db.execute(
            select(IntegrationConnection).where(IntegrationConnection.tenant_id == tenant_id).limit(1)
        )).scalars().first()
        if not conn:
            print("no connection"); return
        snap = None
        try:
            snap, _ = await build_snapshot(db, project, tenant_id, None, name="PILOT plan export")
            result = await export_plan_snapshot(db, conn, snap.id, tenant_id)
            print("export", result)
            raw_path = result.get("file") or ""
            out_dir = result.get("out_dir") or ""
            path = Path(raw_path)
            if not path.is_absolute():
                path = Path(out_dir) / raw_path
            if path.exists():
                payload = json.loads(path.read_text(encoding="utf-8"))
                ents = payload.get("entities", [])
                print("entities", len(ents))
                print("roles", [(e.get("fields", {}).get("resource_role"), e.get("fields", {}).get("resource_name")) for e in ents[:10]])
                from collections import Counter
                print("role_counts", Counter(e.get("fields", {}).get("resource_role") for e in ents))
        except Exception as e:
            print("export_error", type(e).__name__, str(e)[:500])
        finally:
            if snap is not None:
                await db.delete(snap)
            if member is not None:
                await db.delete(member)
            await db.commit()


asyncio.run(main())
