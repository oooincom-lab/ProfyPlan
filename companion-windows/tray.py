"""ProfyPlan Companion — tray UI (Windows).

Запускает фоновый цикл обмена и показывает иконку в системном трее.
"""
from __future__ import annotations

import os
import subprocess
import threading
import time
from pathlib import Path

import agent

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
        self.status_item = pystray.MenuItem("Статус: ожидание", None, enabled=False)
        self.icon = pystray.Icon(
            "profyplan-companion",
            _icon_image(),
            "ProfyPlan Companion — ожидание",
            menu=pystray.Menu(
                pystray.MenuItem("Синхронизировать сейчас", self.on_sync),
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
            self.status_item.text = "Статус: " + text
            self.icon.update_menu()
        except Exception:
            pass

    def on_sync(self, icon=None, item=None):
        self.sync_event.set()

    def on_open_folder(self, icon=None, item=None):
        try:
            os.startfile(str(Path(self.cfg["root_dir"])))
        except Exception as exc:
            self.logger.error("не удалось открыть папку: %s", exc)

    def on_open_config(self, icon=None, item=None):
        try:
            subprocess.Popen(["notepad.exe", str(self.config_path)])
        except Exception as exc:
            self.logger.error("не удалось открыть конфиг: %s", exc)

    def on_exit(self, icon=None, item=None):
        self.stop_event.set()
        self.icon.stop()

    def _loop(self):
        interval = int(self.cfg.get("interval_seconds") or 300)
        while not self.stop_event.is_set():
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
            self.sync_event.clear()
            # ждём интервал или ручную синхронизацию
            end = time.time() + interval
            while time.time() < end and not self.stop_event.is_set():
                if self.sync_event.wait(timeout=1.0):
                    break

    def run(self):
        thread = threading.Thread(target=self._loop, name="companion-sync", daemon=True)
        thread.start()
        self._set_status("запущен")
        self.icon.run()


def run_tray(cfg: dict, config_path: Path) -> int:
    app = TrayApp(cfg, config_path)
    app.run()
    return 0
