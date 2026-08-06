"""
Google Sheets Sync — экспорт данных проекта в Google Sheets.

Требует сервисный аккаунт Google Cloud с доступом к Sheets API.
Конфигурация через переменные окружения:
  - GOOGLE_SHEETS_CREDENTIALS_JSON — путь к JSON-файлу сервисного аккаунта
  - GOOGLE_SHEETS_DEFAULT_FOLDER — ID папки Google Drive (опционально)

Установка: pip install gspread google-auth
"""
import json
import os
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


@dataclass
class SheetsSyncResult:
    """Результат синхронизации с Google Sheets."""
    spreadsheet_id: str
    spreadsheet_url: str
    sheets_created: list[str] = field(default_factory=list)
    rows_written: dict[str, int] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def _get_gspread_client():
    """Получить авторизованный клиент gspread."""
    try:
        import gspread
        from google.oauth2.service_account import Credentials
    except ImportError:
        raise ImportError(
            "gspread и google-auth не установлены. "
            "pip install gspread google-auth"
        )

    creds_path = os.environ.get("GOOGLE_SHEETS_CREDENTIALS_JSON")
    if not creds_path:
        # Попробовать найти в стандартных местах
        candidates = [
            "/app/google-credentials.json",
            "/opt/profyplan/google-credentials.json",
            "google-credentials.json",
        ]
        for c in candidates:
            if os.path.exists(c):
                creds_path = c
                break

    if not creds_path or not os.path.exists(creds_path):
        raise ValueError(
            "Google Sheets credentials не найдены. "
            "Установите GOOGLE_SHEETS_CREDENTIALS_JSON "
            "или поместите google-credentials.json в корень проекта."
        )

    scopes = [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive.file",
    ]
    creds = Credentials.from_service_account_file(creds_path, scopes=scopes)
    return gspread.authorize(creds)


def sync_to_sheets(
    operations: list[dict],
    dependencies: list[dict],
    resources: Optional[list[dict]] = None,
    project_name: str = "Проект",
    spreadsheet_id: Optional[str] = None,
    spreadsheet_name: Optional[str] = None,
    folder_id: Optional[str] = None,
) -> SheetsSyncResult:
    """
    Синхронизировать данные проекта в Google Sheets.

    Если spreadsheet_id передан — обновляет существующую таблицу.
    Иначе создаёт новую.

    Листы:
      - Ганта: операции с ES/EF/LS/LF
      - CPM: критический путь
      - Ресурсы: загрузка (опционально)
      - Мета: сводка

    Возвращает SheetsSyncResult с URL созданной/обновлённой таблицы.
    """
    errors = []
    warnings = []

    try:
        gc = _get_gspread_client()
    except (ImportError, ValueError) as e:
        return SheetsSyncResult(
            spreadsheet_id="",
            spreadsheet_url="",
            errors=[str(e)],
        )

    # Открываем или создаём таблицу
    try:
        if spreadsheet_id:
            sh = gc.open_by_key(spreadsheet_id)
        elif spreadsheet_name:
            try:
                sh = gc.open(spreadsheet_name)
            except Exception:
                sh = gc.create(spreadsheet_name, folder_id=folder_id)
        else:
            ts = datetime.now().strftime("%Y%m%d-%H%M")
            name = f"{project_name} — {ts}"
            sh = gc.create(name, folder_id=folder_id)
    except Exception as e:
        return SheetsSyncResult(
            spreadsheet_id=spreadsheet_id or "",
            spreadsheet_url="",
            errors=[f"Не удалось открыть/создать таблицу: {e}"],
        )

    result = SheetsSyncResult(
        spreadsheet_id=sh.id,
        spreadsheet_url=f"https://docs.google.com/spreadsheets/d/{sh.id}",
    )

    # --- Лист 1: Мета ---
    meta_sheet = _ensure_sheet(sh, "Мета", clear=True)
    meta_data = [
        ["Проект", project_name],
        ["Обновлено", datetime.now().strftime("%Y-%m-%d %H:%M:%S")],
        ["Операций", len(operations)],
        ["Зависимостей", len(dependencies)],
        ["Ресурсов", len(resources or [])],
        ["Makespan (ч)", round(max(
            (o.get("late_finish", 0) for o in operations), default=0
        ), 1)],
        ["Критических операций", sum(
            1 for o in operations if o.get("is_critical")
        )],
    ]
    meta_sheet.update(meta_data, "A1")
    result.sheets_created.append("Мета")
    result.rows_written["Мета"] = len(meta_data)

    # --- Лист 2: Ганта ---
    gantt_sheet = _ensure_sheet(sh, "Ганта", clear=True)
    gantt_headers = [
        "№", "Операция", "Длит. (ч)", "ES", "EF", "LS", "LF",
        "Slack", "Крит.", "Предшественники"
    ]
    gantt_data = [gantt_headers]

    ops = sorted(operations, key=lambda o: o.get("early_start", 0))
    pred_map: dict[str, list] = {}
    for d in dependencies:
        pred_map.setdefault(d["successor_id"], []).append(d["predecessor_id"])
    op_names: dict[str, str] = {
        o["id"]: o.get("name", o["id"][:8]) for o in operations
    }

    for i, op in enumerate(ops):
        row = [
            i + 1,
            op.get("name", op["id"][:8]),
            round(op.get("duration_base", 0), 1),
            round(op.get("early_start", 0), 1),
            round(op.get("early_finish", 0), 1),
            round(op.get("late_start", 0), 1),
            round(op.get("late_finish", 0), 1),
            round(op.get("slack", 0), 1),
            "✓" if op.get("is_critical") else "",
            ", ".join(op_names.get(p, p[:8]) for p in pred_map.get(op["id"], [])),
        ]
        gantt_data.append(row)

    gantt_sheet.update(gantt_data, "A1")
    result.sheets_created.append("Ганта")
    result.rows_written["Ганта"] = len(gantt_data)

    # --- Лист 3: Ресурсы ---
    if resources:
        res_sheet = _ensure_sheet(sh, "Ресурсы", clear=True)
        res_headers = ["Ресурс", "Загрузка %", "Уровень", "Операций", "Рекомендации"]
        res_data = [res_headers]
        for r in resources:
            row = [
                r.get("name", "?"),
                round(r.get("load_percent", 0), 1),
                r.get("bottleneck_level", "normal"),
                r.get("assigned_operations", 0),
                "; ".join(r.get("recommendations", [])),
            ]
            res_data.append(row)
        res_sheet.update(res_data, "A1")
        result.sheets_created.append("Ресурсы")
        result.rows_written["Ресурсы"] = len(res_data)

    return result


def _ensure_sheet(sh, name: str, clear: bool = True):
    """Получить лист по имени, создав его при необходимости."""
    try:
        ws = sh.worksheet(name)
        if clear:
            ws.clear()
        return ws
    except Exception:
        ws = sh.add_worksheet(title=name, rows=1000, cols=20)
        return ws
