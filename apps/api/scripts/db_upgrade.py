"""Приведение схемы базы к нужному состоянию перед запуском приложения.

Разбирает три случая — их нельзя смешивать, иначе выкладка ломается:

1. **Пустая база** (новая установка) — выполняет миграции целиком: базовая
   ревизия `0000_baseline` создаёт схему из моделей.
2. **База, собранная прежней цепочкой** (в `alembic_version` отмечена ревизия,
   которой в коде больше нет) — только отмечает базовую ревизию. Схема в такой
   базе уже готова, менять её нельзя, поэтому ничего не выполняется.
3. **База, отмеченная текущей цепочкой** — обычное обновление до последней
   ревизии.

Так выкладка одинаково безопасна и для нового сервера, и для действующей базы.

Запуск: `python -m scripts.db_upgrade`
"""
from __future__ import annotations

import subprocess
from pathlib import Path

from sqlalchemy import create_engine, text

from app.core.config import settings

BASELINE = "0000_baseline"
API_ROOT = Path(__file__).resolve().parent.parent


def _sync_url() -> str:
    """Тот же адрес базы, но синхронным драйвером."""
    return settings.database_url.replace("+asyncpg", "+psycopg2")


def _stamped_revisions() -> list[str]:
    """Ревизии, отмеченные в базе (пусто, если таблицы отметок ещё нет)."""
    engine = create_engine(_sync_url())
    try:
        with engine.connect() as conn:
            exists = conn.execute(
                text(
                    "select 1 from information_schema.tables "
                    "where table_schema = 'public' and table_name = 'alembic_version'"
                )
            ).first()
            if not exists:
                return []
            return [row[0] for row in conn.execute(text("select version_num from alembic_version"))]
    finally:
        engine.dispose()


def _known_revisions() -> set[str]:
    """Ревизии, которые есть в коде (в цепочке)."""
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    script = ScriptDirectory.from_config(Config(str(API_ROOT / "alembic.ini")))
    return {rev.revision for rev in script.walk_revisions()}


def _alembic(*args: str) -> int:
    print(f"[db] alembic {' '.join(args)}", flush=True)
    return subprocess.call(["alembic", *args], cwd=str(API_ROOT))


def _stamp_baseline() -> int:
    """Отмечает базовую ревизию напрямую в таблице отметок.

    Через alembic это сделать нельзя: он пытается разобрать уже записанную в
    базе ревизию, не находит её (она осталась в старой цепочке) и падает до
    выполнения команды. Поэтому меняем только строку отметки — данные и схема
    не затрагиваются.
    """
    engine = create_engine(_sync_url())
    try:
        with engine.begin() as conn:
            conn.execute(text("delete from alembic_version"))
            conn.execute(
                text("insert into alembic_version (version_num) values (:rev)"),
                {"rev": BASELINE},
            )
    finally:
        engine.dispose()
    print(f"[db] Отмечена базовая ревизия {BASELINE}: схема считается готовой.", flush=True)
    return 0


def main() -> int:
    stamped = _stamped_revisions()
    known = _known_revisions()

    if not stamped:
        print("[db] База пустая — создаём схему целиком.", flush=True)
        return _alembic("upgrade", "head")

    unknown = sorted(r for r in stamped if r not in known)
    if unknown:
        print(
            "[db] В базе отмечена прежняя цепочка ревизий: "
            f"{', '.join(unknown)}. Схема считается готовой — отмечаем базовую ревизию, "
            "не меняя данные.",
            flush=True,
        )
        return _stamp_baseline()

    print("[db] База отмечена текущей цепочкой — обычное обновление.", flush=True)
    return _alembic("upgrade", "head")


if __name__ == "__main__":
    raise SystemExit(main())
