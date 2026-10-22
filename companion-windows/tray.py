"""ProfyPlan Companion — tray UI (Windows).

Запускает фоновый цикл обмена и показывает иконку в системном трее.
"""
from __future__ import annotations

import ctypes
import os
import subprocess
import sys
import threading
import time
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
        try:
            info = update.check(self.cfg.get("api_base", ""))
        except Exception:
            info = None
        self.update_info = info
        if info:
            text = "Доступна версия %s" % info.get("version")
            if notify:
                self._notify(text)
            self._set_status(text)
        self.last_update_check = time.time()

    def on_check_update(self, icon=None, item=None):
        self.check_update(notify=True)

    def on_update(self, icon=None, item=None):
        info = self.update_info
        if not info:
            self.check_update(notify=True)
            info = self.update_info
        if not info:
            self._notify("Обновлений нет")
            return
        try:
            answer = ctypes.windll.user32.MessageBoxW(
                0,
                "Скачать и установить версию %s?" % info.get("version"),
                "ProfyPlan Companion — обновление",
                0x04 | 0x40,
            )
            if answer != 6:  # IDYES
                return
            self._set_status("загрузка обновления…")
            path = update.download_and_run(info)
            self._notify("Обновление %s загружено, запускаю установку" % info.get("version"))
            self.logger.info("update downloaded: %s", path)
            self.stop_event.set()
            self.icon.stop()
        except Exception as exc:
            self.logger.error("update failed: %s", exc)
            self._notify("Не удалось обновить: %s" % str(exc)[:120])

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
                     "-ConfigPath", str(self.config_path)],
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
