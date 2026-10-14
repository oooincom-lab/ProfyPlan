"""API каркаса интеграций: подключения, файловый обмен, журнал (14.10.2026).

Маршруты:
- настройки подключений (создание/список/изменение/удаление);
- экспорт фиксации плана в исходящий пакет (файл в out_dir + журнал);
- загрузка/скан входящих пакетов (upload или каталог in_dir), очередь inbox;
- журнал обмена и содержимое очереди.
"""
from __future__ import annotations

import io
import json
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_tenant_id, get_current_user
from app.models.integration import ExchangeInboxItem, ExchangeLogEntry, IntegrationConnection
from app.models.tenant import User
from app.services.integration_exchange import (
    make_envelope,
    export_plan_snapshot,
    process_incoming,
    scan_inbox_dir,
    cleanup_exchange_log,
)
from app.services.integration_apply import apply_pending
from app.services.odata_client import CATALOG_MAP, ODataClient, ODataError, map_catalog_row

router = APIRouter(prefix="/v1/integration", tags=["integration"])


class ConnectionIn(BaseModel):
    name: str
    profile: str = "1c_unf"
    transport: str = "file"
    settings: Optional[dict] = None
    comment: Optional[str] = None
    is_active: bool = True


class ConnectionOut(BaseModel):
    id: uuid.UUID
    name: str
    profile: str
    transport: str
    settings: Optional[dict] = None
    comment: Optional[str] = None
    is_active: bool
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ExportPlanIn(BaseModel):
    snapshot_id: UUID


class LogOut(BaseModel):
    id: uuid.UUID
    connection_id: Optional[uuid.UUID] = None
    direction: str
    kind: str
    status: str
    entities_count: int
    file_name: Optional[str] = None
    message: Optional[str] = None
    packet_id: Optional[str] = None
    details: Optional[dict] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class InboxOut(BaseModel):
    id: uuid.UUID
    connection_id: Optional[uuid.UUID] = None
    log_id: Optional[uuid.UUID] = None
    entity_type: str
    entity_uid: Optional[str] = None
    op: str
    status: str
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ApplyIn(BaseModel):
    connection_id: Optional[UUID] = None
    limit: int = 500


class ODataTestIn(BaseModel):
    probe_entity: Optional[str] = None


class ODataPullIn(BaseModel):
    entities: Optional[list] = None
    top: int = 200


async def _get_conn(db: AsyncSession, conn_id: UUID, tenant_id: UUID) -> IntegrationConnection:
    res = await db.execute(
        select(IntegrationConnection).where(
            IntegrationConnection.id == conn_id, IntegrationConnection.tenant_id == tenant_id
        )
    )
    conn = res.scalar_one_or_none()
    if conn is None:
        raise HTTPException(404, "Подключение не найдено")
    return conn


@router.post("/connections", response_model=ConnectionOut, status_code=201)
async def create_connection(
    body: ConnectionIn,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
    user: User = Depends(get_current_user),
):
    conn = IntegrationConnection(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        name=body.name,
        profile=body.profile,
        transport=body.transport,
        settings=body.settings,
        comment=body.comment,
        is_active=body.is_active,
    )
    db.add(conn)
    await db.commit()
    return conn


@router.get("/connections")
async def list_connections(
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    res = await db.execute(
        select(IntegrationConnection)
        .where(IntegrationConnection.tenant_id == tenant_id)
        .order_by(IntegrationConnection.created_at.asc().nullslast())
    )
    return {"items": [ConnectionOut.model_validate(x) for x in res.scalars().all()]}


@router.put("/connections/{conn_id}", response_model=ConnectionOut)
async def update_connection(
    conn_id: UUID,
    body: ConnectionIn,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    conn = await _get_conn(db, conn_id, tenant_id)
    conn.name = body.name
    conn.profile = body.profile
    conn.transport = body.transport
    conn.settings = body.settings
    conn.comment = body.comment
    conn.is_active = body.is_active
    await db.commit()
    return conn


@router.delete("/connections/{conn_id}", status_code=204)
async def delete_connection(
    conn_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    conn = await _get_conn(db, conn_id, tenant_id)
    await db.delete(conn)
    await db.commit()
    return Response(status_code=204)


@router.post("/connections/{conn_id}/export/plan-snapshot")
async def export_plan(
    conn_id: UUID,
    body: ExportPlanIn,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """Сформировать исходящий пакет плана из фиксации (файл в каталоге out)."""
    conn = await _get_conn(db, conn_id, tenant_id)
    await cleanup_exchange_log(db, tenant_id)
    try:
        return await export_plan_snapshot(db, conn, body.snapshot_id, tenant_id)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/connections/{conn_id}/files/{file_name}")
async def download_file(
    conn_id: UUID,
    file_name: str,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """Скачать файл пакета из каталога out подключения."""
    conn = await _get_conn(db, conn_id, tenant_id)
    if "/" in file_name or "\\" in file_name or ".." in file_name:
        raise HTTPException(400, "Некорректное имя файла")
    from app.services.integration_exchange import _dirs

    out_dir = _dirs(conn)[1]
    path = os.path.join(out_dir, file_name)
    if not os.path.isfile(path):
        raise HTTPException(404, "Файл не найден")
    data = io.open(path, "rb").read()
    return Response(
        content=data,
        media_type="application/json",
        headers={"Content-Disposition": 'attachment; filename="%s"' % file_name},
    )


@router.post("/connections/{conn_id}/import-file")
async def import_file(
    conn_id: UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """Загрузить входящий пакет (файлом) — разбор и запись в журнал/очередь."""
    conn = await _get_conn(db, conn_id, tenant_id)
    raw = await file.read()
    try:
        content = raw.decode("utf-8-sig")
    except Exception:
        raise HTTPException(400, "Файл не в UTF-8")
    try:
        return await process_incoming(db, conn, content, file.filename or "upload.json", tenant_id)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/connections/{conn_id}/scan")
async def scan_dir(
    conn_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """Обработать все входящие пакеты из каталога in подключения."""
    conn = await _get_conn(db, conn_id, tenant_id)
    await cleanup_exchange_log(db, tenant_id)
    return await scan_inbox_dir(db, conn, tenant_id)


@router.post("/inbox/apply")
async def apply_inbox(
    body: ApplyIn,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """Применить ожидающие элементы очереди к справочникам (конвейер профиля УНФ)."""
    return await apply_pending(db, tenant_id, body.connection_id, body.limit)


@router.post("/connections/{conn_id}/odata/test")
async def odata_test(
    conn_id: UUID,
    body: ODataTestIn,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """Проверка соединения OData: $metadata + (опционально) чтение строки сущности."""
    conn = await _get_conn(db, conn_id, tenant_id)
    st = conn.settings or {}
    base = st.get("base_url")
    if not base:
        raise HTTPException(400, "Укажите base_url в настройках подключения (settings.base_url)")
    client = ODataClient(base, st.get("username"), st.get("password"))
    try:
        info = await client.ping(body.probe_entity or st.get("probe_entity"))
    except ODataError as e:
        db.add(ExchangeLogEntry(tenant_id=tenant_id, connection_id=conn.id, direction="in", kind="odata_test", status="error", entities_count=0, message=str(e)[:500]))
        await db.commit()
        raise HTTPException(400, str(e))
    db.add(ExchangeLogEntry(tenant_id=tenant_id, connection_id=conn.id, direction="in", kind="odata_test", status="ok", entities_count=0, message="OData: соединение в порядке %s" % (info.get("probe") or "")))
    await db.commit()
    return {"ok": True, **info}


@router.post("/connections/{conn_id}/odata/pull")
async def odata_pull(
    conn_id: UUID,
    body: ODataPullIn,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    """Притянуть справочники из 1С по OData и положить в очередь (пакет refs)."""
    conn = await _get_conn(db, conn_id, tenant_id)
    st = conn.settings or {}
    base = st.get("base_url")
    if not base:
        raise HTTPException(400, "Укажите base_url в настройках подключения")
    entities = body.entities or ["Catalog_Номенклатура", "Catalog_Контрагенты", "Catalog_СтруктурныеЕдиницы", "Catalog_КлючевыеРесурсы"]
    client = ODataClient(base, st.get("username"), st.get("password"))
    packet_entities = []
    skipped = []
    for ent in entities:
        suffix = str(ent).split("_", 1)[-1]
        mapped = CATALOG_MAP.get(suffix)
        if not mapped:
            skipped.append(ent)
            continue
        try:
            rows = await client.get_entities(ent, top=body.top)
        except ODataError as e:
            db.add(ExchangeLogEntry(tenant_id=tenant_id, connection_id=conn.id, direction="in", kind="odata_pull", status="error", entities_count=0, message=str(e)[:500]))
            await db.commit()
            raise HTTPException(400, str(e))
        for row in rows:
            uid = row.get("Ссылка") or row.get("Ref_Key") or row.get("Код")
            packet_entities.append({"type": mapped, "uid": str(uid) if uid else None, "op": "upsert", "fields": map_catalog_row(suffix, row)})
    if not packet_entities:
        return {"pulled": 0, "skipped": skipped, "result": None}
    env = make_envelope("in", "refs", packet_entities, meta={"source": "odata", "entities": [str(e) for e in entities]})
    res = await process_incoming(db, conn, json.dumps(env, ensure_ascii=False), "odata_pull.json", tenant_id)
    return {"pulled": len(packet_entities), "skipped": skipped, "result": res}


@router.get("/log")
async def get_log(
    connection_id: Optional[UUID] = None,
    kind: Optional[str] = None,
    status: Optional[str] = None,
    direction: Optional[str] = None,
    days: Optional[int] = None,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    await cleanup_exchange_log(db, tenant_id)
    base = [ExchangeLogEntry.tenant_id == tenant_id]
    if connection_id:
        base.append(ExchangeLogEntry.connection_id == connection_id)
    if status:
        base.append(ExchangeLogEntry.status == status)
    if direction:
        base.append(ExchangeLogEntry.direction == direction)
    if days and days > 0:
        base.append(ExchangeLogEntry.created_at >= datetime.now(timezone.utc) - timedelta(days=min(int(days), 365)))
    conds = list(base)
    if kind:
        conds.append(ExchangeLogEntry.kind == kind)
    limit = min(max(limit, 1), 200)
    offset = max(offset, 0)
    q = (
        select(ExchangeLogEntry)
        .where(*conds)
        .order_by(ExchangeLogEntry.created_at.desc().nullslast())
        .limit(limit)
        .offset(offset)
    )
    res = await db.execute(q)
    total = (await db.execute(select(func.count()).select_from(ExchangeLogEntry).where(*conds))).scalar() or 0
    kinds_res = await db.execute(select(ExchangeLogEntry.kind).where(*base).distinct())
    kinds = sorted({k for (k,) in kinds_res.all() if k})
    return {"items": [LogOut.model_validate(x) for x in res.scalars().all()], "total": int(total), "kinds": kinds}


@router.get("/inbox")
async def get_inbox(
    connection_id: Optional[UUID] = None,
    status: Optional[str] = None,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_current_tenant_id),
):
    q = select(ExchangeInboxItem).where(ExchangeInboxItem.tenant_id == tenant_id)
    if connection_id:
        q = q.where(ExchangeInboxItem.connection_id == connection_id)
    if status:
        q = q.where(ExchangeInboxItem.status == status)
    q = q.order_by(ExchangeInboxItem.created_at.desc().nullslast()).limit(min(max(limit, 1), 500))
    res = await db.execute(q)
    return {"items": [InboxOut.model_validate(x) for x in res.scalars().all()]}
