"""Тесты OAuth-хелперов облака без внешних запросов."""
from __future__ import annotations

from app.core.config import settings
from app.services.cloud_oauth import (
    authorization_url,
    decode_state,
    decrypt_secret,
    encrypt_secret,
    make_state,
)


def test_state_roundtrip():
    state = make_state("11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222", "yandex")
    data = decode_state(state)
    assert data["provider"] == "yandex"
    assert data["connection_id"].startswith("11111111")


def test_token_encryption_roundtrip():
    secret = "refresh-token-value"
    encrypted = encrypt_secret(secret)
    assert encrypted != secret
    assert decrypt_secret(encrypted) == secret


def test_authorization_url_contains_offline_google(monkeypatch):
    monkeypatch.setattr(settings, "google_oauth_client_id", "client")
    monkeypatch.setattr(settings, "google_oauth_client_secret", "secret")
    monkeypatch.setattr(settings, "cloud_oauth_callback_url", "https://example.test/callback")
    url = authorization_url(
        "11111111-1111-1111-1111-111111111111",
        "22222222-2222-2222-2222-222222222222",
        "google",
    )
    assert url.startswith("https://accounts.google.com/o/oauth2/v2/auth?")
    assert "access_type=offline" in url
    assert "prompt=consent" in url
    assert "/auth/drive" in url
