"""Тесты сохранённых видов (промт, Дополнение 8).

Проверяется:
1) создание вида и чтение конверта;
2) упор в лимит числа сохранений (лимит читается из общих настроек);
3) шаринг — не более одного общего вида на пользователя;
4) доступ на чтение и на изменение (личный / общий-чтение / общий-изменение);
5) экспорт, затем импорт — содержимое совпадает.

Запуск в контейнере API:
    docker exec profyplan-api python -m pytest tests/test_saved_views.py -q

Тесты идут по живому стенду (та же база), создают свои виды с уникальным
префиксом и удаляют их за собой.
"""
from __future__ import annotations

import os
import sys
import uuid
from types import SimpleNamespace

import psycopg2
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.config import settings  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.main import app  # noqa: E402

PLANNER = ("planner@demo.ru", "demo123")
COLLEAGUE = ("saved-views-colleague@demo.ru", "demo123")

# Конверт настроек: разделы по видам, версия схемы, ручные позиции узлов.
ENVELOPE = {
    "schema_version": 1,
    "sections": {
        "cpm": {"mode": "byDate", "layout": "normal", "critOnly": False, "showEndpoints": True},
        "gantt": {"zoom": 80},
        "pools": {"poolId": None},
        "general": {"fontSize": "md", "unit": "d"},
    },
    "node_positions": {"byDate": {"op-1": [12.5, 30]}},
    "layout": {"mode": "byDate", "preset": "normal"},
}


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _login(client: TestClient, email: str, password: str) -> dict:
    response = client.post("/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return response.json()


def _ensure_colleague(tenant_id: str) -> None:
    """Тестовый коллега в том же арендаторе: нужен для проверки прав доступа."""
    url = settings.database_url.replace("+asyncpg", "").replace("+psycopg2", "")
    conn = psycopg2.connect(url)
    try:
        with conn, conn.cursor() as cur:
            cur.execute("SELECT id FROM users WHERE email = %s", (COLLEAGUE[0],))
            row = cur.fetchone()
            if row is None:
                user_id = str(uuid.uuid4())
                cur.execute(
                    "INSERT INTO users (id, email, hashed_password, name, is_active) "
                    "VALUES (%s, %s, %s, %s, true)",
                    (user_id, COLLEAGUE[0], hash_password(COLLEAGUE[1]), "Тест-Коллега (виды)"),
                )
            else:
                user_id = str(row[0])
            cur.execute(
                "SELECT 1 FROM user_tenants WHERE user_id = %s AND tenant_id = %s",
                (user_id, tenant_id),
            )
            if cur.fetchone() is None:
                cur.execute(
                    "INSERT INTO user_tenants (id, user_id, tenant_id, role, joined_at) "
                    "VALUES (%s, %s, %s, 'planner', now())",
                    (str(uuid.uuid4()), user_id, tenant_id),
                )
    finally:
        conn.close()


def _pick_project(client: TestClient, token: str) -> str:
    response = client.get("/v1/projects", params={"page_size": 1}, headers=_auth(token))
    assert response.status_code == 200, response.text
    data = response.json()
    items = data.get("items") if isinstance(data, dict) else data
    if not items:
        pytest.skip("На стенде нет проектов — тест сохранённых видов пропущен")
    return str(items[0]["id"])


@pytest.fixture(scope="module")
def ctx():
    prefix = f"SV-{uuid.uuid4().hex[:6]}"
    with TestClient(app) as client:
        planner = _login(client, *PLANNER)
        planner_token = planner["access_token"]
        me = client.get("/v1/auth/me", headers=_auth(planner_token)).json()
        tenant_id = str(me["tenant_id"])

        _ensure_colleague(tenant_id)
        colleague_token = _login(client, *COLLEAGUE)["access_token"]

        state = SimpleNamespace(
            client=client,
            prefix=prefix,
            planner=planner_token,
            colleague=colleague_token,
            tenant_id=tenant_id,
            project_id=_pick_project(client, planner_token),
        )
        yield state

        # уборка: удаляем только свои тестовые виды (по уникальному префиксу имени)
        for token in (state.planner, state.colleague):
            listing = client.get("/v1/saved-views", params={"project_id": state.project_id},
                                 headers=_auth(token))
            if listing.status_code != 200:
                continue
            for item in listing.json().get("items", []):
                if item["name"].startswith(prefix) and item["is_own"]:
                    client.delete(f"/v1/saved-views/{item['id']}", params={"confirm": True},
                                  headers=_auth(token))


# ── служебное ─────────────────────────────────────────────────────────────────

def _create(ctx, name: str, content=None, token=None):
    token = token or ctx.planner
    response = ctx.client.post(
        "/v1/saved-views",
        json={"project_id": ctx.project_id, "name": name, "content": content or ENVELOPE},
        headers=_auth(token),
    )
    return response


def _own_views(ctx, token=None):
    token = token or ctx.planner
    listing = ctx.client.get("/v1/saved-views", params={"project_id": ctx.project_id},
                             headers=_auth(token)).json()
    return [i for i in listing["items"] if i["is_own"]]


def _share(ctx, view_id: str, mode: str, token=None):
    return ctx.client.post(f"/v1/saved-views/{view_id}/share", json={"mode": mode},
                           headers=_auth(token or ctx.planner))


# ── 1. создание вида ──────────────────────────────────────────────────────────

def test_create_view(ctx):
    name = f"{ctx.prefix} Вид 1"
    response = _create(ctx, name)
    assert response.status_code == 201, response.text
    item = response.json()["item"]
    assert item["name"] == name
    assert item["is_own"] is True
    assert item["kind"] == "private" and item["status"] == "личный"
    assert item["can_manage"] is True

    listing = ctx.client.get("/v1/saved-views", params={"project_id": ctx.project_id},
                             headers=_auth(ctx.planner)).json()
    assert any(i["id"] == item["id"] for i in listing["items"])
    assert listing["limit"]["value"] >= 1
    assert "cpm" in listing["sections"]

    detail = ctx.client.get(f"/v1/saved-views/{item['id']}",
                            headers=_auth(ctx.planner)).json()
    assert detail["content"]["sections"]["cpm"]["mode"] == "byDate"
    assert detail["content"]["node_positions"]["byDate"]["op-1"] == {"x": 12.5, "y": 30.0}
    assert detail["content"]["schema_version"] == 1
    assert detail["item"]["sections"] == ["cpm", "gantt", "general", "pools"]


# ── 2. упор в лимит ───────────────────────────────────────────────────────────

def test_limit_blocks_over_limit(ctx):
    own_before = len(_own_views(ctx))
    limit = own_before + 2

    saved = ctx.client.put(
        "/v1/planning-settings",
        json={"scope": "project", "scope_id": ctx.project_id,
              "settings": {"views.saved_limit": limit}},
        headers=_auth(ctx.planner),
    )
    assert saved.status_code == 200, saved.text
    try:
        for index in (1, 2):
            response = _create(ctx, f"{ctx.prefix} Лимит {index}")
            assert response.status_code == 201, response.text
            assert response.json()["item"]["is_own"] is True

        over = _create(ctx, f"{ctx.prefix} Лимит 3")
        assert over.status_code == 409, over.text
        detail = over.json()["detail"]
        assert detail["code"] == "view_limit_reached"
        assert detail["limit"] == limit
        assert detail["used"] == limit
        assert detail["source"] == "project"
        assert "лимит" in detail["message"].lower()
        assert "удал" in detail["hint"].lower() or "файл" in detail["hint"].lower()

        # лимит виден в реестре и взят из настроек проекта
        listing = ctx.client.get("/v1/saved-views", params={"project_id": ctx.project_id},
                                 headers=_auth(ctx.planner)).json()
        assert listing["limit"]["value"] == limit
        assert listing["limit"]["source"] == "project"
        assert listing["limit"]["remaining"] == 0
    finally:
        ctx.client.delete("/v1/planning-settings",
                          params={"scope": "project", "scope_id": ctx.project_id},
                          headers=_auth(ctx.planner))

    # после снятия переопределения лимит снова системный (10)
    listing = ctx.client.get("/v1/saved-views", params={"project_id": ctx.project_id},
                             headers=_auth(ctx.planner)).json()
    assert listing["limit"]["value"] == 10
    assert listing["limit"]["source"] == "system"

    # место освободилось — сохранение снова проходит
    again = _create(ctx, f"{ctx.prefix} Лимит 3")
    assert again.status_code == 201, again.text


# ── 3. шаринг: не более одного общего вида на пользователя ───────────────────

def test_share_only_one_shared_view_per_user(ctx):
    first = _create(ctx, f"{ctx.prefix} Общий A").json()["item"]
    second = _create(ctx, f"{ctx.prefix} Общий B").json()["item"]

    shared = _share(ctx, first["id"], "read")
    assert shared.status_code == 200, shared.text
    assert shared.json()["item"]["visibility"] == "shared"
    assert shared.json()["item"]["share_mode"] == "read"
    assert shared.json()["item"]["status"] == "общий — чтение"

    denied = _share(ctx, second["id"], "write")
    assert denied.status_code == 409, denied.text
    detail = denied.json()["detail"]
    assert detail["code"] == "shared_view_limit"
    assert detail["current_shared_view_id"] == first["id"]
    assert "один" in detail["message"].lower()

    # вернуть первый в личные и сделать общим второй
    unshared = ctx.client.post(f"/v1/saved-views/{first['id']}/unshare",
                               headers=_auth(ctx.planner))
    assert unshared.status_code == 200
    assert unshared.json()["item"]["kind"] == "private"
    assert _share(ctx, second["id"], "write").status_code == 200

    listing = ctx.client.get("/v1/saved-views", params={"project_id": ctx.project_id},
                             headers=_auth(ctx.planner)).json()
    assert listing["my_shared_view_id"] == second["id"]

    # коллега видит общий вид, но не видит чужой личный
    colleague_list = ctx.client.get("/v1/saved-views", params={"project_id": ctx.project_id},
                                    headers=_auth(ctx.colleague)).json()
    visible = {i["id"]: i for i in colleague_list["items"]}
    assert second["id"] in visible
    assert visible[second["id"]]["kind"] == "shared"
    assert visible[second["id"]]["is_own"] is False
    assert first["id"] not in visible


# ── 4. доступ на чтение и на изменение ────────────────────────────────────────

def test_access_read_and_write(ctx):
    # общим может быть только один свой вид — снимаем предыдущий, чтобы тест был самостоятельным
    listing = ctx.client.get("/v1/saved-views", params={"project_id": ctx.project_id},
                             headers=_auth(ctx.planner)).json()
    if listing.get("my_shared_view_id"):
        ctx.client.post(f"/v1/saved-views/{listing['my_shared_view_id']}/unshare",
                        headers=_auth(ctx.planner))

    view = _create(ctx, f"{ctx.prefix} Доступ").json()["item"]

    # чужой личный вид не читается и не виден
    assert ctx.client.get(f"/v1/saved-views/{view['id']}",
                          headers=_auth(ctx.colleague)).status_code == 403

    # «чтение»: применяют все, сохраняет только владелец
    assert _share(ctx, view["id"], "read").status_code == 200
    detail = ctx.client.get(f"/v1/saved-views/{view['id']}", headers=_auth(ctx.colleague))
    assert detail.status_code == 200
    assert detail.json()["item"]["can_write"] is False

    denied = ctx.client.put(f"/v1/saved-views/{view['id']}",
                            json={"content": {**ENVELOPE, "sections": {"cpm": {"mode": "byLayer"}}}},
                            headers=_auth(ctx.colleague))
    assert denied.status_code == 403, denied.text
    assert "чтение" in denied.json()["detail"]

    # «изменение»: сохраняют все участники проекта, ведётся журнал
    assert _share(ctx, view["id"], "write").status_code == 200
    changed = ctx.client.put(f"/v1/saved-views/{view['id']}",
                             json={"content": {**ENVELOPE, "sections": {"cpm": {"mode": "byLayer"}}}},
                             headers=_auth(ctx.colleague))
    assert changed.status_code == 200, changed.text
    assert changed.json()["item"]["can_write"] is True
    assert changed.json()["content"]["sections"]["cpm"]["mode"] == "byLayer"

    log = ctx.client.get(f"/v1/saved-views/{view['id']}/log",
                         headers=_auth(ctx.planner)).json()["items"]
    actions = [entry["action"] for entry in log]
    assert "share" in actions and "save" in actions
    save_entry = next(entry for entry in log if entry["action"] == "save")
    assert save_entry["user_name"] == "Тест-Коллега (виды)"
    assert save_entry["payload"]["by_owner"] is False

    # «Сохранить как свой» — ответвляется личная копия
    copied = ctx.client.post(f"/v1/saved-views/{view['id']}/copy", headers=_auth(ctx.colleague))
    assert copied.status_code == 201, copied.text
    assert copied.json()["item"]["is_own"] is True
    assert copied.json()["item"]["kind"] == "private"
    assert copied.json()["item"]["name"].startswith(view["name"])


# ── 5. экспорт, затем импорт ──────────────────────────────────────────────────

def test_export_then_import_same_content(ctx):
    name = f"{ctx.prefix} Экспорт"
    created = _create(ctx, name).json()["item"]

    exported = ctx.client.get("/v1/saved-views/export",
                              params={"project_id": ctx.project_id, "ids": created["id"]},
                              headers=_auth(ctx.planner))
    assert exported.status_code == 200, exported.text
    file = exported.json()
    assert file["kind"] == "saved-views" and file["schema_version"] == 1
    assert file["count"] == 1 and file["views"][0]["name"] == name

    # импорт без переименования — конфликт имён и понятная подсказка
    conflict = ctx.client.post("/v1/saved-views/import",
                               json={"project_id": ctx.project_id, "payload": file},
                               headers=_auth(ctx.planner))
    assert conflict.status_code == 409, conflict.text
    detail = conflict.json()["detail"]
    assert detail["code"] == "view_name_conflict"
    assert detail["conflicts"] == [name]
    assert detail["suggestions"][name] == f"{name} (копия)"

    imported_name = f"{name} (импорт)"
    imported = ctx.client.post(
        "/v1/saved-views/import",
        json={"project_id": ctx.project_id, "payload": file, "renames": {name: imported_name}},
        headers=_auth(ctx.planner),
    )
    assert imported.status_code == 201, imported.text
    new_id = imported.json()["created"][0]["id"]
    assert imported.json()["created"][0]["name"] == imported_name
    assert imported.json()["renamed"] == [{"from": name, "to": imported_name}]

    detail = ctx.client.get(f"/v1/saved-views/{new_id}", headers=_auth(ctx.planner)).json()
    assert detail["content"] == file["views"][0]["content"]
    assert detail["item"]["imported"] is True

    # выгрузка всех доступных видов тоже работает
    all_views = ctx.client.get("/v1/saved-views/export",
                               params={"project_id": ctx.project_id},
                               headers=_auth(ctx.planner))
    assert all_views.status_code == 200
    assert all_views.json()["count"] >= 2


def test_delete_requires_confirmation(ctx):
    view = _create(ctx, f"{ctx.prefix} Удаление").json()["item"]

    refused = ctx.client.delete(f"/v1/saved-views/{view['id']}", headers=_auth(ctx.planner))
    assert refused.status_code == 409
    assert refused.json()["detail"]["code"] == "confirm_required"

    ok = ctx.client.delete(f"/v1/saved-views/{view['id']}", params={"confirm": True},
                           headers=_auth(ctx.planner))
    assert ok.status_code == 200 and ok.json()["ok"] is True
    assert ctx.client.get(f"/v1/saved-views/{view['id']}",
                          headers=_auth(ctx.planner)).status_code == 404
