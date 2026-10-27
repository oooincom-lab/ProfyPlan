import asyncio
from uuid import uuid4

from sqlalchemy import func, select

from app.core.database import async_session
from app.models.project import Project
from app.models.operation import Operation, OperationResource
from app.models.resource import Resource
from app.models.plan_snapshot import PlanSnapshot, PlanSnapshotRow
from app.services.plan_snapshots import build_snapshot
from app.services.resource_leveling import resource_leveling_sgs, format_leveling_result


async def main():
    async with async_session() as db:
        project_row = (await db.execute(
            select(Project, func.count(Operation.id).label("ops"))
            .join(Operation, Operation.project_id == Project.id)
            .group_by(Project.id)
            .having(func.count(Operation.id) >= 2)
            .order_by(Project.created_at)
            .limit(1)
        )).first()
        project = project_row[0] if project_row else None
        if not project:
            print("no project"); return
        tenant_id = project.tenant_id
        ops = (await db.execute(
            select(Operation).where(Operation.project_id == project.id, Operation.tenant_id == tenant_id)
        )).scalars().all()
        if len(ops) < 2:
            print("not enough ops"); return
        op_ids = [o.id for o in ops]
        assignments = (await db.execute(
            select(OperationResource).where(OperationResource.operation_id.in_(op_ids))
        )).scalars().all()
        primary = next((a for a in assignments if a.role == "primary"), None)
        if not primary:
            print("no primary"); return
        resources = (await db.execute(
            select(Resource).where(Resource.tenant_id == tenant_id, Resource.is_active.is_(True))
        )).scalars().all()
        second = next((r for r in resources if r.id != primary.resource_id), None)
        if not second:
            print("no second resource"); return
        member = next((a for a in assignments if a.operation_id == primary.operation_id and a.resource_id == second.id), None)
        created_member = False
        if member is None:
            member = OperationResource(
                id=uuid4(), operation_id=primary.operation_id, resource_id=second.id,
                role="member", capacity_demand=1, ktu=0.8,
            )
            db.add(member)
            created_member = True
        else:
            member.role = "member"
            member.ktu = 0.8
        await db.commit()

        snap = None
        try:
            snap, missing = await build_snapshot(db, project, tenant_id, None, name="CCM pilot check")
            rows = (await db.execute(
                select(PlanSnapshotRow).where(PlanSnapshotRow.snapshot_id == snap.id)
            )).scalars().all()
            print("snapshot_rows", len(rows), "roles", [(r.resource_role, r.resource_name, float(r.ktu or 0)) for r in rows])
            print("missing_departments", missing)
        except Exception as e:
            print("snapshot_error", type(e).__name__, str(e)[:300])
        finally:
            if snap is not None:
                await db.delete(snap)
            if created_member:
                await db.delete(member)
            else:
                member.role = "member"
            await db.commit()

        try:
            result = await resource_leveling_sgs(db, project.id, tenant_id)
            print("leveling", format_leveling_result(result))
        except Exception as e:
            print("leveling_error", type(e).__name__, str(e)[:300])


asyncio.run(main())
