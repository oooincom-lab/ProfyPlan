"""Периодический опрос облачных подключений.

Планировщик работает внутри API-процесса. Несколько uvicorn-воркеров
запускают свои циклы, но advisory-lock PostgreSQL пропускает опрос только
одному из них. Одно подключение опрашивается не чаще, чем задано в
``settings.cloud.poll_minutes`` (1–60 минут).
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import func, select, text

from app.core.config import settings
from app.core.database import async_session
from app.models.integration import ExchangeLogEntry, IntegrationConnection
from app.services.cloud_exchange import CloudError, cloud_settings, poll_cloud

logger = logging.getLogger(__name__)

# Стабильный ключ advisory-lock; не пересекается с lease-блокировками.
_SCHEDULER_LOCK_KEY = 731_204_117
_DEFAULT_INTERVAL_MINUTES = 5


def poll_interval_seconds(conn: IntegrationConnection) -> int:
    """Интервал опроса подключения с ограничением 1–60 минут."""
    cfg = cloud_settings(conn)
    try:
        raw = cfg.get("poll_minutes")
        minutes = int(raw) if raw is not None else _DEFAULT_INTERVAL_MINUTES
    except (TypeError, ValueError):
        minutes = _DEFAULT_INTERVAL_MINUTES
    minutes = max(1, min(60, minutes))
    return minutes * 60


async def _last_poll_at(db, connection_id) -> Optional[datetime]:
    value = await db.scalar(
        select(func.max(ExchangeLogEntry.created_at)).where(
            ExchangeLogEntry.connection_id == connection_id,
            ExchangeLogEntry.kind == "cloud_poll",
        )
    )
    return value


def _is_due(last: Optional[datetime], interval_seconds: int) -> bool:
    if last is None:
        return True
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - last).total_seconds() >= interval_seconds


async def _try_lock(db) -> bool:
    """Захватить межпроцессный lock; вне PostgreSQL считаем, что можно."""
    if not settings.database_url.startswith("postgresql"):
        return True
    try:
        return bool(await db.scalar(
            text("SELECT pg_try_advisory_lock(:key)"),
            {"key": _SCHEDULER_LOCK_KEY},
        ))
    except Exception:
        logger.exception("cloud scheduler: advisory lock failed")
        return False


async def _unlock(db) -> None:
    if not settings.database_url.startswith("postgresql"):
        return
    try:
        await db.execute(
            text("SELECT pg_advisory_unlock(:key)"),
            {"key": _SCHEDULER_LOCK_KEY},
        )
        await db.commit()
    except Exception:
        logger.exception("cloud scheduler: advisory unlock failed")


async def poll_due_connections() -> dict:
    """Один проход: опросить все облачные подключения, которым пора."""
    result = {"checked": 0, "polled": 0, "skipped": 0, "errors": 0, "locked": False}
    async with async_session() as db:
        if not await _try_lock(db):
            result["locked"] = True
            return result
        try:
            conns = (await db.scalars(
                select(IntegrationConnection).where(
                    IntegrationConnection.transport == "cloud",
                    IntegrationConnection.is_active.is_(True),
                )
            )).all()
            result["checked"] = len(conns)
            for conn in conns:
                conn_id = conn.id
                tenant_id = conn.tenant_id
                last = await _last_poll_at(db, conn_id)
                if not _is_due(last, poll_interval_seconds(conn)):
                    result["skipped"] += 1
                    continue
                try:
                    await poll_cloud(db, conn, tenant_id)
                    await db.commit()
                    result["polled"] += 1
                except CloudError as exc:
                    result["errors"] += 1
                    await db.rollback()
                    db.add(ExchangeLogEntry(
                        tenant_id=tenant_id,
                        connection_id=conn_id,
                        direction="in",
                        kind="cloud_poll",
                        status="error",
                        entities_count=0,
                        message=("scheduler: " + str(exc))[:500],
                    ))
                    await db.commit()
                except Exception:
                    result["errors"] += 1
                    logger.exception("cloud scheduler: poll failed for %s", conn_id)
                    await db.rollback()
                    db.add(ExchangeLogEntry(
                        tenant_id=tenant_id,
                        connection_id=conn_id,
                        direction="in",
                        kind="cloud_poll",
                        status="error",
                        entities_count=0,
                        message="scheduler: внутренняя ошибка опроса",
                    ))
                    await db.commit()
        finally:
            await _unlock(db)
    return result


async def run_scheduler() -> None:
    """Бесконечный цикл планировщика; отменяется при остановке API."""
    if not settings.cloud_scheduler_enabled:
        logger.info("cloud scheduler disabled")
        return
    # Не стартуем одновременно с миграциями и первым прогреванием API.
    await asyncio.sleep(5)
    tick = max(10, int(settings.cloud_scheduler_interval_seconds or 60))
    while True:
        try:
            outcome = await poll_due_connections()
            if outcome.get("polled") or outcome.get("errors"):
                logger.info("cloud scheduler: %s", outcome)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("cloud scheduler tick failed")
        await asyncio.sleep(tick)
