# Облачный адаптер ProfyPlan — Яндекс Диск

**Статус:** Яндекс Диск + Google Drive (первый срез), 22.10.2026

## 1. Назначение

Серверный адаптер читает входящие пакеты из облачной папки `ProfyPlan/1c_to_plan`, обрабатывает их тем же конвейером, что и локальный обмен, и выгружает новые файлы из локального `out` в `ProfyPlan/plan_to_1c`.

Пакет остаётся прежним — `profyplan.exchange.v1`; имя файла не является ключом, ключ — `packet_id` внутри JSON.

## 2. Канонические папки

```text
/ProfyPlan/
  1c_to_plan/                 # внешняя система → ProfyPlan
  plan_to_1c/                 # ProfyPlan → внешняя система
  processed/1c_to_plan/       # успешно принятые
  processed/plan_to_1c/
  archive/                    # ошибки разбора
  _state/
```

Локальные `in`/`out` считаются совместимым представлением `1c_to_plan`/`plan_to_1c`; формат пакета не меняется.

## 3. Настройки подключения

В `integration_connections.settings` добавляется объект:

```json
{
  "cloud": {
    "provider": "yandex",
    "root": "/ProfyPlan"
  }
}
```

Токен **не хранится в БД**. Он задаётся переменной окружения API:

```dotenv
YANDEX_DISK_TOKEN=...
YANDEX_DISK_ROOT=/ProfyPlan
```

Для пилота допустим один серверный токен; для production — защищённое хранилище/ACL и отдельный токен на клиента.

## 3.1. Google Drive

Для Google Drive в `settings.cloud` задаются ID папок:

```json
{
  "cloud": {
    "provider": "google",
    "root_folder_id": "ID корневой папки ProfyPlan",
    "folder_ids": {
      "1c_to_plan": "...",
      "plan_to_1c": "...",
      "processed": "...",
      "processed/1c_to_plan": "...",
      "processed/plan_to_1c": "...",
      "archive": "...",
      "_state": "..."
    }
  }
}
```

Токен — только через `GOOGLE_DRIVE_ACCESS_TOKEN`; в БД не хранится. Первый срез работает с access token и готовыми ID папок; OAuth-refresh и автоматическое создание папок — следующий этап. Все ID проверяются через Drive v3; загрузка идёт multipart, перемещение — через `addParents/removeParents`.

## 4. API

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/v1/integration/connections/{id}/cloud/status` | Провайдер, корень, наличие токена, список папок |
| POST | `/v1/integration/connections/{id}/cloud/check` | Создать канонические папки и проверить доступ |
| POST | `/v1/integration/connections/{id}/cloud/poll` | Принять `1c_to_plan`, выгрузить новый `out` в `plan_to_1c` |

`cloud/poll` можно вызывать по расписанию (cron/worker) с интервалом 5 минут; одновременно с локальным агентом одно подключение не опрашивать.

## 5. Поведение

- Успешно разобранный файл переносится в `processed/1c_to_plan`.
- Файл с ошибкой разбора переносится в `archive`; ошибка пишется в журнал обмена.
- Исходящие файлы перед загрузкой хешируются; повторная загрузка того же содержимого не выполняется (`settings.cloud_out_sent`).
- Ссылки на скачивание и загрузку принимаются только по HTTPS.
- Имена файлов нормализуются; пустые и скрытые имена пропускаются.

## 6. Проверка

- Мок-тест `apps/api/tests/test_cloud_exchange.py`: создание папок, upload, list, download, move.
- Smoke в контейнере: `cloud client smoke ok`.
- Импорт роутера: три cloud-маршрута присутствуют.
- Живой прогон с токеном Яндекс Диска — после выдачи токена и тестовой папки.

## 7. Ограничения первого среза

- Google Drive работает по access token и готовым ID папок; OAuth-refresh и создание папок — следующий этап.
- Нет отдельного UI настройки облака; параметры задаются в `settings` подключения.
- Нет встроенного планировщика: `cloud/poll` вызывает внешний cron/worker.
- Токен один на инстанс API; клиентские токены и ротация — production-этап.
