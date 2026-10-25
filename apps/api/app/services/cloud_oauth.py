"""OAuth-подключение облачных провайдеров ProfyPlan.

Пользователь нажимает «Подключить», подтверждает доступ у провайдера, а
ProfyPlan обменивает authorization code на access/refresh token. Refresh
token хранится в настройках подключения только в зашифрованном виде.
"""
from __future__ import annotations

import base64
import hashlib
import os
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import urlencode

import httpx
from cryptography.fernet import Fernet, InvalidToken
from jose import JWTError, jwt

from app.core.config import settings
from app.core.security import ALGORITHM, SECRET_KEY

YANDEX_AUTHORIZE = "https://oauth.yandex.ru/authorize"
YANDEX_TOKEN = "https://oauth.yandex.ru/token"
GOOGLE_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"


class OAuthError(RuntimeError):
    """Ошибка OAuth-подключения."""


def _credentials(provider: str, conn=None) -> tuple[str, str, str]:
    """OAuth-приложение: сначала настройки подключения, затем серверный env.

    Клиентские реквизиты можно задать в карточке подключения (они шифруются
    при сохранении). Это позволяет подключить облако без правки .env.
    """
    app = {}
    if conn is not None:
        app = (((conn.settings or {}).get("cloud") or {}).get("oauth_app") or {})
    app_client_id = str(app.get("client_id") or "").strip()
    app_secret_enc = str(app.get("client_secret_enc") or "").strip()
    if app_client_id and app_secret_enc:
        try:
            app_secret = decrypt_secret(app_secret_enc)
        except OAuthError:
            raise
        except Exception as exc:
            raise OAuthError("Не удалось расшифровать секрет OAuth-приложения") from exc
        if provider == "yandex":
            app_scope = settings.yandex_oauth_scope
        elif provider == "google":
            app_scope = settings.google_oauth_scope
        else:
            raise OAuthError("Неизвестный облачный провайдер: %s" % provider)
        return (app_client_id, app_secret, app_scope)
    if provider == "yandex":
        return (
            settings.yandex_oauth_client_id,
            settings.yandex_oauth_client_secret,
            settings.yandex_oauth_scope,
        )
    if provider == "google":
        return (
            settings.google_oauth_client_id,
            settings.google_oauth_client_secret,
            settings.google_oauth_scope,
        )
    raise OAuthError("Неизвестный облачный провайдер: %s" % provider)


def oauth_configured(provider: str, conn=None) -> bool:
    try:
        client_id, client_secret, _ = _credentials(provider, conn)
    except OAuthError:
        return False
    return bool(client_id and client_secret)


def _callback_url() -> str:
    url = str(settings.cloud_oauth_callback_url or "").strip()
    if not url:
        raise OAuthError("Не задан CLOUD_OAUTH_CALLBACK_URL")
    return url


def make_state(connection_id: str, tenant_id: str, provider: str) -> str:
    payload = {
        "purpose": "cloud_oauth",
        "connection_id": str(connection_id),
        "tenant_id": str(tenant_id),
        "provider": provider,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=15),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_state(state: str) -> dict:
    try:
        payload = jwt.decode(state, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError as exc:
        raise OAuthError("Ссылка авторизации истекла или повреждена") from exc
    if payload.get("purpose") != "cloud_oauth":
        raise OAuthError("Неверный тип OAuth-состояния")
    if not payload.get("connection_id") or payload.get("provider") not in ("yandex", "google"):
        raise OAuthError("В OAuth-состоянии нет подключения или провайдера")
    return payload


def authorization_url(connection_id: str, tenant_id: str, provider: str, conn=None) -> str:
    client_id, _, scope = _credentials(provider, conn)
    if not client_id:
        raise OAuthError("OAuth-приложение ProfyPlan для %s не настроено" % provider)
    state = make_state(connection_id, tenant_id, provider)
    callback = _callback_url()
    if provider == "yandex":
        params = {
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": callback,
            "scope": scope,
            "state": state,
            "force_confirm": "yes",
        }
        return YANDEX_AUTHORIZE + "?" + urlencode(params)
    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": callback,
        "scope": scope,
        "state": state,
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
    }
    return GOOGLE_AUTHORIZE + "?" + urlencode(params)


async def _token_request(url: str, data: dict) -> dict:
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(url, data=data, headers={"Accept": "application/json"})
    try:
        payload = response.json()
    except Exception:
        payload = {}
    if response.status_code >= 400 or payload.get("error"):
        message = payload.get("error_description") or payload.get("error") or response.text[:300]
        raise OAuthError("Провайдер отклонил авторизацию: %s" % message)
    if not payload.get("access_token"):
        raise OAuthError("Провайдер не вернул access_token")
    return payload


async def exchange_code(provider: str, code: str, conn=None) -> dict:
    client_id, client_secret, _ = _credentials(provider, conn)
    if not client_id or not client_secret:
        raise OAuthError("OAuth-приложение ProfyPlan для %s не настроено" % provider)
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": _callback_url(),
    }
    return await _token_request(YANDEX_TOKEN if provider == "yandex" else GOOGLE_TOKEN, data)


async def refresh_tokens(provider: str, refresh_token: str, conn=None) -> dict:
    client_id, client_secret, _ = _credentials(provider, conn)
    if not client_id or not client_secret:
        raise OAuthError("OAuth-приложение ProfyPlan для %s не настроено" % provider)
    data = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": client_id,
        "client_secret": client_secret,
    }
    return await _token_request(YANDEX_TOKEN if provider == "yandex" else GOOGLE_TOKEN, data)


def _fernet() -> Fernet:
    raw = settings.cloud_token_encryption_key or settings.jwt_secret_key
    if not raw:
        raise OAuthError("Не задан ключ шифрования облачных токенов")
    key = base64.urlsafe_b64encode(hashlib.sha256(raw.encode("utf-8")).digest())
    return Fernet(key)


def encrypt_secret(value: str) -> str:
    return _fernet().encrypt(value.encode("utf-8")).decode("ascii")


def decrypt_secret(value: str) -> str:
    try:
        return _fernet().decrypt(value.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError) as exc:
        raise OAuthError("Не удалось расшифровать сохранённый токен облака") from exc


def save_oauth_tokens(conn, provider: str, payload: dict, account: str = "") -> None:
    refresh_token = payload.get("refresh_token")
    if not refresh_token:
        raise OAuthError("Провайдер не вернул refresh_token; повторите подключение")
    current = dict(conn.settings or {})
    cloud = dict(current.get("cloud") or {})
    oauth = dict(cloud.get("oauth") or {})
    oauth.update({
        "provider": provider,
        "refresh_token_enc": encrypt_secret(str(refresh_token)),
        "connected_at": datetime.now(timezone.utc).isoformat(),
    })
    if account:
        oauth["account"] = account
    cloud["oauth"] = oauth
    oauth_by_provider = dict(cloud.get("oauth_by_provider") or {})
    oauth_by_provider[provider] = oauth
    cloud["oauth_by_provider"] = oauth_by_provider
    current["cloud"] = cloud
    conn.settings = current


def oauth_for(conn, provider: str) -> dict:
    """Настройки OAuth конкретного провайдера (с миграцией старого cloud.oauth)."""
    cloud = (conn.settings or {}).get("cloud") or {}
    mapping = cloud.get("oauth_by_provider") or {}
    if isinstance(mapping, dict) and mapping.get(provider):
        return mapping[provider]
    current = cloud.get("oauth") or {}
    if current.get("provider") == provider:
        return current
    return {}


def oauth_refresh_token(conn, provider: str) -> Optional[str]:
    oauth = oauth_for(conn, provider)
    if not oauth.get("refresh_token_enc"):
        return None
    return decrypt_secret(str(oauth["refresh_token_enc"]))


def oauth_account(conn, provider: str) -> str:
    return str(oauth_for(conn, provider).get("account") or "")


async def access_token_for(conn, provider: str, db=None) -> str:
    """Получить access token; при наличии refresh token обновить его."""
    refresh_token = oauth_refresh_token(conn, provider)
    if refresh_token:
        payload = await refresh_tokens(provider, refresh_token, conn)
        # Yandex может ротировать refresh token; Google обычно сохраняет старый.
        if payload.get("refresh_token"):
            save_oauth_tokens(conn, provider, payload, oauth_account(conn, provider))
        if db is not None:
            await db.commit()
        return str(payload["access_token"])

    env_token = ""
    if provider == "yandex":
        env_token = os.environ.get("YANDEX_DISK_TOKEN") or settings.yandex_disk_token
    elif provider == "google":
        env_token = os.environ.get("GOOGLE_DRIVE_ACCESS_TOKEN") or settings.google_drive_access_token
    if env_token:
        return env_token
    raise OAuthError(
        "Облако не подключено. Нажмите «Подключить» и подтвердите доступ %s" %
        ("Яндекс Диска" if provider == "yandex" else "Google Drive")
    )
