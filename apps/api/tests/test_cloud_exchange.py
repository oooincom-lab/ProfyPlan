"""Тесты облачного адаптера без реальных токенов Яндекс Диска."""
from __future__ import annotations

from urllib.parse import quote

import httpx
import pytest

from app.services.cloud_exchange import YandexDiskClient


class FakeYandex:
    def __init__(self):
        self.folders = set()
        self.files: dict[str, bytes] = {}

    async def handler(self, request: httpx.Request) -> httpx.Response:
        url = request.url
        path = url.params.get("path") or ""
        if url.host == "download.test":
            name = "/" + url.path.lstrip("/")
            if name not in self.files:
                return httpx.Response(404, text="not found")
            return httpx.Response(200, content=self.files[name])
        if url.host == "upload.test":
            name = "/" + url.path.lstrip("/")
            self.files[name] = request.content
            return httpx.Response(201)
        if url.path.endswith("/resources") and request.method == "PUT":
            if path in self.folders:
                return httpx.Response(409, json={"message": "exists"})
            self.folders.add(path)
            return httpx.Response(201)
        if url.path.endswith("/resources") and request.method == "GET":
            if path not in self.folders:
                return httpx.Response(404, json={"message": "not found"})
            prefix = path.rstrip("/") + "/"
            items = []
            for full in sorted(self.files):
                if not full.startswith(prefix):
                    continue
                name = full[len(prefix):]
                if "/" in name:
                    continue
                items.append({"name": name, "path": full, "type": "file", "size": len(self.files[full])})
            return httpx.Response(200, json={"_embedded": {"items": items}})
        if url.path.endswith("/resources/download"):
            return httpx.Response(200, json={"href": "https://download.test/" + quote(path, safe="")})
        if url.path.endswith("/resources/upload"):
            return httpx.Response(200, json={"href": "https://upload.test/" + quote(path, safe="")})
        if url.path.endswith("/resources/move"):
            source = url.params.get("from") or ""
            target = url.params.get("path") or ""
            if source not in self.files:
                return httpx.Response(404, json={"message": "not found"})
            self.files[target] = self.files.pop(source)
            return httpx.Response(201)
        return httpx.Response(404, json={"message": "unexpected " + request.method + " " + str(url)})


@pytest.mark.asyncio
async def test_yandex_layout_upload_download_move():
    fake = FakeYandex()
    transport = httpx.MockTransport(fake.handler)
    client = httpx.AsyncClient(transport=transport, base_url="https://cloud-api.yandex.net")
    disk = YandexDiskClient("test-token", root="/ProfyPlan", http_client=client)
    try:
        await disk.ensure_layout()
        assert "/ProfyPlan" in fake.folders
        assert "/ProfyPlan/processed/1c_to_plan" in fake.folders
        assert "/ProfyPlan/plan_to_1c" in fake.folders

        source = disk.path("1c_to_plan/packet.json")
        await disk.upload(source, b'{"schema":"profyplan.exchange.v1"}')
        files = await disk.list_files("1c_to_plan")
        assert [f["name"] for f in files] == ["packet.json"]
        assert (await disk.download(source)).startswith(b'{"schema"')

        target = disk.path("processed/1c_to_plan/packet.json")
        await disk.move(source, target)
        assert target in fake.files
        assert source not in fake.files
    finally:
        await client.aclose()
