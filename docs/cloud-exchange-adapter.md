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

Для обратной совместимости можно задать серверный токен окружением API (без OAuth); в этом режиме refresh token не используется:

```dotenv
YANDEX_DISK_TOKEN=...
YANDEX_DISK_ROOT=/ProfyPlan
```

Основной режим — OAuth (см. 3.2): access token не персистится, а refresh token хранится в БД только в зашифрованном виде (`CLOUD_TOKEN_ENCRYPTION_KEY`). Серверный токен из env остаётся аварийным/локальным вариантом.

## 3.1. Google Drive

Для Google Drive ID папок больше не вводятся пользователем: сервер находит или создаёт корень с именем из `settings.cloud.root_name` (по умолчанию `ProfyPlan`) и канонические папки, после чего сохраняет ID в `settings.cloud`:

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

Имя корневой папки задаёт пользователь в подключении. Если папки с таким именем нет, она создаётся; если есть — используется существующая. Доступ получается через OAuth (см. 3.2); access token не хранится, refresh token — только в зашифрованном виде. Загрузка идёт multipart, перемещение — через `addParents/removeParents`. Используется scope `drive`, чтобы видеть корневую папку, созданную стороной 1С и расшаренную ProfyPlan; `drive.file` для этого не подходит.

## 3.2. OAuth-подключение (Яндекс Диск и Google Drive)

Пользователь один раз нажимает «Подключить», входит в аккаунт провайдера и подтверждает доступ. ProfyPlan обменивает authorization code на access/refresh token, создаёт папки и дальше обновляет access token автоматически. Клиентские ключи OAuth-приложений задаются один раз на сервере:

```dotenv
YANDEX_OAUTH_CLIENT_ID=...
YANDEX_OAUTH_CLIENT_SECRET=...
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
CLOUD_OAUTH_CALLBACK_URL=https://profyplan.ru/api/v1/integration/cloud/oauth/callback
CLOUD_OAUTH_SUCCESS_URL=https://profyplan.ru/workspace
CLOUD_TOKEN_ENCRYPTION_KEY=...
```

Redirect URI в кабинетах Яндекс OAuth и Google Cloud должен совпадать с `CLOUD_OAUTH_CALLBACK_URL`. Для Google используется `access_type=offline`, `prompt=consent` и scope `https://www.googleapis.com/auth/drive` (shared-папка 1С); для Яндекс Диска — `cloud_api:disk.read`, `cloud_api:disk.write`, `cloud_api:disk.info`. Refresh token хранится в `settings.cloud.oauth.refresh_token_enc` в зашифрованном виде; открытый токен в API и браузер не возвращается. Состояние OAuth подписано JWT и живёт 15 минут.

`drive` — restricted scope: для внешних пользователей Google потребует верификацию приложения. Это осознанный выбор ради shared-папки, созданной стороной 1С. Если папку создаёт только ProfyPlan, можно вернуться к `drive.file` через `GOOGLE_OAUTH_SCOPE`.

## 3.3. Совместимость с расширением 1С 0.9.0

- 1С использует отдельные OAuth-приложения и отдельные комплекты настроек для Яндекс Диска и Google Диска. В ProfyPlan один объект подключения ведёт один провайдер; для параллельной работы с двумя облаками создайте два подключения.
- Корневую папку может создать 1С или ProfyPlan. Если владелец — 1С, папка должна быть расшарена аккаунту ProfyPlan с правом «Редактор»; ProfyPlan ищет её по имени и не создаёт дубль. Для Google это требует scope `drive`.
- Ошибочные входящие файлы ProfyPlan переносит в `archive/ГГГГ-ММ` — так же, как 1С.
- Имена пакетов с `packet_id` и без него принимаются; ключ — `packet_id` внутри JSON.

## 4. API

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/v1/integration/connections/{id}/cloud/status` | Провайдер, корень, наличие токена, список папок |
| POST | `/v1/integration/connections/{id}/cloud/check` | Создать канонические папки и проверить доступ |
| POST | `/v1/integration/connections/{id}/cloud/poll` | Принять `1c_to_plan`, выгрузить новый `out` в `plan_to_1c` |
| GET | `/v1/integration/connections/{id}/cloud/oauth/start?provider=yandex|google` | Получить URL согласия провайдера |
| GET | `/v1/integration/cloud/oauth/callback` | Принять code, сохранить refresh token и создать папки |

`cloud/poll` можно вызывать вручную; встроенный планировщик опрашивает активные подключения по интервалу 1–60 минут. Одновременный опрос защищён PostgreSQL advisory-lock.

## 5. Поведение

- Успешно разобранный файл переносится в `processed/1c_to_plan`.
- Файл с ошибкой разбора переносится в `archive/ГГГГ-ММ` (месяц создания архива, как на стороне 1С); ошибка пишется в журнал обмена.
- Исходящие файлы перед загрузкой хешируются; повторная загрузка того же содержимого не выполняется (`settings.cloud_out_sent`).
- Ссылки на скачивание и загрузку принимаются только по HTTPS.
- Имена файлов нормализуются; пустые и скрытые имена пропускаются.

## 6. Проверка

- Мок-тест `apps/api/tests/test_cloud_exchange.py`: создание папок, upload, list, download, move.
- Smoke в контейнере: `cloud client smoke ok`.
- Импорт роутера: три cloud-маршрута присутствуют.
- Живой прогон с токеном Яндекс Диска — после выдачи токена и тестовой папки.

## 7. Ограничения первого среза

- Пользователь вводит только провайдера и интервал; OAuth-ключи приложения и шифрование токенов настраиваются владельцем один раз на сервере. Папки создаются автоматически.
- В окне подключения выберите транспорт «Облачный обмен», нажмите «Подключить» и подтвердите доступ; на странице «Интеграция» доступны статус, проверка доступа и ручной опрос.
- Встроенный планировщик опрашивает активные облачные подключения по интервалу; несколько API-воркеров защищены advisory-lock PostgreSQL.
- Google OAuth-приложение должно быть In production/Internal: в Testing refresh token живёт 7 дней.
