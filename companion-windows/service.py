"""Установка и управление Windows-службой ProfyPlan Companion (WinSW)."""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from xml.sax.saxutils import escape

import agent
import installer

SERVICE_NAME = "ProfyPlanCompanion"
SERVICE_DISPLAY = "ProfyPlan Companion"
SERVICE_DIR = Path(os.environ.get("PROGRAMDATA") or r"C:\ProgramData") / "ProfyPlanCompanion"
SERVICE_CONFIG = SERVICE_DIR / "companion.json"
SERVICE_WRAPPER = SERVICE_DIR / "ProfyPlanCompanionService.exe"
SERVICE_XML = SERVICE_DIR / "ProfyPlanCompanionService.xml"


class ServiceError(RuntimeError):
    pass


def _is_admin() -> bool:
    if os.name != "nt":
        return False
    try:
        return bool(ctypes_windll_shell32_IsUserAnAdmin())
    except Exception:
        return False


def ctypes_windll_shell32_IsUserAnAdmin() -> int:
    import ctypes
    return ctypes.windll.shell32.IsUserAnAdmin()


def _winsw_source() -> Path:
    if getattr(sys, "frozen", False):
        base = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
        candidates = [base / "vendor" / "winsw.exe", base / "winsw.exe"]
    else:
        here = Path(__file__).resolve().parent
        candidates = [here / "vendor" / "winsw.exe", here / "winsw.exe"]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    raise ServiceError("Не найден winsw.exe (vendor/winsw.exe)")


def _app_exe() -> Path:
    installed = installer.DEFAULT_DIR / "ProfyPlanCompanion.exe"
    if installed.exists():
        return installed
    if getattr(sys, "frozen", False) and Path(sys.executable).name.lower() != "profyplancompanionsetup.exe":
        return Path(sys.executable)
    raise ServiceError("Не найден ProfyPlanCompanion.exe; сначала установите приложение")


def _run(cmd: list, cwd: Path | None = None, timeout: int = 30) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        capture_output=True,
        text=True,
        timeout=timeout,
        creationflags=0x08000000,
    )


def service_exists() -> bool:
    if os.name != "nt":
        return False
    try:
        return _run(["sc", "query", SERVICE_NAME]).returncode == 0
    except Exception:
        return False


def service_status() -> str:
    if not service_exists():
        return "not installed"
    try:
        result = _run(["sc", "query", SERVICE_NAME])
        for line in (result.stdout or "").splitlines():
            upper = line.upper()
            if any(word in upper for word in ("RUNNING", "STOPPED", "START_PENDING", "STOP_PENDING")):
                return line.strip()
    except Exception:
        pass
    return "unknown"


def _acl(path: Path) -> None:
    if os.name != "nt":
        return
    try:
        _run([
            "icacls", str(path), "/inheritance:r",
            "/grant:r", "*S-1-5-18:(OI)(CI)F",       # SYSTEM
            "*S-1-5-32-544:(OI)(CI)F",             # Administrators
        ])
    except Exception:
        pass


def _stop_service() -> None:
    if not service_exists():
        return
    if SERVICE_WRAPPER.exists():
        _run([str(SERVICE_WRAPPER), "stop"], cwd=SERVICE_DIR)
    _run(["sc", "stop", SERVICE_NAME])
    for _ in range(15):
        status = service_status()
        if "STOPPED" in status or "not installed" in status:
            return
        time.sleep(1)


def _write_service_xml(app_exe: Path, config: Path, root: Path) -> None:
    xml = """<service>
  <id>{service_id}</id>
  <name>{display}</name>
  <description>Модуль обмена данными ProfyPlan с учётными системами</description>
  <executable>{exe}</executable>
  <arguments>run --config "{config}"</arguments>
  <workingdirectory>{workdir}</workingdirectory>
  <logpath>{logpath}</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>10485760</sizeThreshold>
    <keepFiles>5</keepFiles>
  </log>
  <startmode>Automatic</startmode>
  <delayedAutoStart>true</delayedAutoStart>
  <onfailure action="restart" delay="10 sec"/>
  <stoptimeout>15 sec</stoptimeout>
</service>
""".format(
        service_id=SERVICE_NAME,
        display=SERVICE_DISPLAY,
        exe=escape(str(app_exe)),
        config=escape(str(config)),
        workdir=escape(str(app_exe.parent)),
        logpath=escape(str(SERVICE_DIR / "logs")),
    )
    SERVICE_XML.write_text(xml, encoding="utf-8")


def _stop_tray() -> None:
    """Остановить tray, не убивая текущий установщик."""
    if os.name != "nt":
        return
    self_pid = os.getpid()
    try:
        _run([
            "taskkill", "/F",
            "/FI", "IMAGENAME eq ProfyPlanCompanion.exe",
            "/FI", "PID ne %d" % self_pid,
        ])
    except Exception:
        pass


def install_service(config_path: Path, root: Path | None = None) -> dict:
    if os.name != "nt":
        raise ServiceError("Служба доступна только в Windows")
    if not _is_admin():
        raise ServiceError("Установка службы требует прав администратора")
    cfg = agent.load_config(Path(config_path))
    token = ""
    if cfg.get("agent_token_enc"):
        token = agent.open_password(cfg["agent_token_enc"])
    else:
        api = agent.Api(cfg["api_base"])
        try:
            token = api.login(cfg.get("email", ""), agent.open_password(cfg.get("password_enc", "")))
        except Exception as exc:
            raise ServiceError("Не удалось получить токен для службы: %s" % exc)
    if not token:
        raise ServiceError("В конфиге нет agent token")

    service_root = Path(root or cfg.get("root_dir") or installer.DEFAULT_ROOT)
    service_root.mkdir(parents=True, exist_ok=True)
    service_cfg = dict(cfg)
    service_cfg.update({
        "service_mode": True,
        "root_dir": str(service_root),
        "in_dir": str(service_root / "in"),
        "out_dir": str(service_root / "out"),
        "processed_dir": str(service_root / "processed"),
        "log_dir": str(SERVICE_DIR / "logs"),
        "email": "",
        "password_enc": "",
        "agent_token_enc": agent.seal_machine(token),
    })
    SERVICE_DIR.mkdir(parents=True, exist_ok=True)
    agent.save_config(SERVICE_CONFIG, service_cfg)
    _acl(SERVICE_DIR)

    if service_exists():
        _stop_service()
        if SERVICE_WRAPPER.exists():
            _run([str(SERVICE_WRAPPER), "uninstall"], cwd=SERVICE_DIR)
    _stop_tray()
    source = _winsw_source()
    shutil.copy2(source, SERVICE_WRAPPER)
    _write_service_xml(_app_exe(), SERVICE_CONFIG, service_root)
    result = _run([str(SERVICE_WRAPPER), "install"], cwd=SERVICE_DIR)
    if result.returncode != 0:
        raise ServiceError("WinSW install: %s" % ((result.stderr or result.stdout or "")[:400]))
    result = _run([str(SERVICE_WRAPPER), "start"], cwd=SERVICE_DIR)
    if result.returncode != 0:
        raise ServiceError("WinSW start: %s" % ((result.stderr or result.stdout or "")[:400]))
    for _ in range(15):
        if "RUNNING" in service_status().upper():
            break
        time.sleep(1)
    return {
        "service": SERVICE_NAME,
        "status": service_status(),
        "config": str(SERVICE_CONFIG),
        "root": str(service_root),
    }


def uninstall_service(keep_data: bool = True) -> dict:
    if os.name != "nt":
        raise ServiceError("Служба доступна только в Windows")
    if not _is_admin():
        raise ServiceError("Удаление службы требует прав администратора")
    if service_exists():
        _stop_service()
        _run([str(SERVICE_WRAPPER), "uninstall"], cwd=SERVICE_DIR)
    if not keep_data:
        for path in (SERVICE_WRAPPER, SERVICE_XML, SERVICE_CONFIG):
            try:
                path.unlink(missing_ok=True)
            except Exception:
                pass
    return {"service": SERVICE_NAME, "status": service_status()}


def stop_for_upgrade() -> bool:
    if not service_exists():
        return False
    if not _is_admin():
        raise ServiceError("Для обновления службы нужны права администратора")
    _stop_service()
    return True


def start_after_upgrade() -> None:
    if service_exists():
        if SERVICE_WRAPPER.exists():
            _run([str(SERVICE_WRAPPER), "start"], cwd=SERVICE_DIR)
