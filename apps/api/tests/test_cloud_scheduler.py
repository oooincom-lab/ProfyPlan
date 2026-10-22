"""Юнит-тесты интервалов облачного планировщика (без БД)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.services.cloud_scheduler import _is_due, poll_interval_seconds


def test_poll_interval_clamped():
    assert poll_interval_seconds(SimpleNamespace(settings={"cloud": {"poll_minutes": 15}})) == 900
    assert poll_interval_seconds(SimpleNamespace(settings={"cloud": {"poll_minutes": 0}})) == 60
    assert poll_interval_seconds(SimpleNamespace(settings={"cloud": {"poll_minutes": 999}})) == 3600
    assert poll_interval_seconds(SimpleNamespace(settings={})) == 300


def test_is_due_handles_empty_and_recent():
    assert _is_due(None, 300) is True
    recent = datetime.now(timezone.utc) - timedelta(seconds=10)
    assert _is_due(recent, 300) is False
    old = datetime.now(timezone.utc) - timedelta(seconds=301)
    assert _is_due(old, 300) is True


def test_is_due_handles_naive_datetime():
    naive_old = datetime.utcnow() - timedelta(minutes=10)
    assert _is_due(naive_old, 300) is True
