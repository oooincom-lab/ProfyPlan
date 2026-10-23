"""API каркаса интеграций: подключения, файловый обмен, журнал (14.10.2026).

Маршруты:
- настройки подключений (создание/список/изменение/удаление);
- экспорт фиксации плана в исходящий пакет (файл в out_dir + журнал);
- загрузка/скан входящих пакетов (upload или каталог in_dir), очередь inbox;
- журнал обмена и содержимое очереди.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import RedirectResponse, Response
from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_tenant_id, get_current_user, get_integration_tenant_id
from app.models.integration import ExchangeInboxItem, ExchangeLease, ExchangeLogEntry, IntegrationConnection
from app.models.tenant import User
from app.core.security import create_agent_token
from app.services.integration_exchange import (
    make_envelope,
    export_plan_snapshot,
    process_incoming,
    scan_inbox_dir,
    cleanup_exchange_log,
)
from app.services.cloud_exchange import CloudError, FOLDERS, _persist_layout, archive_month, cloud_root_name, cloud_settings, poll_cloud, provider_for
from app.services.cloud_oauth import (
    OAuthError,
    authorization_url,
    decode_state,
    exchange_code,
    oauth_for,
    oauth_configured,
    save_oauth_tokens,
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


class LeaseIn(BaseModel):
    agent_id: str
    instance_id: str
    session_id: Optional[str] = None
    ttl_seconds: int = 90


class LeaseHeartbeatIn(BaseModel):
    lease_token: str


class LeaseTokenIn(BaseModel):
    lease_token: str


class AgentPairIn(BaseModel):
    connection_id: UUID
    code: str
    instance_id: str
    agent_name: Optional[str] = "windows-companion"


class AckOutboxIn(BaseModel):
    pass


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
    tenant_id: UUID = Depends(get_integration_tenant_id),
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
    tenant_id: UUID = Depends(get_integration_tenant_id),
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
    tenant_id: UUID = Depends(get_integration_tenant_id),
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
    tenant_id: UUID = Depends(get_integration_tenant_id),
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
    tenant_id: UUID = Depends(get_integration_tenant_id),
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
    tenant_id: UUID = Depends(get_integration_tenant_id),
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
    tenant_id: UUID = Depends(get_integration_tenant_id),
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
    tenant_id: UUID = Depends(get_integration_tenant_id),
):
    """Обработать все входящие пакеты из каталога in подключения."""
    conn = await _get_conn(db, conn_id, tenant_id)
    await cleanup_exchange_log(db, tenant_id)
    return await scan_inbox_dir(db, conn, tenant_id)


@router.get("/connections/{conn_id}/cloud/status")
async def cloud_status(
    conn_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_integration_tenant_id),
):
    conn = await _get_conn(db, conn_id, tenant_id)
    cfg = cloud_settings(conn)
    provider = str(cfg.get("provider") or "yandex").lower()
    oauth = oauth_for(conn, provider)
    oauth_connected = bool(oauth.get("refresh_token_enc")) and oauth.get("provider") == provider
    if provider == "google":
        root = str(cfg.get("root_name") or cfg.get("root_folder_id") or "Google Drive")
        env_token = bool(
            os.environ.get("GOOGLE_DRIVE_ACCESS_TOKEN")
            or settings.google_drive_access_token
        )
    elif provider == "yandex":
        root = cloud_root_name(conn)
        env_token = bool(os.environ.get("YANDEX_DISK_TOKEN") or settings.yandex_disk_token)
    else:
        root = str(cfg.get("root") or "")
        env_token = False
    token = bool(oauth_connected or env_token)
    try:
        raw_poll = cfg.get("poll_minutes")
        poll_minutes = int(raw_poll) if raw_poll is not None else 5
    except (TypeError, ValueError):
        poll_minutes = 5
    poll_minutes = max(1, min(60, poll_minutes))
    last_poll = await db.scalar(
        select(func.max(ExchangeLogEntry.created_at)).where(
            ExchangeLogEntry.connection_id == conn.id,
            ExchangeLogEntry.kind == "cloud_poll",
        )
    )
    return {
        "provider": provider,
        "root": root,
        "configured": token,
        "oauth_connected": oauth_connected,
        "oauth_available": oauth_configured(provider),
        "account": str(oauth.get("account") or ""),
        "folders": list(FOLDERS),
        "archive_month": archive_month(),
        "transport": "cloud",
        "poll_minutes": poll_minutes,
        "scheduler_enabled": bool(settings.cloud_scheduler_enabled),
        "last_poll_at": last_poll.isoformat() if last_poll else None,
    }


@router.get("/connections/{conn_id}/cloud/oauth/start")
async def cloud_oauth_start(
    conn_id: UUID,
    provider: str = "yandex",
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_integration_tenant_id),
):
    """Вернуть URL согласия провайдера; пользователь только подтверждает доступ."""
    conn = await _get_conn(db, conn_id, tenant_id)
    provider = str(provider or "yandex").lower()
    try:
        url = authorization_url(str(conn.id), str(conn.tenant_id), provider)
    except OAuthError as exc:
        raise HTTPException(400, str(exc))
    return {"authorize_url": url, "provider": provider}


def _oauth_redirect(url: str, **params) -> RedirectResponse:
    from urllib.parse import urlencode

    separator = "&" if "?" in url else "?"
    return RedirectResponse(url + separator + urlencode(params))


@router.get("/cloud/oauth/callback")
async def cloud_oauth_callback(
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """Публичный callback OAuth: проверяет подписанный state и сохраняет токен."""
    failure_url = settings.cloud_oauth_failure_url or settings.cloud_oauth_success_url
    try:
        payload = decode_state(state or "")
    except OAuthError as exc:
        return _oauth_redirect(failure_url, cloud="error", message=str(exc))
    try:
        connection_uuid = UUID(str(payload["connection_id"]))
    except (ValueError, TypeError):
        return _oauth_redirect(failure_url, cloud="error", message="Некорректное подключение")
    conn = await db.get(IntegrationConnection, connection_uuid)
    if conn is None or str(conn.tenant_id) != str(payload.get("tenant_id")):
        return _oauth_redirect(failure_url, cloud="error", message="Подключение не найдено")
    provider = str(payload.get("provider"))
    if error:
        db.add(ExchangeLogEntry(
            tenant_id=conn.tenant_id, connection_id=conn.id, direction="in",
            kind="cloud_oauth", status="error", entities_count=0,
            message=("OAuth отменён: " + str(error))[:500],
        ))
        await db.commit()
        return _oauth_redirect(failure_url, cloud="error", message="Доступ не подтверждён")
    if not code:
        return _oauth_redirect(failure_url, cloud="error", message="Провайдер не вернул код")
    try:
        tokens = await exchange_code(provider, code)
        save_oauth_tokens(conn, provider, tokens)
        # Сразу создаём канонические папки и запоминаем их ID.
        cloud_provider = await provider_for(conn, db)
        try:
            await cloud_provider.ensure_layout()
            await _persist_layout(conn, db, cloud_provider)
        finally:
            await cloud_provider.close()
        await db.commit()
    except (OAuthError, CloudError) as exc:
        db.add(ExchangeLogEntry(
            tenant_id=conn.tenant_id, connection_id=conn.id, direction="in",
            kind="cloud_oauth", status="error", entities_count=0,
            message=str(exc)[:500],
        ))
        await db.commit()
        return _oauth_redirect(failure_url, cloud="error", message=str(exc)[:180])
    return _oauth_redirect(
        settings.cloud_oauth_success_url,
        cloud="connected",
        connection=str(conn.id),
        provider=provider,
    )


@router.post("/connections/{conn_id}/cloud/check")
async def cloud_check(
    conn_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_integration_tenant_id),
):
    conn = await _get_conn(db, conn_id, tenant_id)
    try:
        provider = await provider_for(conn, db)
        try:
            await provider.ensure_layout()
            await _persist_layout(conn, db, provider)
        finally:
            await provider.close()
    except CloudError as exc:
        db.add(ExchangeLogEntry(
            tenant_id=tenant_id, connection_id=conn.id, direction="in",
            kind="cloud_check", status="error", entities_count=0, message=str(exc)[:500],
        ))
        await db.commit()
        raise HTTPException(400, str(exc))
    provider_name = getattr(provider, "name", "cloud")
    root_label = getattr(provider, "root_label", provider.root)
    db.add(ExchangeLogEntry(
        tenant_id=tenant_id, connection_id=conn.id, direction="in",
        kind="cloud_check", status="ok", entities_count=0,
        message="Облачные папки доступны: %s" % root_label,
    ))
    await db.commit()
    return {"ok": True, "provider": provider_name, "root": root_label}


@router.post("/connections/{conn_id}/cloud/poll")
async def cloud_poll(
    conn_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_integration_tenant_id),
):
    conn = await _get_conn(db, conn_id, tenant_id)
    await cleanup_exchange_log(db, tenant_id)
    try:
        result = await poll_cloud(db, conn, tenant_id)
    except CloudError as exc:
        db.add(ExchangeLogEntry(
            tenant_id=tenant_id, connection_id=conn.id, direction="in",
            kind="cloud_poll", status="error", entities_count=0, message=str(exc)[:500],
        ))
        await db.commit()
        raise HTTPException(400, str(exc))
    return result


@router.post("/inbox/apply")
async def apply_inbox(
    body: ApplyIn,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_integration_tenant_id),
):
    """Применить ожидающие элементы очереди к справочникам (конвейер профиля УНФ)."""
    return await apply_pending(db, tenant_id, body.connection_id, body.limit)


@router.post("/connections/{conn_id}/odata/test")
async def odata_test(
    conn_id: UUID,
    body: ODataTestIn,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_integration_tenant_id),
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
    tenant_id: UUID = Depends(get_integration_tenant_id),
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
    tenant_id: UUID = Depends(get_integration_tenant_id),
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
    tenant_id: UUID = Depends(get_integration_tenant_id),
):
    q = select(ExchangeInboxItem).where(ExchangeInboxItem.tenant_id == tenant_id)
    if connection_id:
        q = q.where(ExchangeInboxItem.connection_id == connection_id)
    if status:
        q = q.where(ExchangeInboxItem.status == status)
    q = q.order_by(ExchangeInboxItem.created_at.desc().nullslast()).limit(min(max(limit, 1), 500))
    res = await db.execute(q)
    return {"items": [InboxOut.model_validate(x) for x in res.scalars().all()]}

# ─── Привязка companion по одноразовому коду ───

@router.post("/connections/{conn_id}/agent-code")
async def create_agent_code(
    conn_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_integration_tenant_id),
    user: User = Depends(get_current_user),
):
    """Создать одноразовый код привязки companion (10 минут)."""
    conn = await _get_conn(db, conn_id, tenant_id)
    code = secrets.token_hex(3).upper()
    settings = dict(conn.settings or {})
    settings["agent_code_hash"] = hashlib.sha256(code.encode("utf-8")).hexdigest()
    settings["agent_code_expires"] = (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()
    conn.settings = settings
    await db.commit()
    return {
        "connection_id": str(conn.id),
        "connection_name": conn.name,
        "code": code,
        "expires_in": 600,
    }


@router.post("/agent/pair")
async def agent_pair(
    body: AgentPairIn,
    db: AsyncSession = Depends(get_db),
):
    """Обменять одноразовый код на долгоживущий агентский токен."""
    conn = (
        await db.execute(
            select(IntegrationConnection).where(
                IntegrationConnection.id == body.connection_id,
                IntegrationConnection.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if conn is None:
        raise HTTPException(400, "Подключение не найдено или отключено")
    settings = dict(conn.settings or {})
    expected = settings.get("agent_code_hash")
    expires_raw = settings.get("agent_code_expires")
    if not expected or not expires_raw:
        raise HTTPException(400, "Код привязки не создан")
    try:
        expires = datetime.fromisoformat(expires_raw)
    except Exception:
        raise HTTPException(400, "Код привязки повреждён")
    if expires < datetime.now(timezone.utc):
        raise HTTPException(400, "Код привязки истёк")
    if hashlib.sha256(body.code.strip().upper().encode("utf-8")).hexdigest() != expected:
        raise HTTPException(400, "Неверный код привязки")
    if not body.instance_id.strip():
        raise HTTPException(400, "instance_id обязателен")
    token, jti = create_agent_token(
        "agent:" + body.instance_id.strip()[:80],
        str(conn.tenant_id),
        str(conn.id),
        days=90,
    )
    settings.pop("agent_code_hash", None)
    settings.pop("agent_code_expires", None)
    settings["agent_token_jti"] = jti
    settings["agent_instance_id"] = body.instance_id.strip()[:120]
    settings["agent_name"] = (body.agent_name or "windows-companion")[:120]
    settings["agent_paired_at"] = datetime.now(timezone.utc).isoformat()
    conn.settings = settings
    await db.commit()
    return {
        "access_token": token,
        "token_type": "Bearer",
        "expires_in": 90 * 24 * 3600,
        "connection_id": str(conn.id),
        "connection_name": conn.name,
    }


# ─── Lease активного обмена: одна машина/сессия на подключение ───

LEASE_TTL_DEFAULT = 90
LEASE_TTL_MIN = 30
LEASE_TTL_MAX = 300


def _lease_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _lease_holder(row: Optional[ExchangeLease]) -> Optional[dict]:
    if row is None:
        return None
    return {
        "agent_id": row.agent_id,
        "instance_id": row.instance_id,
        "session_id": row.session_id,
        "expires_at": row.expires_at.isoformat() if row.expires_at else None,
    }


async def _cleanup_lease(db: AsyncSession, conn_id: UUID) -> None:
    await db.execute(
        delete(ExchangeLease).where(
            ExchangeLease.connection_id == conn_id,
            ExchangeLease.expires_at < datetime.now(timezone.utc),
        )
    )
    await db.flush()


async def _get_lease(db: AsyncSession, conn_id: UUID) -> Optional[ExchangeLease]:
    now = datetime.now(timezone.utc)
    return (
        await db.execute(
            select(ExchangeLease).where(
                ExchangeLease.connection_id == conn_id,
                ExchangeLease.expires_at > now,
            )
        )
    ).scalar_one_or_none()


@router.get("/connections/{conn_id}/agent-config")
async def agent_config(
    conn_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_integration_tenant_id),
):
    """Метаданные подключения для браузерного помощника (без секретов)."""
    conn = await _get_conn(db, conn_id, tenant_id)
    return {
        "connection_id": str(conn.id),
        "name": conn.name,
        "profile": conn.profile,
        "transport": conn.transport,
        "is_active": conn.is_active,
        "has_settings": bool(conn.settings),
    }


@router.get("/connections/{conn_id}/lease")
async def get_lease(
    conn_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_integration_tenant_id),
):
    """Кто сейчас держит обмен на подключении."""
    await _get_conn(db, conn_id, tenant_id)
    await _cleanup_lease(db, conn_id)
    row = await _get_lease(db, conn_id)
    return {"connection_id": str(conn_id), "holder": _lease_holder(row)}


@router.post("/connections/{conn_id}/lease")
async def acquire_lease(
    conn_id: UUID,
    body: LeaseIn,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_integration_tenant_id),
):
    """Взять lease обмена. Второй экземпляр получает 409 с данными держателя."""
    await _get_conn(db, conn_id, tenant_id)
    if not body.agent_id.strip() or not body.instance_id.strip():
        raise HTTPException(400, "agent_id и instance_id обязательны")
    ttl = max(LEASE_TTL_MIN, min(int(body.ttl_seconds or LEASE_TTL_DEFAULT), LEASE_TTL_MAX))
    await _cleanup_lease(db, conn_id)
    row = await _get_lease(db, conn_id)
    now = datetime.now(timezone.utc)
    if row is not None and row.instance_id != body.instance_id:
        raise HTTPException(409, detail={
            "code": "lease_busy",
            "message": "Обмен уже идёт на другом компьютере или в другой сессии",
            "holder": _lease_holder(row),
        })
    token = secrets.token_urlsafe(32)
    expires = now + timedelta(seconds=ttl)
    if row is None:
        row = ExchangeLease(
            tenant_id=tenant_id,
            connection_id=conn_id,
            agent_id=body.agent_id.strip()[:120],
            instance_id=body.instance_id.strip()[:120],
            session_id=(body.session_id or "")[:120] or None,
            token_hash=_lease_hash(token),
            expires_at=expires,
        )
        db.add(row)
    else:
        row.agent_id = body.agent_id.strip()[:120]
        row.session_id = (body.session_id or "")[:120] or None
        row.token_hash = _lease_hash(token)
        row.expires_at = expires
    await db.commit()
    return {
        "connection_id": str(conn_id),
        "lease_token": token,
        "expires_at": expires.isoformat(),
        "ttl_seconds": ttl,
        "holder": _lease_holder(row),
    }


@router.post("/connections/{conn_id}/lease/heartbeat")
async def heartbeat_lease(
    conn_id: UUID,
    body: LeaseHeartbeatIn,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_integration_tenant_id),
):
    """Продлить lease; без heartbeat он истекает и обмен останавливается."""
    await _get_conn(db, conn_id, tenant_id)
    row = await _get_lease(db, conn_id)
    if row is None or row.token_hash != _lease_hash(body.lease_token):
        raise HTTPException(409, "Lease не найден или уже перехвачен")
    if row.expires_at < datetime.now(timezone.utc):
        raise HTTPException(409, "Lease истёк — возьмите заново")
    row.expires_at = datetime.now(timezone.utc) + timedelta(seconds=LEASE_TTL_DEFAULT)
    await db.commit()
    return {"ok": True, "expires_at": row.expires_at.isoformat()}


@router.delete("/connections/{conn_id}/lease")
async def release_lease(
    conn_id: UUID,
    body: LeaseTokenIn,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_integration_tenant_id),
):
    """Освободить lease (закрытие сессии, остановка обмена)."""
    await _get_conn(db, conn_id, tenant_id)
    row = await _get_lease(db, conn_id)
    if row is not None and row.token_hash == _lease_hash(body.lease_token):
        await db.delete(row)
        await db.commit()
    return {"ok": True}


@router.get("/connections/{conn_id}/outbox")
async def list_outbox(
    conn_id: UUID,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_integration_tenant_id),
):
    """Список исходящих пакетов, ожидающих доставки на машину пользователя."""
    conn = await _get_conn(db, conn_id, tenant_id)
    from app.services.integration_exchange import _dirs, _ensure

    out_dir = _ensure(_dirs(conn)[1])
    items = []
    for name in sorted(os.listdir(out_dir)):
        path = os.path.join(out_dir, name)
        if not os.path.isfile(path) or not name.lower().endswith(".json"):
            continue
        st = os.stat(path)
        items.append({"name": name, "size": st.st_size, "mtime": st.st_mtime})
    return {"dir": out_dir, "items": items}


@router.post("/connections/{conn_id}/outbox/{file_name}/ack")
async def ack_outbox(
    conn_id: UUID,
    file_name: str,
    db: AsyncSession = Depends(get_db),
    tenant_id: UUID = Depends(get_integration_tenant_id),
):
    """Подтвердить доставку: перенести файл в out/archive."""
    conn = await _get_conn(db, conn_id, tenant_id)
    if "/" in file_name or "\\" in file_name or ".." in file_name:
        raise HTTPException(400, "Некорректное имя файла")
    from app.services.integration_exchange import _dirs, _ensure

    out_dir = _ensure(_dirs(conn)[1])
    archive = _ensure(os.path.join(out_dir, "archive"))
    src = os.path.join(out_dir, file_name)
    if not os.path.isfile(src):
        raise HTTPException(404, "Файл не найден")
    dst = os.path.join(archive, file_name)
    if os.path.exists(dst):
        dst = os.path.join(archive, "%s-%s" % (datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S"), file_name))
    os.replace(src, dst)
    return {"ok": True, "archived": os.path.basename(dst)}

