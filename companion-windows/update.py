"""Проверка и загрузка обновлений ProfyPlan Companion."""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import urljoin
from urllib.request import urlopen


def parse_version(value: str) -> tuple:
    parts = []
    for piece in str(value or "").strip().split("."):
        try:
            parts.append(int(piece))
        except ValueError:
            parts.append(0)
    return tuple(parts + [0, 0, 0])[:3]


def update_url(api_base: str) -> str:
    base = (api_base or "").rstrip("/")
    if base.endswith("/api/v1"):
        return base[:-7] + "/companion/version.json"
    if base.startswith("http://localhost:8000") or base.startswith("http://127.0.0.1:8000"):
        return "http://localhost:3000/companion/version.json"
    return base + "/companion/version.json"


def check_result(api_base: str, timeout: int = 10) -> tuple:
    """Вернуть (info|None, error|None). None,None — обновлений нет."""
    url = update_url(api_base)
    try:
        with urlopen(url, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        return None, str(exc)
    latest = str(data.get("version") or "")
    if not latest:
        return None, "В version.json не указана версия"
    if parse_version(latest) <= parse_version(_current()):
        return None, None
    data["_base_url"] = url
    return data, None


def check(api_base: str, timeout: int = 10) -> dict | None:
    return check_result(api_base, timeout)[0]


def _current() -> str:
    # импорт здесь, чтобы не создавать цикл
    import agent
    return agent.VERSION


def download_and_run(info: dict) -> Path:
    raw_url = info.get("download_url") or ""
    url = urljoin(info.get("_base_url") or "", raw_url)
    if not url.lower().startswith("https://") and not url.startswith("http://localhost"):
        raise RuntimeError("Обновление должно скачиваться по HTTPS")
    with urlopen(url, timeout=120) as resp:
        data = resp.read()
    expected = (info.get("sha256") or "").lower()
    if expected:
        actual = hashlib.sha256(data).hexdigest()
        if actual != expected:
            raise RuntimeError("Контрольная сумма обновления не совпала")
    target = Path(tempfile.gettempdir()) / ("ProfyPlanCompanionSetup-%s.exe" % info.get("version", "new"))
    target.write_bytes(data)
    service_installed = False
    try:
        service_installed = subprocess.run(
            ["sc", "query", "ProfyPlanCompanion"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=0x08000000,
        ).returncode == 0
    except Exception:
        pass
    if service_installed:
        # Служба работает под LocalSystem: обновление требует администратора.
        escaped = str(target).replace("'", "''")
        subprocess.Popen(
            ["powershell", "-NoProfile", "-Command",
             "Start-Process -FilePath '%s' -ArgumentList '--upgrade' -Verb RunAs" % escaped],
            creationflags=0x08000000,
        )
    else:
        subprocess.Popen([str(target), "--upgrade"], creationflags=0x08000000)
    return target
