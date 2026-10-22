"""ProfyPlan Companion — установка и автоматическая привязка (Windows).

Установщик не требует GUI: он ищет companion-setup.json рядом с собой,
привязывается по коду, копирует приложение, создаёт ярлык, запись в
«Установленные программы» и автозапуск в трее.
"""
from __future__ import annotations

import ctypes
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

import agent
from update import parse_version

APP_NAME = "ProfyPlan Companion"
DEFAULT_API = "https://profyplan.ru/api/v1"
DEFAULT_ROOT = Path(os.environ.get("USERPROFILE", Path.home())) / "ProfyPlanExchange"
DEFAULT_DIR = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "Programs" / "ProfyPlanCompanion"
RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
UNINSTALL_KEY = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\ProfyPlanCompanion"


def _msg(text: str, title: str = APP_NAME, error: bool = False) -> None:
    if os.environ.get("PROFYPLAN_SILENT") == "1":
        print(text, file=sys.stderr if error else sys.stdout)
        return
    if os.name == "nt":
        try:
            ctypes.windll.user32.MessageBoxW(0, text, title, 0x10 if error else 0x40)
            return
        except Exception:
            pass
    print(text, file=sys.stderr if error else sys.stdout)


def _shortcut_path() -> Path:
    base = Path(os.environ.get("APPDATA", Path.home())) / "Microsoft" / "Windows" / "Start Menu" / "Programs"
    return base / "ProfyPlan Companion.lnk"


def _write_registry(install_dir: Path, exe: Path) -> None:
    if os.name != "nt":
        return
    import winreg

    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as key:
        winreg.SetValueEx(key, "ProfyPlanCompanion", 0, winreg.REG_SZ,
                          '"%s" tray --config "%s"' % (exe, install_dir / "companion.json"))
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, UNINSTALL_KEY) as key:
        winreg.SetValueEx(key, "DisplayName", 0, winreg.REG_SZ, APP_NAME)
        winreg.SetValueEx(key, "DisplayVersion", 0, winreg.REG_SZ, agent.VERSION)
        winreg.SetValueEx(key, "Publisher", 0, winreg.REG_SZ, "ProfyPlan")
        winreg.SetValueEx(key, "InstallLocation", 0, winreg.REG_SZ, str(install_dir))
        winreg.SetValueEx(key, "DisplayIcon", 0, winreg.REG_SZ, str(exe))
        winreg.SetValueEx(key, "UninstallString", 0, winreg.REG_SZ, '"%s" --uninstall' % exe)
        winreg.SetValueEx(key, "NoModify", 0, winreg.REG_DWORD, 1)
        winreg.SetValueEx(key, "NoRepair", 0, winreg.REG_DWORD, 1)


def _remove_registry() -> None:
    if os.name != "nt":
        return
    import winreg
    for root, path, name in [
        (winreg.HKEY_CURRENT_USER, RUN_KEY, "ProfyPlanCompanion"),
        (winreg.HKEY_CURRENT_USER, UNINSTALL_KEY, None),
    ]:
        try:
            if name:
                with winreg.OpenKey(root, path, 0, winreg.KEY_SET_VALUE) as key:
                    winreg.DeleteValue(key, name)
            else:
                winreg.DeleteKey(root, path)
        except FileNotFoundError:
            pass
        except OSError:
            pass


def _create_shortcut(exe: Path, config: Path) -> None:
    if os.name != "nt":
        return
    lnk = _shortcut_path()
    lnk.parent.mkdir(parents=True, exist_ok=True)
    script = (
        "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%s');"
        "$s.TargetPath='%s';$s.Arguments='tray --config \"%s\"';"
        "$s.WorkingDirectory='%s';$s.Save()"
    ) % (str(lnk).replace("'", "''"), str(exe).replace("'", "''"),
         str(config).replace("'", "''"), str(exe.parent).replace("'", "''"))
    subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
                   capture_output=True, creationflags=0x08000000)


def _remove_shortcut() -> None:
    try:
        _shortcut_path().unlink(missing_ok=True)
    except Exception:
        pass


def install(config_path: Path, install_dir: Path = DEFAULT_DIR, start: bool = True) -> Path:
    install_dir = Path(install_dir)
    install_dir.mkdir(parents=True, exist_ok=True)
    target = install_dir / "ProfyPlanCompanion.exe"
    source = Path(sys.executable) if getattr(sys, "frozen", False) else Path(sys.argv[0])
    if source.resolve() != target.resolve():
        shutil.copy2(source, target)
    shutil.copy2(config_path, install_dir / "companion.json")
    _create_shortcut(target, install_dir / "companion.json")
    _write_registry(install_dir, target)
    if start:
        subprocess.Popen([str(target), "tray", "--config", str(install_dir / "companion.json")],
                         cwd=str(install_dir), creationflags=0x08000000)
    return target


def uninstall() -> None:
    install_dir = DEFAULT_DIR
    _remove_registry()
    _remove_shortcut()
    if not install_dir.exists():
        return
    bat = Path(tempfile.gettempdir()) / "profyplan_companion_uninstall.bat"
    bat.write_text(
        "@echo off\r\n"
        "cd /d \"%s\"\r\n"
        "timeout /t 2 /nobreak >nul\r\n"
        "taskkill /IM ProfyPlanCompanion.exe /F >nul 2>&1\r\n"
        "rmdir /s /q \"%s\" >nul 2>&1\r\n"
        "del \"%%~f0\" >nul 2>&1\r\n" % (os.environ.get("TEMP", r"C:\\Windows\\Temp"), install_dir),
        encoding="utf-8",
    )
    subprocess.Popen(["cmd.exe", "/c", str(bat)], creationflags=0x08000000,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def _candidate_setup_files() -> list[Path]:
    here = Path(sys.executable).parent if getattr(sys, "frozen", False) else Path(__file__).parent
    return [
        here / "companion-setup.json",
        Path.cwd() / "companion-setup.json",
        Path.home() / "Downloads" / "companion-setup.json",
    ]


def _find_setup_file(explicit: str | None = None) -> Path | None:
    if explicit:
        p = Path(explicit)
        return p if p.exists() else None
    for p in _candidate_setup_files():
        if p.exists():
            return p
    return None


def setup_from_file(setup_file: Path) -> Path:
    data = json.loads(Path(setup_file).read_text(encoding="utf-8"))
    api_base = data.get("api_base") or DEFAULT_API
    connection_id = data.get("connection_id")
    code = data.get("code")
    if not connection_id or not code:
        raise ValueError("В companion-setup.json нужны connection_id и code")
    root = Path(data.get("root_dir") or DEFAULT_ROOT)
    root.mkdir(parents=True, exist_ok=True)
    api = agent.Api(api_base)
    res = api._request("POST", "/integration/agent/pair", json.dumps({
        "connection_id": connection_id,
        "code": code,
        "instance_id": str(uuid.uuid4()),
        "agent_name": "windows-companion",
    }).encode("utf-8"), "application/json")
    cfg = {
        "version": 1,
        "api_base": api_base,
        "email": "",
        "password_enc": "",
        "agent_token_enc": agent.seal_password(res["access_token"]),
        "connection_id": connection_id,
        "connection_name": res.get("connection_name") or "",
        "root_dir": str(root),
        "in_dir": str(root / "in"),
        "out_dir": str(root / "out"),
        "processed_dir": str(root / "processed"),
        "interval_seconds": int(data.get("interval_seconds") or 300),
        "agent_id": agent.AGENT_ID,
        "instance_id": str(uuid.uuid4()),
    }
    temp_cfg = Path(tempfile.gettempdir()) / "profyplan-companion-setup.json"
    agent.save_config(temp_cfg, cfg)
    target = install(temp_cfg, DEFAULT_DIR, start=True)
    return target


def installed_version() -> str:
    if os.name != "nt":
        return ""
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, UNINSTALL_KEY) as key:
            value, _ = winreg.QueryValueEx(key, "DisplayVersion")
            return str(value)
    except Exception:
        return ""


def _stop_running() -> None:
    if os.name != "nt":
        return
    subprocess.run(["taskkill", "/IM", "ProfyPlanCompanion.exe", "/F"],
                   capture_output=True, creationflags=0x08000000)
    time.sleep(1.0)


def _remove_tree(path: Path) -> None:
    for _ in range(5):
        try:
            if path.exists():
                shutil.rmtree(path)
            return
        except Exception:
            time.sleep(1.0)


def run_upgrade(force: bool = False) -> int:
    """Обновить установленную версию, сохранив companion.json."""
    cfg = DEFAULT_DIR / "companion.json"
    if not cfg.exists():
        _msg("Установленная версия не найдена — запустите обычную установку.", error=True)
        return 2
    old = installed_version()
    if old and parse_version(old) >= parse_version(agent.VERSION) and not force:
        _msg("Уже установлена версия %s. Обновление не требуется." % old)
        return 0
    temp_cfg = Path(tempfile.gettempdir()) / "profyplan-companion-upgrade.json"
    shutil.copy2(cfg, temp_cfg)
    has_service = False
    try:
        from service import service_exists, stop_for_upgrade
        has_service = service_exists()
        if has_service:
            stop_for_upgrade()
    except Exception as exc:
        _msg("Не удалось остановить службу для обновления:\n%s" % exc, error=True)
        return 3
    _stop_running()
    _remove_registry()
    _remove_shortcut()
    _remove_tree(DEFAULT_DIR)
    target = install(temp_cfg, DEFAULT_DIR, start=True)
    if has_service:
        try:
            from service import install_service
            install_service(target.parent / "companion.json")
        except Exception as exc:
            _msg("Приложение обновлено, но служба не перезапущена:\n%s" % exc, error=True)
            return 4
    _msg("Обновление установлено: %s" % agent.VERSION)
    return 0


def _clipboard_setup() -> Path | None:
    """Прочитать код установщика из буфера: connection_id|code|api_base."""
    if os.name != "nt":
        return None
    try:
        out = subprocess.run(
            ["powershell", "-NoProfile", "-Command", "Get-Clipboard"],
            capture_output=True, text=True, timeout=10,
        )
        raw = (out.stdout or "").strip()
        if "|" not in raw:
            return None
        parts = [p.strip() for p in raw.split("|")]
        if len(parts) < 2:
            return None
        data = {
            "connection_id": parts[0],
            "code": parts[1],
            "api_base": parts[2] if len(parts) > 2 and parts[2] else DEFAULT_API,
        }
        p = Path(tempfile.gettempdir()) / "companion-clipboard-setup.json"
        p.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        return p
    except Exception:
        return None


def run_setup(setup_file: str | None = None, service: bool = False) -> int:
    old = installed_version()
    upgrade_flag = "--upgrade" in sys.argv
    if old and (upgrade_flag or (DEFAULT_DIR / "companion.json").exists()):
        if upgrade_flag:
            return run_upgrade(force="--force" in sys.argv)
        if parse_version(old) >= parse_version(agent.VERSION):
            _msg("Уже установлена версия %s. Переустановка не требуется." % old)
            return 0
        answer = ctypes.windll.user32.MessageBoxW(
            0,
            "Установлена версия %s.\nУдалить её и установить %s?" % (old, agent.VERSION),
            "ProfyPlan Companion — обновление",
            0x04 | 0x40,
        )
        if answer != 6:
            return 0
        return run_upgrade(force=True)
    path = _find_setup_file(setup_file)
    if path is None:
        path = _clipboard_setup()
    if path is None:
        _msg(
            "Не найден код привязки.\n\n"
            "В ProfyPlan нажмите «Скачать установщик» — код скопируется в буфер. "
            "Затем запустите этот установщик ещё раз.",
            error=True,
        )
        return 2
    try:
        target = setup_from_file(path)
    except Exception as exc:
        _msg("Не удалось установить companion:\n%s" % exc, error=True)
        return 3
    if service:
        try:
            from service import install_service
            install_service(target.parent / "companion.json")
            _msg("Готово. Companion установлен как Windows-служба и запущен без входа пользователя.\n\n%s" % target.parent)
            return 0
        except Exception as exc:
            _msg("Приложение установлено, но служба не создана:\n%s\n\nЗапустите установщик от имени администратора." % exc, error=True)
            return 4
    _msg("Готово. ProfyPlan Companion установлен и запущен в системном трее.\n\n%s" % target.parent)
    return 0
