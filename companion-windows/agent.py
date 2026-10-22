#!/usr/bin/env python3
"""ProfyPlan Companion (Windows MVP).

Файловый обмен без браузера: выбирает папку, забирает входящие пакеты,
отправляет их в ProfyPlan, скачивает исходящие и подтверждает доставку.
"""
from __future__ import annotations

import argparse
import base64
import ctypes
import getpass
import json
import logging
import os
import shutil
import socket
import sys
import time
import uuid
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path
from urllib import error, request
from urllib.parse import quote

APP = "ProfyPlan Companion"
VERSION = "0.1.0"
DEFAULT_API = "https://profyplan.ru/api/v1"
DEFAULT_ROOT = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "ProfyPlanExchange"
DEFAULT_CONFIG = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "ProfyPlan" / "companion.json"
AGENT_ID = "windows-companion"
LEASE_TTL = 120


# ─── Windows DPAPI ───────────────────────────────────────────────────────────

class _DataBlob(ctypes.Structure):
    _fields_ = [("cbData", ctypes.c_uint32), ("pbData", ctypes.POINTER(ctypes.c_char))]


def _blob(data: bytes) -> "_DataBlob":
    buf = ctypes.create_string_buffer(data, len(data))
    return _DataBlob(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)))


def _dpapi(data: bytes, protect: bool) -> bytes:
    if os.name != "nt":
        prefix = b"plain:" if protect else b"plain:"
        if protect:
            return prefix + base64.b64encode(data)
        if data.startswith(prefix):
            return base64.b64decode(data[len(prefix):])
        return data
    in_blob = _blob(data)
    out_blob = _DataBlob()
    fn = ctypes.windll.crypt32.CryptProtectData if protect else ctypes.windll.crypt32.CryptUnprotectData
    ok = fn(ctypes.byref(in_blob), None, None, None, None, 0, ctypes.byref(out_blob))
    if not ok:
        raise OSError("DPAPI: не удалось %s данные" % ("зашифровать" if protect else "расшифровать"))
    try:
        return ctypes.string_at(out_blob.pbData, out_blob.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(out_blob.pbData)


def seal_password(password: str) -> str:
    return "dpapi:" + base64.b64encode(_dpapi(password.encode("utf-8"), True)).decode("ascii")


def open_password(value: str) -> str:
    if not value:
        return ""
    if value.startswith("dpapi:"):
        return _dpapi(base64.b64decode(value[6:]), False).decode("utf-8")
    if value.startswith("plain:"):
        return base64.b64decode(value[6:]).decode("utf-8")
    return value


# ─── API ─────────────────────────────────────────────────────────────────────

class ApiError(Exception):
    def __init__(self, status: int, message: str, body: str = ""):
        super().__init__(message)
        self.status = status
        self.body = body


class LeaseBusy(Exception):
    def __init__(self, holder: dict | None):
        super().__init__("обмен уже идёт на другом компьютере")
        self.holder = holder or {}


class Api:
    def __init__(self, base: str, token: str | None = None):
        self.base = base.rstrip("/")
        self.token = token

    def _headers(self, content_type: str | None = None) -> dict:
        h = {"Accept": "application/json"}
        if content_type:
            h["Content-Type"] = content_type
        if self.token:
            h["Authorization"] = "Bearer " + self.token
        return h

    def _request(self, method: str, path: str, body: bytes | None = None, content_type: str | None = None, raw: bool = False):
        req = request.Request(self.base + path, data=body, headers=self._headers(content_type), method=method)
        try:
            with request.urlopen(req, timeout=60) as resp:
                data = resp.read()
                if raw:
                    return data
                return json.loads(data.decode("utf-8")) if data else None
        except error.HTTPError as e:
            raw_body = e.read().decode("utf-8", "replace")
            message = raw_body
            try:
                parsed = json.loads(raw_body)
                detail = parsed.get("detail")
                if isinstance(detail, dict):
                    message = detail.get("message") or json.dumps(detail, ensure_ascii=False)
                elif detail:
                    message = str(detail)
            except Exception:
                pass
            raise ApiError(e.code, message[:500], raw_body)
        except error.URLError as e:
            raise ApiError(0, "нет соединения: %s" % e.reason)

    def login(self, email: str, password: str) -> str:
        data = json.dumps({"email": email, "password": password}).encode("utf-8")
        res = self._request("POST", "/auth/login", data, "application/json")
        self.token = res["access_token"]
        return self.token

    def connections(self) -> list:
        res = self._request("GET", "/integration/connections")
        return res.get("items", res) if isinstance(res, dict) else (res or [])

    def acquire(self, connection_id: str, instance_id: str, session_id: str) -> str:
        body = json.dumps({
            "agent_id": AGENT_ID,
            "instance_id": instance_id,
            "session_id": session_id,
            "ttl_seconds": LEASE_TTL,
        }).encode("utf-8")
        try:
            res = self._request("POST", "/integration/connections/%s/lease" % connection_id, body, "application/json")
            return res["lease_token"]
        except ApiError as e:
            if e.status == 409:
                holder = None
                try:
                    holder = json.loads(e.body).get("detail", {}).get("holder")
                except Exception:
                    pass
                raise LeaseBusy(holder)
            raise

    def release(self, connection_id: str, lease_token: str) -> None:
        body = json.dumps({"lease_token": lease_token}).encode("utf-8")
        try:
            self._request("DELETE", "/integration/connections/%s/lease" % connection_id, body, "application/json")
        except ApiError:
            pass

    def import_file(self, connection_id: str, path: Path) -> dict:
        boundary = "----ProfyPlan" + uuid.uuid4().hex
        filename = path.name.replace('"', "_")
        head = (
            "--%s\r\nContent-Disposition: form-data; name=\"file\"; filename=\"%s\"\r\n"
            "Content-Type: application/json\r\n\r\n" % (boundary, filename)
        ).encode("utf-8")
        tail = ("\r\n--%s--\r\n" % boundary).encode("utf-8")
        data = head + path.read_bytes() + tail
        return self._request(
            "POST",
            "/integration/connections/%s/import-file" % connection_id,
            data,
            "multipart/form-data; boundary=%s" % boundary,
        )

    def outbox(self, connection_id: str) -> list:
        res = self._request("GET", "/integration/connections/%s/outbox" % connection_id)
        return (res or {}).get("items", [])

    def download(self, connection_id: str, name: str) -> bytes:
        return self._request(
            "GET",
            "/integration/connections/%s/files/%s" % (connection_id, quote(name, safe="")),
            raw=True,
        )

    def ack(self, connection_id: str, name: str) -> None:
        self._request(
            "POST",
            "/integration/connections/%s/outbox/%s/ack" % (connection_id, quote(name, safe="")),
            b"{}",
            "application/json",
        )


# ─── config/state ────────────────────────────────────────────────────────────

def load_config(path: Path) -> dict:
    if not path.exists():
        raise SystemExit("Конфиг не найден: %s\nСначала выполните: python agent.py init" % path)
    data = json.loads(path.read_text(encoding="utf-8"))
    if not data.get("api_base") or not data.get("connection_id") or not data.get("root_dir"):
        raise SystemExit("В конфиге не хватает api_base / connection_id / root_dir")
    return data


def save_config(path: Path, cfg: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)
    try:
        os.chmod(path, 0o600)
    except Exception:
        pass


def setup_logging(cfg: dict | None, verbose: bool) -> logging.Logger:
    logger = logging.getLogger("profyplan-companion")
    logger.setLevel(logging.DEBUG)
    logger.handlers.clear()
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s", "%Y-%m-%d %H:%M:%S")
    if cfg:
        log_dir = Path(cfg.get("log_dir") or cfg.get("root_dir") or ".")
        log_dir.mkdir(parents=True, exist_ok=True)
        handler = RotatingFileHandler(log_dir / "companion.log", maxBytes=2_000_000, backupCount=3, encoding="utf-8")
        handler.setFormatter(fmt)
        logger.addHandler(handler)
    if verbose or cfg is None:
        console = logging.StreamHandler()
        console.setFormatter(fmt)
        logger.addHandler(console)
    return logger


def paths(cfg: dict) -> tuple[Path, Path, Path]:
    root = Path(cfg["root_dir"])
    return (
        Path(cfg.get("in_dir") or root / "in"),
        Path(cfg.get("out_dir") or root / "out"),
        Path(cfg.get("processed_dir") or root / "processed"),
    )


def ensure_dirs(cfg: dict) -> None:
    for p in paths(cfg):
        p.mkdir(parents=True, exist_ok=True)


def load_state(cfg: dict) -> dict:
    p = Path(cfg["root_dir"]) / "state.json"
    if not p.exists():
        return {"processed": {}}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {"processed": {}}


def save_state(cfg: dict, state: dict) -> None:
    p = Path(cfg["root_dir"]) / "state.json"
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, p)


def move_processed(src: Path, processed: Path) -> Path:
    target = processed / src.name
    if target.exists():
        target = processed / ("%s-%s" % (datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S"), src.name))
    shutil.move(str(src), str(target))
    return target


def file_key(path: Path) -> str:
    st = path.stat()
    return "%s|%s|%s" % (path.name, st.st_size, st.st_mtime_ns)


# ─── sync ────────────────────────────────────────────────────────────────────

def sync_once(cfg: dict, logger: logging.Logger) -> int:
    ensure_dirs(cfg)
    api = Api(cfg["api_base"])
    try:
        api.login(cfg["email"], open_password(cfg.get("password_enc", "")))
    except ApiError as e:
        logger.error("вход не выполнен: HTTP %s %s", e.status, e)
        return 3

    instance_id = cfg.get("instance_id") or str(uuid.uuid4())
    cfg["instance_id"] = instance_id
    session_id = "%s:%s" % (socket.gethostname(), os.getpid())
    try:
        lease = api.acquire(cfg["connection_id"], instance_id, session_id)
    except LeaseBusy as e:
        holder = e.holder or {}
        logger.warning("обмен занят: %s / %s", holder.get("agent_id"), holder.get("instance_id"))
        return 2
    except ApiError as e:
        logger.error("lease не получен: HTTP %s %s", e.status, e)
        return 3

    in_dir, out_dir, processed = paths(cfg)
    state = load_state(cfg)
    processed_keys = state.setdefault("processed", {})
    counts = {"in": 0, "out": 0}
    errors = 0
    try:
        for path in sorted(in_dir.glob("*.json"), key=lambda p: (p.stat().st_mtime, p.name)):
            key = file_key(path)
            if key in processed_keys:
                try:
                    move_processed(path, processed)
                    logger.info("повтор пропущен, перенесён: %s", path.name)
                except Exception as e:
                    logger.error("не удалось перенести повтор %s: %s", path.name, e)
                    errors += 1
                continue
            try:
                api.import_file(cfg["connection_id"], path)
                processed_keys[key] = datetime.now(timezone.utc).isoformat()
                save_state(cfg, state)
                move_processed(path, processed)
                counts["in"] += 1
                logger.info("входящий отправлен: %s", path.name)
            except Exception as e:
                errors += 1
                logger.error("ошибка отправки %s: %s", path.name, e)

        try:
            items = api.outbox(cfg["connection_id"])
            for item in items:
                name = os.path.basename(str(item.get("name") or ""))
                if not name or not name.lower().endswith(".json") or name in (".", ".."):
                    continue
                try:
                    data = api.download(cfg["connection_id"], name)
                    target = out_dir / name
                    tmp = out_dir / (name + ".part")
                    tmp.write_bytes(data)
                    os.replace(tmp, target)
                    api.ack(cfg["connection_id"], name)
                    counts["out"] += 1
                    logger.info("исходящий получен: %s", name)
                except Exception as e:
                    errors += 1
                    logger.error("ошибка исходящего %s: %s", name, e)
        except Exception as e:
            errors += 1
            logger.error("не удалось получить outbox: %s", e)

        if len(processed_keys) > 1000:
            for k in sorted(processed_keys, key=lambda x: processed_keys[x])[:len(processed_keys) - 1000]:
                processed_keys.pop(k, None)
            save_state(cfg, state)
        logger.info("итог: входящих %s, исходящих %s, ошибок %s", counts["in"], counts["out"], errors)
        return 0 if errors == 0 else 1
    finally:
        api.release(cfg["connection_id"], lease)


def cmd_init(args: argparse.Namespace) -> int:
    print("%s %s" % (APP, VERSION))
    api_base = args.api_base or input("API ProfyPlan [%s]: " % DEFAULT_API).strip() or DEFAULT_API
    email = args.email or input("Email: ").strip()
    password = getpass.getpass("Пароль: ")
    if not email or not password:
        print("Email и пароль обязательны", file=sys.stderr)
        return 2
    api = Api(api_base)
    try:
        api.login(email, password)
        items = api.connections()
    except ApiError as e:
        print("Не удалось войти: HTTP %s %s" % (e.status, e), file=sys.stderr)
        return 3
    if not items:
        print("В ProfyPlan нет подключений — создайте подключение в разделе «Интеграция».", file=sys.stderr)
        return 2
    print("Подключения:")
    for i, c in enumerate(items, 1):
        print("  %d) %s — %s" % (i, c.get("name"), c.get("transport")))
    cid = args.connection_id
    if not cid:
        raw = input("Номер подключения [1]: ").strip() or "1"
        try:
            cid = items[int(raw) - 1]["id"]
        except Exception:
            print("Некорректный номер", file=sys.stderr)
            return 2
    selected = next((c for c in items if c["id"] == cid), None)
    if not selected:
        print("Подключение не найдено", file=sys.stderr)
        return 2
    root = Path(args.root or input("Папка обмена [%s]: " % DEFAULT_ROOT).strip() or str(DEFAULT_ROOT))
    root.mkdir(parents=True, exist_ok=True)
    cfg = {
        "version": 1,
        "api_base": api_base,
        "email": email,
        "password_enc": seal_password(password),
        "connection_id": cid,
        "connection_name": selected.get("name"),
        "root_dir": str(root),
        "in_dir": str(root / "in"),
        "out_dir": str(root / "out"),
        "processed_dir": str(root / "processed"),
        "interval_seconds": int(args.interval or 300),
        "agent_id": AGENT_ID,
        "instance_id": str(uuid.uuid4()),
    }
    save_config(Path(args.config), cfg)
    ensure_dirs(cfg)
    print("Конфиг сохранён: %s" % args.config)
    print("Папка обмена: %s" % root)
    print("Проверка: python agent.py once --config \"%s\"" % args.config)
    return 0


def cmd_once(args: argparse.Namespace) -> int:
    cfg = load_config(Path(args.config))
    logger = setup_logging(cfg, True)
    return sync_once(cfg, logger)


def cmd_run(args: argparse.Namespace) -> int:
    cfg = load_config(Path(args.config))
    logger = setup_logging(cfg, False)
    interval = int(args.interval or cfg.get("interval_seconds") or 300)
    logger.info("companion запущен, интервал %s c, папка %s", interval, cfg["root_dir"])
    while True:
        try:
            sync_once(cfg, logger)
        except KeyboardInterrupt:
            logger.info("остановлен пользователем")
            return 0
        except Exception:
            logger.exception("необработанная ошибка цикла")
        time.sleep(max(30, interval))


def cmd_status(args: argparse.Namespace) -> int:
    cfg = load_config(Path(args.config))
    ensure_dirs(cfg)
    p_in, p_out, p_proc = paths(cfg)
    print("%s %s" % (APP, VERSION))
    print("API: %s" % cfg["api_base"])
    print("Подключение: %s (%s)" % (cfg.get("connection_name"), cfg["connection_id"]))
    print("Email: %s" % cfg.get("email"))
    print("Папка: %s" % cfg["root_dir"])
    print("  in: %s" % p_in)
    print("  out: %s" % p_out)
    print("  processed: %s" % p_proc)
    print("Интервал: %s c" % cfg.get("interval_seconds", 300))
    print("Файлов в in: %d" % len(list(p_in.glob("*.json"))))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="ProfyPlanCompanion", description="ProfyPlan Companion (Windows MVP)")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_init = sub.add_parser("init", help="создать конфиг и привязать подключение")
    p_init.add_argument("--config", default=str(DEFAULT_CONFIG))
    p_init.add_argument("--api-base", default=None)
    p_init.add_argument("--email", default=None)
    p_init.add_argument("--connection-id", default=None)
    p_init.add_argument("--root", default=None)
    p_init.add_argument("--interval", type=int, default=300)
    p_init.set_defaults(func=cmd_init)

    p_once = sub.add_parser("once", help="один цикл обмена")
    p_once.add_argument("--config", default=str(DEFAULT_CONFIG))
    p_once.set_defaults(func=cmd_once)

    p_run = sub.add_parser("run", help="цикл обмена")
    p_run.add_argument("--config", default=str(DEFAULT_CONFIG))
    p_run.add_argument("--interval", type=int, default=None)
    p_run.set_defaults(func=cmd_run)

    p_status = sub.add_parser("status", help="показать настройки")
    p_status.add_argument("--config", default=str(DEFAULT_CONFIG))
    p_status.set_defaults(func=cmd_status)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
