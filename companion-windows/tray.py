"""ProfyPlan Companion — tray UI (Windows).

Запускает фоновый цикл обмена и показывает иконку в системном трее.
"""
from __future__ import annotations

import ctypes
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
from datetime import datetime
from pathlib import Path

import agent
import update

try:
    import pystray
    from PIL import Image, ImageDraw
except Exception as exc:  # pragma: no cover - зависит от окружения
    pystray = None
    Image = None
    ImageDraw = None
    _IMPORT_ERROR = exc
else:
    _IMPORT_ERROR = None


def _icon_image():
    if Image is None:
        return None
    image = Image.new("RGBA", (64, 64), (11, 22, 38, 255))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((6, 6, 58, 58), radius=14, fill=(37, 99, 235, 255))
    draw.rectangle((16, 20, 48, 25), fill=(255, 255, 255, 255))
    draw.rectangle((16, 30, 48, 35), fill=(191, 219, 254, 255))
    draw.rectangle((16, 40, 38, 45), fill=(147, 197, 253, 255))
    return image


class TrayApp:
    def __init__(self, cfg: dict, config_path: Path):
        if pystray is None:
            raise RuntimeError("pystray/Pillow не установлены: %s" % _IMPORT_ERROR)
        self.cfg = cfg
        self.config_path = Path(config_path)
        self.logger = agent.setup_logging(cfg, False)
        self.stop_event = threading.Event()
        self.sync_event = threading.Event()
        self.status = "ожидание"
        self.update_info = None
        self.update_error = None
        self.last_update_check = 0.0
        self.status_item = pystray.MenuItem("Статус", None, enabled=False)
        self.update_item = pystray.MenuItem("Обновить", self.on_update)
        self.icon = pystray.Icon(
            "profyplan-companion",
            _icon_image(),
            "ProfyPlan Companion — ожидание",
            menu=pystray.Menu(
                pystray.MenuItem("Синхронизировать сейчас", self.on_sync),
                self.update_item,
                pystray.MenuItem("Проверить обновление", self.on_check_update),
                self.status_item,
                pystray.MenuItem("Открыть папку обмена", self.on_open_folder),
                pystray.MenuItem("Настройки", self.on_open_config),
                pystray.MenuItem("О программе", self.on_about),
                pystray.MenuItem("Выход", self.on_exit),
            ),
        )

    def _set_status(self, text: str):
        self.status = text
        try:
            self.icon.title = "ProfyPlan Companion — " + text
            self.icon.update_menu()
        except Exception:
            pass

    def _notify(self, text: str):
        try:
            self.icon.notify(text, "ProfyPlan Companion")
        except Exception:
            self._set_status(text)

    def check_update(self, notify: bool = False):
        info, error = update.check_result(self.cfg.get("api_base", ""))
        self.update_info = info
        self.update_error = error
        if info:
            text = "Доступна версия %s" % info.get("version")
            if notify:
                self._notify(text)
            self._set_status(text)
        elif error:
            self._set_status("ошибка проверки обновления")
        else:
            self._set_status("обновлений нет")
        self.last_update_check = time.time()

    def _info_payload(self, mode: str) -> dict:
        info = self.update_info
        available = bool(info)
        if available:
            status = "Доступна версия %s" % info.get("version")
        elif self.update_error:
            status = "Ошибка: %s" % self.update_error[:90]
        else:
            status = "Установлена актуальная версия"
        return {
            "mode": mode,
            "current": agent.VERSION,
            "latest": info.get("version") if info else "",
            "status": status,
            "notes": info.get("notes", "") if info else "",
            "update_available": available,
            "error": self.update_error or "",
            "checked_at": datetime.now().strftime("%d.%m.%Y %H:%M"),
            "connection_name": self.cfg.get("connection_name") or "не задано",
            "api_base": self.cfg.get("api_base") or "",
            "root_dir": self.cfg.get("root_dir") or "",
            "interval_minutes": max(1, int((self.cfg.get("interval_seconds") or 300) / 60)),
        }

    def _info_script(self) -> Path:
        if getattr(sys, "frozen", False):
            return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent)) / "info.ps1"
        return Path(__file__).with_name("info.ps1")

    def _show_info(self, mode: str) -> int:
        path = Path(tempfile.gettempdir()) / ("profyplan-companion-info-%s.json" % os.getpid())
        path.write_text(json.dumps(self._info_payload(mode), ensure_ascii=False, indent=2), encoding="utf-8")
        try:
            proc = subprocess.run(
                ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass",
                 "-WindowStyle", "Hidden", "-File", str(self._info_script()),
                 "-InfoPath", str(path)],
                creationflags=0x08000000,
            )
            return int(proc.returncode or 0)
        finally:
            try:
                path.unlink()
            except Exception:
                pass

    def on_check_update(self, icon=None, item=None):
        def worker():
            while True:
                self.check_update(notify=True)
                try:
                    rc = self._show_info("update")
                except Exception as exc:
                    self.logger.error("update info failed: %s", exc)
                    self._notify("Не удалось открыть окно проверки")
                    return
                if rc != 11:
                    return
        threading.Thread(target=worker, daemon=True).start()

    def on_update(self, icon=None, item=None):
        def worker():
            while True:
                if not self.update_info:
                    self.check_update(notify=True)
                try:
                    rc = self._show_info("update")
                except Exception as exc:
                    self.logger.error("update info failed: %s", exc)
                    self._notify("Не удалось открыть окно обновления")
                    return
                if rc == 11:
                    continue
                if rc != 10:
                    return
                try:
                    self._set_status("загрузка обновления…")
                    path = update.download_and_run(self.update_info)
                    self._notify("Обновление %s загружено, запускаю установку" % self.update_info.get("version"))
                    self.logger.info("update downloaded: %s", path)
                    self.stop_event.set()
                    self.icon.stop()
                except Exception as exc:
                    self.logger.error("update failed: %s", exc)
                    self.update_info = None
                    self.update_error = "Не удалось скачать обновление: %s" % str(exc)[:140]
                    try:
                        self._show_info("update")
                    except Exception:
                        pass
                return
        threading.Thread(target=worker, daemon=True).start()

    def on_about(self, icon=None, item=None):
        def worker():
            if not self.last_update_check:
                self.check_update(notify=False)
            try:
                rc = self._show_info("about")
                if rc == 11:
                    self.on_check_update()
            except Exception as exc:
                self.logger.error("about failed: %s", exc)
                self._notify("Не удалось открыть «О программе»")
        threading.Thread(target=worker, daemon=True).start()

    def on_sync(self, icon=None, item=None):
        self.sync_event.set()

    def on_open_folder(self, icon=None, item=None):
        try:
            os.startfile(str(Path(self.cfg["root_dir"])))
        except Exception as exc:
            self.logger.error("не удалось открыть папку: %s", exc)

    def _settings_script(self) -> Path:
        if getattr(sys, "frozen", False):
            return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent)) / "settings.ps1"
        return Path(__file__).with_name("settings.ps1")

    def on_open_config(self, icon=None, item=None):
        def worker():
            try:
                script = self._settings_script()
                subprocess.run(
                    ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass",
                     "-WindowStyle", "Hidden", "-File", str(script),
                     "-ConfigPath", str(self.config_path), "-Version", agent.VERSION],
                    creationflags=0x08000000,
                )
                self.cfg = agent.load_config(self.config_path)
                self._set_status("настройки сохранены")
            except Exception as exc:
                self.logger.error("не удалось открыть настройки: %s", exc)
                self._set_status("ошибка настроек")
        threading.Thread(target=worker, daemon=True).start()

    def on_exit(self, icon=None, item=None):
        self.stop_event.set()
        self.icon.stop()

    def _loop(self):
        while not self.stop_event.is_set():
            interval = int(self.cfg.get("interval_seconds") or 300)
            self._set_status("обмен…")
            try:
                rc = agent.sync_once(self.cfg, self.logger)
                if rc == 0:
                    self._set_status("обмен выполнен")
                elif rc == 2:
                    self._set_status("обмен занят другой сессией")
                elif rc == 3:
                    self._set_status("ошибка входа/API")
                else:
                    self._set_status("ошибка обмена")
            except Exception as exc:
                self.logger.exception("tray sync error")
                self._set_status("ошибка: %s" % str(exc)[:40])
            if time.time() - self.last_update_check > 6 * 3600:
                self.check_update(notify=True)
            self.sync_event.clear()
            # ждём интервал или ручную синхронизацию
            end = time.time() + interval
            while time.time() < end and not self.stop_event.is_set():
                if self.sync_event.wait(timeout=1.0):
                    break

    def run(self):
        self.check_update(notify=False)
        thread = threading.Thread(target=self._loop, name="companion-sync", daemon=True)
        thread.start()
        self._set_status("запущен")
        self.icon.run()


def run_tray(cfg: dict, config_path: Path) -> int:
    app = TrayApp(cfg, config_path)
    app.run()
    return 0
