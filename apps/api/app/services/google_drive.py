"""Google Drive provider для облачного обмена ProfyPlan.

Первый срез: OAuth access token и готовые ID канонических папок.
OAuth-refresh и автоматическое создание папок — следующий этап.
"""
from __future__ import annotations

import json
import uuid
from typing import Optional

import httpx

from app.services.cloud_exchange import CloudError, FOLDERS

API = "https://www.googleapis.com/drive/v3"
UPLOAD = "https://www.googleapis.com/upload/drive/v3/files"
FOLDER_MIME = "application/vnd.google-apps.folder"


class GoogleDriveClient:
    name = "google"
    root_label = "Google Drive"

    def __init__(
        self,
        access_token: str,
        folder_ids: dict,
        root_folder_id: Optional[str] = None,
        http_client: Optional[httpx.AsyncClient] = None,
    ):
        if not access_token:
            raise CloudError("Не задан GOOGLE_DRIVE_ACCESS_TOKEN")
        self.token = access_token
        self.folder_ids = {str(k): str(v) for k, v in (folder_ids or {}).items() if v}
        self.root_folder_id = root_folder_id
        self.root = root_folder_id or self.root_label
        self._client = http_client or httpx.AsyncClient(timeout=30.0)
        self._owns_client = http_client is None

    @property
    def headers(self) -> dict:
        return {"Authorization": "Bearer " + self.token}

    async def close(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def _request(self, method: str, url: str, **kwargs) -> httpx.Response:
        headers = dict(kwargs.pop("headers", {}))
        headers.update(self.headers)
        response = await self._client.request(method, url, headers=headers, **kwargs)
        if response.status_code >= 400:
            message = response.text[:300]
            try:
                message = response.json().get("error", {}).get("message") or message
            except Exception:
                pass
            raise CloudError("Google Drive %s: %s" % (response.status_code, message))
        return response

    @staticmethod
    def path(relative: str) -> str:
        return str(relative or "").strip("/")

    def _folder(self, relative: str) -> str:
        key = str(relative or "").strip("/")
        folder_id = self.folder_ids.get(key)
        if not folder_id:
            raise CloudError("Не задан folder_id для папки %s" % key)
        return folder_id

    def _split(self, relative: str) -> tuple:
        value = str(relative or "").strip("/")
        # Для processed/1c_to_plan/file.json выбираем самый длинный известный ключ.
        matches = [
            key for key in self.folder_ids
            if value.startswith(key + "/")
        ]
        if not matches:
            raise CloudError("Ожидается путь <папка>/<файл>: %s" % value)
        key = max(matches, key=len)
        name = value[len(key) + 1:]
        return self._folder(key), name

    async def ensure_layout(self) -> None:
        # Проверяем, что все ID существуют и являются папками.
        for key in FOLDERS:
            folder_id = self.folder_ids.get(key)
            if not folder_id:
                raise CloudError("Не задан folder_id для папки %s" % key)
            response = await self._request(
                "GET", API + "/files/" + folder_id, params={"fields": "id,name,mimeType"}
            )
            data = response.json()
            if data.get("mimeType") != FOLDER_MIME:
                raise CloudError("ID %s не является папкой Google Drive" % folder_id)

    async def list_files(self, relative: str) -> list[dict]:
        folder_id = self._folder(relative)
        query = "'%s' in parents and trashed = false" % folder_id
        response = await self._request(
            "GET",
            API + "/files",
            params={
                "q": query,
                "pageSize": 1000,
                "fields": "files(id,name,size,modifiedTime,md5Checksum),nextPageToken",
                "spaces": "drive",
            },
        )
        result = []
        for item in response.json().get("files") or []:
            name = str(item.get("name") or "")
            if not name.lower().endswith(".json") or name.startswith("."):
                continue
            result.append(
                {
                    "name": name,
                    "path": item.get("id"),
                    "size": item.get("size"),
                    "modified": item.get("modifiedTime"),
                    "md5": item.get("md5Checksum"),
                }
            )
        return result

    async def download(self, path: str) -> bytes:
        if not path:
            raise CloudError("Не задан ID файла Google Drive")
        response = await self._request("GET", API + "/files/" + path, params={"alt": "media"})
        return response.content

    async def upload(self, path: str, data: bytes, overwrite: bool = True) -> None:
        folder_id, name = self._split(path)
        boundary = "profyplan-" + uuid.uuid4().hex
        metadata = json.dumps(
            {"name": name, "parents": [folder_id]}, ensure_ascii=False
        ).encode("utf-8")
        body = (
            ("--%s\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" % boundary).encode()
            + metadata
            + ("\r\n--%s\r\nContent-Type: application/json\r\n\r\n" % boundary).encode()
            + data
            + ("\r\n--%s--\r\n" % boundary).encode()
        )
        # При overwrite=true ищем существующий файл и обновляем его.
        if overwrite:
            existing = await self._find_file(folder_id, name)
            if existing:
                response = await self._client.patch(
                    UPLOAD + "/" + existing,
                    params={"uploadType": "media"},
                    headers=self.headers,
                    content=data,
                )
                if response.status_code >= 400:
                    raise CloudError("Google Drive: ошибка обновления %s" % response.status_code)
                return
        response = await self._client.post(
            UPLOAD,
            params={"uploadType": "multipart"},
            headers={**self.headers, "Content-Type": "multipart/related; boundary=" + boundary},
            content=body,
        )
        if response.status_code >= 400:
            raise CloudError("Google Drive: ошибка загрузки %s" % response.status_code)

    async def _find_file(self, folder_id: str, name: str) -> Optional[str]:
        escaped = name.replace("\\", "\\\\").replace("'", "\\'")
        response = await self._request(
            "GET",
            API + "/files",
            params={
                "q": "name = '%s' and '%s' in parents and trashed = false" % (escaped, folder_id),
                "fields": "files(id,name)",
                "pageSize": 10,
            },
        )
        files = response.json().get("files") or []
        return files[0].get("id") if files else None

    async def move(self, source: str, destination: str, overwrite: bool = True) -> None:
        folder_id, name = self._split(destination)
        meta = await self._request(
            "GET", API + "/files/" + source, params={"fields": "id,parents"}
        )
        parents = meta.json().get("parents") or []
        params = {"addParents": folder_id, "fields": "id,parents"}
        if parents:
            params["removeParents"] = ",".join(parents)
        response = await self._client.patch(
            API + "/files/" + source,
            params=params,
            headers=self.headers,
            json={"name": name},
        )
        if response.status_code >= 400:
            raise CloudError("Google Drive: ошибка перемещения %s" % response.status_code)
