"""Сервис обмена: конверт profyplan.exchange.v1, экспорт/импорт пакетов (срез 1, 14.10.2026).

Файловый транспорт: пакеты — JSON-файлы в каталогах подключения (in_dir/out_dir),
по умолчанию /app/exchange/in|out (переопределяется в settings подключения).
Обработчики входящих: ping — полный цикл; прочие виды складываются в очередь
(ExchangeInboxItem) для конвейера профиля (срез 2+).
"""
from __future__ import annotations

import io
import json
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.integration import ExchangeInboxItem, ExchangeLogEntry, IntegrationConnection
from app.models.plan_snapshot import PlanSnapshot, PlanSnapshotRow

SCHEMA = "profyplan.exchange.v1"
BASE_DIR = os.environ.get("EXCHANGE_DIR", "/app/exchange")


# ── Хранение истории обмена — константа: 30 дней (решение владельца, 15.10.2026) ──
# Журнал обмена и очередь принятого хранятся 30 дней; всё старше удаляется
# автоматически при работе с разделом (включая неприменённые элементы очереди).
EXCHANGE_LOG_RETENTION_DAYS = 30


async def cleanup_exchange_log(db: AsyncSession, tenant_id: UUID) -> int:
    """Удалить записи журнала и элементы очереди старше срока хранения (константа)."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=EXCHANGE_LOG_RETENTION_DAYS)
    res = await db.execute(
        delete(ExchangeLogEntry).where(
            ExchangeLogEntry.tenant_id == tenant_id,
            ExchangeLogEntry.created_at < cutoff,
        )
    )
    deleted = res.rowcount or 0
    await db.execute(
        delete(ExchangeInboxItem).where(
            ExchangeInboxItem.tenant_id == tenant_id,
            ExchangeInboxItem.created_at < cutoff,
        )
    )
    await db.commit()
    return deleted

def _dirs(conn: IntegrationConnection) -> tuple:
    st = conn.settings or {}
    in_dir = st.get("in_dir") or os.path.join(BASE_DIR, "in")
    out_dir = st.get("out_dir") or os.path.join(BASE_DIR, "out")
    return in_dir, out_dir


def _ensure(d: str) -> str:
    os.makedirs(d, exist_ok=True)
    return d


def make_envelope(direction: str, kind: str, entities: list, meta: Optional[dict] = None) -> dict:
    return {
        "schema": SCHEMA,
        "packet_id": uuid.uuid4().hex,
        "direction": direction,
        "kind": kind,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": {"system": "profyplan", "api": "v1"},
        "meta": meta or {},
        "entities": entities,
    }


def validate_envelope(env: dict) -> None:
    if not isinstance(env, dict):
        raise ValueError("Пакет не является JSON-объектом")
    if env.get("schema") != SCHEMA:
        raise ValueError("Неизвестная схема пакета: %s (ожидается %s)" % (env.get("schema"), SCHEMA))
    if not isinstance(env.get("entities"), list):
        raise ValueError("В пакете отсутствует список entities")


async def export_plan_snapshot(
    db: AsyncSession, conn: IntegrationConnection, snapshot_id: UUID, tenant_id: UUID
) -> dict:
    """Сформировать исходящий пакет плана из фиксации и положить файл в out_dir."""
    res = await db.execute(
        select(PlanSnapshot).where(PlanSnapshot.id == snapshot_id, PlanSnapshot.tenant_id == tenant_id)
    )
    snap = res.scalar_one_or_none()
    if snap is None:
        raise ValueError("Фиксация плана не найдена")

    rows_res = await db.execute(
        select(PlanSnapshotRow).where(PlanSnapshotRow.snapshot_id == snap.id)
    )
    rows = rows_res.scalars().all()

    entities = []
    for r in rows:
        entities.append(
            {
                "type": "plan_row",
                "uid": str(r.id),
                "op": "upsert",
                "fields": {
                    "order_ext_id": r.order_ext_id,
                    "order_ext_uid": r.order_ext_uid,
                    "order_uuid": str(r.order_id) if r.order_id else None,
                    "order_name": r.order_name,
                    "operation_uuid": str(r.operation_id) if r.operation_id else None,
                    "operation_ext_id": r.operation_ext_id,
                    "operation_name": r.operation_name,
                    "department_uuid": str(r.department_id) if r.department_id else None,
                    "department_code": r.department_code,
                    "department_name": r.department_name,
                    "department_ext_uid": r.department_ext_uid,
                    "resource_uuid": str(r.resource_id) if r.resource_id else None,
                    "resource_ext_id": r.resource_ext_id,
                    "resource_ext_uid": r.resource_ext_uid,
                    "resource_name": r.resource_name,
                    "start": r.start_datetime.isoformat() if r.start_datetime else None,
                    "finish": r.finish_datetime.isoformat() if r.finish_datetime else None,
                    "duration_hours": float(r.duration_hours) if r.duration_hours is not None else None,
                    "quantity": float(r.quantity) if r.quantity is not None else None,
                    "unit": r.unit,
                    # Загрузка ресурса на интервале start–finish (единиц ресурса); в v1 операция занимает 1 единицу.
                    "resource_load": 1,
                    "is_critical": bool(r.is_critical),
                },
            }
        )

    env = make_envelope(
        "out",
        "plan_snapshot",
        entities,
        meta={
            "snapshot_id": str(snap.id),
            "snapshot_name": snap.name,
            "project_id": str(snap.project_id),
            "planning_logic": snap.planning_logic,
            "data_fingerprint": snap.data_fingerprint,
            "start_anchor": snap.start_anchor.isoformat() if snap.start_anchor else None,
            "rows_count": snap.rows_count,
        },
    )
    fname = "plan_snapshot_%s_%s.json" % (
        str(snap.id)[:8],
        datetime.now().strftime("%Y%m%d_%H%M%S"),
    )
    out_dir = _ensure(_dirs(conn)[1])
    with io.open(os.path.join(out_dir, fname), "w", encoding="utf-8") as f:
        f.write(json.dumps(env, ensure_ascii=False, indent=2))

    log = ExchangeLogEntry(
        tenant_id=tenant_id,
        connection_id=conn.id,
        direction="out",
        kind="plan_snapshot",
        status="ok",
        entities_count=len(entities),
        file_name=fname,
        packet_id=env["packet_id"],
        message="Пакет плана сформирован: «%s», строк — %d" % (snap.name, len(entities)),
        details={"snapshot_id": str(snap.id)},
    )
    db.add(log)
    await db.commit()
    return {"file": fname, "entities": len(entities), "log_id": str(log.id), "out_dir": out_dir}


async def process_incoming(
    db: AsyncSession, conn: IntegrationConnection, content: str, file_name: str, tenant_id: UUID
) -> dict:
    """Разобрать входящий пакет: ping — полный цикл; прочее — в очередь (inbox)."""
    try:
        env = json.loads(content)
        validate_envelope(env)
    except Exception as e:
        log = ExchangeLogEntry(
            tenant_id=tenant_id,
            connection_id=conn.id,
            direction="in",
            kind="unknown",
            status="error",
            entities_count=0,
            file_name=file_name,
            message="Пакет отклонён: %s" % e,
        )
        db.add(log)
        await db.commit()
        raise ValueError(str(e))

    kind = str(env.get("kind") or "unknown")
    ents = env.get("entities") or []
    packet_id = env.get("packet_id")

    if kind == "ping":
        log = ExchangeLogEntry(
            tenant_id=tenant_id,
            connection_id=conn.id,
            direction="in",
            kind="ping",
            status="ok",
            entities_count=len(ents),
            file_name=file_name,
            packet_id=packet_id,
            message="Проверка соединения: пакет принят — канал в порядке",
        )
        db.add(log)
        await db.commit()
        return {"kind": kind, "items": 0, "status": "ok", "log_id": str(log.id)}

    log = ExchangeLogEntry(
        tenant_id=tenant_id,
        connection_id=conn.id,
        direction="in",
        kind=kind,
        status="partial",
        entities_count=len(ents),
        file_name=file_name,
        packet_id=packet_id,
        message="Пакет принят: элементов — %d; обработка — конвейером профиля (следующий срез)" % len(ents),
    )
    db.add(log)
    await db.flush()

    count = 0
    for e in ents:
        if not isinstance(e, dict):
            continue
        db.add(
            ExchangeInboxItem(
                tenant_id=tenant_id,
                connection_id=conn.id,
                log_id=log.id,
                entity_type=str(e.get("type") or "unknown")[:60],
                entity_uid=(str(e.get("uid"))[:120] if e.get("uid") else None),
                op=str(e.get("op") or "upsert")[:20],
                status="pending",
                payload=e,
            )
        )
        count += 1
    await db.commit()
    return {"kind": kind, "items": count, "status": "partial", "log_id": str(log.id)}


async def scan_inbox_dir(db: AsyncSession, conn: IntegrationConnection, tenant_id: UUID) -> dict:
    """Обработать все *.json пакеты из входного каталога; успешные — в подпапку processed."""
    in_dir = _ensure(_dirs(conn)[0])
    done_dir = _ensure(os.path.join(in_dir, "processed"))
    results = []
    try:
        names = sorted([f for f in os.listdir(in_dir) if f.lower().endswith(".json")])
    except Exception as e:
        return {"processed": 0, "error": str(e)}
    for fname in names:
        fp = os.path.join(in_dir, fname)
        try:
            content = io.open(fp, encoding="utf-8-sig").read()
            res = await process_incoming(db, conn, content, fname, tenant_id)
            results.append({"file": fname, "result": res})
            os.replace(fp, os.path.join(done_dir, "%s_%s" % (datetime.now().strftime("%H%M%S"), fname)))
        except Exception as e:
            results.append({"file": fname, "error": str(e)})
            try:
                os.replace(fp, os.path.join(done_dir, "err_%s_%s" % (datetime.now().strftime("%H%M%S"), fname)))
            except Exception:
                pass
    return {"processed": len(results), "results": results}
