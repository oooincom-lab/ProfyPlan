"""Облачный обмен ProfyPlan с учётными системами (Яндекс Диск, Google Drive).

Первый срез: провайдер Яндекс Диска и общий сервис обмена. Провайдер Google
оставлен в интерфейсе, чтобы подключить его без изменения вызывающего кода.
"""
from __future__ import annotations

import hashlib
import os
from typing import Optional

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.integration import ExchangeLogEntry, IntegrationConnection
from app.services.integration_exchange import _dirs, process_incoming

FOLDERS = (
    "1c_to_plan",
    "plan_to_1c",
    "processed",
    "processed/1c_to_plan",
    "processed/plan_to_1c",
    "archive",
    "_state",
)


class CloudError(RuntimeError):
    """Ошибка облачного провайдера или его настройки."""


def _path(root: str, relative: str) -> str:
    relative = str(relative or "").strip("/")
    root = str(root or "/ProfyPlan").rstrip("/") or "/ProfyPlan"
    return root + ("/" + relative if relative else "")


class YandexDiskClient:
    """Минимальный REST-клиент Яндекс Диска для файлового обмена."""

    def __init__(
        self,
        token: str,
        root: str = "/ProfyPlan",
        http_client: Optional[httpx.AsyncClient] = None,
    ):
        if not token:
            raise CloudError("Не задан YANDEX_DISK_TOKEN")
        self.token = token
        self.root = str(root or "/ProfyPlan").rstrip("/") or "/ProfyPlan"
        self.base_url = "https://cloud-api.yandex.net/v1/disk"
        self._client = http_client or httpx.AsyncClient(timeout=30.0)
        self._owns_client = http_client is None

    async def close(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def _request(self, method: str, endpoint: str, **kwargs) -> httpx.Response:
        headers = dict(kwargs.pop("headers", {}))
        headers["Authorization"] = "OAuth " + self.token
        response = await self._client.request(
            method, self.base_url + endpoint, headers=headers, **kwargs
        )
        if response.status_code >= 400:
            message = response.text[:300]
            try:
                message = response.json().get("message") or message
            except Exception:
                pass
            raise CloudError("Яндекс Диск %s: %s" % (response.status_code, message))
        return response

    def path(self, relative: str) -> str:
        return _path(self.root, relative)

    async def ensure_folder(self, relative: str) -> None:
        path = self.path(relative)
        response = await self._client.put(
            self.base_url + "/resources",
            headers={"Authorization": "OAuth " + self.token},
            params={"path": path},
        )
        if response.status_code in (201, 409):
            return
        if response.status_code >= 400:
            message = response.text[:300]
            try:
                message = response.json().get("message") or message
            except Exception:
                pass
            raise CloudError("Яндекс Диск %s: %s" % (response.status_code, message))

    async def ensure_layout(self) -> None:
        await self.ensure_folder("")
        for folder in FOLDERS:
            await self.ensure_folder(folder)

    async def list_files(self, relative: str) -> list[dict]:
        response = await self._request(
            "GET",
            "/resources",
            params={
                "path": self.path(relative),
                "limit": 1000,
                "sort": "name",
            },
        )
        data = response.json()
        items = (data.get("_embedded") or {}).get("items") or []
        result = []
        for item in items:
            if item.get("type") != "file":
                continue
            name = str(item.get("name") or "")
            if not name.lower().endswith(".json") or name.startswith("."):
                continue
            result.append(
                {
                    "name": name,
                    "path": item.get("path") or self.path(relative + "/" + name),
                    "size": item.get("size"),
                    "modified": item.get("modified"),
                    "md5": item.get("md5"),
                }
            )
        return result

    async def download(self, path: str) -> bytes:
        response = await self._request(
            "GET", "/resources/download", params={"path": path}
        )
        href = response.json().get("href")
        if not href:
            raise CloudError("Яндекс Диск не вернул ссылку на скачивание")
        if not str(href).lower().startswith("https://"):
            raise CloudError("Яндекс Диск вернул не-HTTPS ссылку")
        download = await self._client.get(href)
        if download.status_code >= 400:
            raise CloudError("Яндекс Диск: ошибка скачивания %s" % download.status_code)
        return download.content

    async def upload(self, path: str, data: bytes, overwrite: bool = True) -> None:
        response = await self._request(
            "GET",
            "/resources/upload",
            params={"path": path, "overwrite": "true" if overwrite else "false"},
        )
        href = response.json().get("href")
        if not href:
            raise CloudError("Яндекс Диск не вернул ссылку на загрузку")
        if not str(href).lower().startswith("https://"):
            raise CloudError("Яндекс Диск вернул не-HTTPS ссылку")
        uploaded = await self._client.put(href, content=data)
        if uploaded.status_code >= 400:
            raise CloudError("Яндекс Диск: ошибка загрузки %s" % uploaded.status_code)

    async def move(self, source: str, destination: str, overwrite: bool = True) -> None:
        await self._request(
            "POST",
            "/resources/move",
            params={
                "from": source,
                "path": destination,
                "overwrite": "true" if overwrite else "false",
            },
        )


def cloud_settings(conn: IntegrationConnection) -> dict:
    data = (conn.settings or {}).get("cloud") or {}
    return data if isinstance(data, dict) else {}


def provider_for(conn: IntegrationConnection):
    data = cloud_settings(conn)
    provider = str(data.get("provider") or "yandex").lower()
    root = data.get("root") or settings.yandex_disk_root or "/ProfyPlan"
    if provider == "yandex":
        token = os.environ.get("YANDEX_DISK_TOKEN") or settings.yandex_disk_token
        if not token:
            raise CloudError("Не задан YANDEX_DISK_TOKEN на сервере")
        return YandexDiskClient(token, root=root)
    if provider == "google":
        raise CloudError("Google Drive адаптер ещё не включён; выберите yandex")
    raise CloudError("Неизвестный облачный провайдер: %s" % provider)


async def _log_error(
    db: AsyncSession,
    conn: IntegrationConnection,
    tenant_id,
    file_name: str,
    message: str,
) -> None:
    db.add(
        ExchangeLogEntry(
            tenant_id=tenant_id,
            connection_id=conn.id,
            direction="in",
            kind="cloud",
            status="error",
            entities_count=0,
            file_name=file_name,
            message=message[:500],
        )
    )
    await db.commit()


async def process_incoming_cloud(
    db: AsyncSession,
    conn: IntegrationConnection,
    provider: YandexDiskClient,
    tenant_id,
) -> dict:
    """Прочитать 1c_to_plan, обработать пакеты и перенести их в processed."""
    files = await provider.list_files("1c_to_plan")
    processed = 0
    errors = []
    for item in files:
        name = os.path.basename(str(item.get("name") or ""))
        if not name or name in (".", "..") or name.startswith("."):
            continue
        try:
            content = (await provider.download(item["path"])).decode("utf-8-sig")
            await process_incoming(db, conn, content, name, tenant_id)
            await provider.move(
                item["path"], provider.path("processed/1c_to_plan/" + name)
            )
            processed += 1
        except Exception as exc:
            errors.append({"file": name, "error": str(exc)})
            try:
                await provider.move(item["path"], provider.path("archive/" + name))
            except Exception:
                pass
            await _log_error(db, conn, tenant_id, name, str(exc))
    return {"files": len(files), "processed": processed, "errors": errors}


async def publish_outbox_cloud(
    db: AsyncSession,
    conn: IntegrationConnection,
    provider: YandexDiskClient,
) -> dict:
    """Выгрузить новые файлы из локального out в plan_to_1c без повторной отправки."""
    out_dir = _dirs(conn)[1]
    sent = dict((conn.settings or {}).get("cloud_out_sent") or {})
    uploaded = []
    try:
        names = sorted(
            f for f in os.listdir(out_dir) if f.lower().endswith(".json")
        )
    except FileNotFoundError:
        names = []
    for name in names:
        path = os.path.join(out_dir, name)
        if not os.path.isfile(path):
            continue
        with open(path, "rb") as fh:
            data = fh.read()
        digest = hashlib.sha256(data).hexdigest()
        if sent.get(name) == digest:
            continue
        await provider.upload(provider.path("plan_to_1c/" + name), data)
        sent[name] = digest
        uploaded.append(name)
    if uploaded:
        current = dict(conn.settings or {})
        current["cloud_out_sent"] = sent
        conn.settings = current
        await db.commit()
    return {"uploaded": uploaded, "skipped": len(names) - len(uploaded)}


async def poll_cloud(
    db: AsyncSession,
    conn: IntegrationConnection,
    tenant_id,
) -> dict:
    provider = provider_for(conn)
    try:
        await provider.ensure_layout()
        incoming = await process_incoming_cloud(db, conn, provider, tenant_id)
        outgoing = await publish_outbox_cloud(db, conn, provider)
        return {
            "provider": "yandex",
            "root": provider.root,
            "incoming": incoming,
            "outgoing": outgoing,
        }
    finally:
        await provider.close()
