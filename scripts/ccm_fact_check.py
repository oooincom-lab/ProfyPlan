import asyncio
from datetime import date
from uuid import uuid4

from sqlalchemy import select

from app.core.database import async_session
from app.models.project import Project
from app.models.operation import Operation
from app.models.work_order import WorkOrder, WorkOrderLine
from app.models.execution_fact import ExecutionFact
from app.services.integration_apply import _apply_work_order, _apply_fact


async def main():
    async with async_session() as db:
        project = (await db.execute(select(Project).order_by(Project.created_at).limit(1))).scalars().first()
        if not project:
            print("no project"); return
        tenant_id = project.tenant_id
        wo_uid = "PILOT-WO-" + uuid4().hex[:8]
        line_uid = "PILOT-LINE-1"
        payload = {
            "order_type": "work_order",
            "number": "PILOT-" + wo_uid[-6:],
            "date": "2026-10-28",
            "project_name": project.name,
            "lines": [{
                "line_uid": line_uid,
                "nomenclature_kind": "work",
                "nomenclature_name": "Пилотная работа",
                "work_type_name": "Пилотная работа",
                "quantity": 1,
                "unit": "hour",
                "duration_hours": 2.5,
                "sequence": 10,
                "executor_uid": "PILOT-EMP",
                "executor_type": "employee",
                "ktu": 1.2,
            }],
        }
        msg = await _apply_work_order(db, tenant_id, wo_uid, payload)
        print("wo_apply", msg)
        wo = (await db.execute(select(WorkOrder).where(WorkOrder.tenant_id == tenant_id, WorkOrder.ext_uid == wo_uid))).scalars().first()
        if not wo:
            print("work order not created"); return
        line = (await db.execute(select(WorkOrderLine).where(WorkOrderLine.work_order_id == wo.id, WorkOrderLine.line_uid == line_uid))).scalars().first()
        print("line", line.line_uid if line else None, "operation", str(line.operation_id) if line and line.operation_id else None)
        fact_uid = "PILOT-FACT-" + uuid4().hex[:8]
        fact_payload = {
            "fact_type": "work_order_execution",
            "work_order_uid": wo_uid,
            "work_order_line_uid": line_uid,
            "source_row_uid": "ROW-1",
            "date": "2026-10-28",
            "quantity": 1,
            "hours": 2.5,
            "executor_uid": "PILOT-EMP",
            "executor_type": "employee",
            "ktu": 1.2,
            "status": "posted",
            "version": 1,
        }
        msg = await _apply_fact(db, tenant_id, fact_uid, fact_payload)
        print("fact_apply", msg)
        fact = (await db.execute(select(ExecutionFact).where(ExecutionFact.tenant_id == tenant_id, ExecutionFact.source_document_uid == fact_uid))).scalars().first()
        print("fact", fact.fact_type if fact else None, "wo", str(fact.work_order_id) if fact and fact.work_order_id else None, "line", fact.work_order_line_uid if fact else None, "ktu", float(fact.ktu) if fact and fact.ktu is not None else None)
        # cleanup
        if fact:
            await db.delete(fact)
        operation_id = line.operation_id if line else None
        await db.delete(wo)
        await db.flush()
        if operation_id:
            op = await db.get(Operation, operation_id)
            if op:
                await db.delete(op)
        await db.commit()
        print("cleaned")


asyncio.run(main())
