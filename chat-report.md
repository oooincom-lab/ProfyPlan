# ProfyPlan · Отчёт о выполненной работе

**Сессия:** 06.08.2026 · **Проект:** ooooincom-lab/ProfyPlan · **VPS:** profyplan.ru

---

## 1. Исходное состояние на входе в сессию

Проект был заявлен как «17/17 этапов = 100%», но при проверке обнаружено:

- **Git был пуст** — ни один из 47 изменённых файлов не был закоммичен и запушен
- **План и отчёт не открывались** — nginx не отдавал plan.html и report.html (возвращал 404)
- **Фронтенд не работал** — CCM-дашборд показывал «Failed to fetch» при логине

---

## 2. Что сделано

### 2.1 Git — код в репозитории

5 коммитов запушено в master:

| Коммит | Описание |
|---|---|
| `86e70e1` | v1.0: полный код — APS Engine, PERT/Monte Carlo, Excel export, Google Sheets sync, CI/CD (47 файлов, +7957 строк) |
| `c6e5b68` | nginx: статические location для plan.html и report.html |
| `3efb529` | Фронтенд: API_URL исправлен на profyplan.ru/api; nginx: +api HTTPS server-block |
| `cf4f24b` | README: полная документация (API-таблица, деплой, ссылки, credentials) |
| `7a654cd` | Delivery Report v1.0: git-история, эндпоинты, баги, доступы |

### 2.2 Nginx — статические страницы

**Проблема:** plan.html и report.html возвращали 404. Nginx проксировал всё в Next.js, который не знал об этих файлах. `root /opt/profyplan` не существовал внутри контейнера.

**Решение:**
- Добавлены `location = /plan.html` и `location = /report.html` с `root /usr/share/nginx/html` в оба server-блока (HTTP + HTTPS)
- Файлы скопированы внутрь nginx-контейнера через `docker cp`
- После пересборки web-контейнера файлы скопированы заново

### 2.3 Фронтенд — CCM Dashboard

**Проблема:** `.env.local` указывал `NEXT_PUBLIC_API_URL=https://api.profyplan.ru`, но SSL-сертификат не покрывает поддомен api.profyplan.ru. Запросы шли в Next.js → 404 → «Failed to fetch».

**Решение:**
- `NEXT_PUBLIC_API_URL` изменён на `https://profyplan.ru/api`
- Web-контейнер пересобран (`docker compose build web && docker compose up -d web`)
- Проверено: логин работает, проекты загружаются, merge отрабатывает

### 2.4 E2E-проверка Multi-Project Merge

- Merge API проверен через curl: 2 проекта → **28 узлов, 6 в критическом пути**
- Формат запроса подтверждён: фронтенд шлёт `JSON.stringify(projectIds)` — сырой массив, API принимает корректно

### 2.5 Документация

- **README.md** — полный: production-ссылки, таблица 18 API-эндпоинтов, инструкция по деплою, список необходимых credentials
- **delivery-report.html** — итоговый отчёт (10 Kb): git-история, эндпоинты, 5 исправленных багов, доступы, ожидающие действия
- **MEMORY.md** — обновлён знаниями о проекте, nginx, PowerShell

### 2.6 VPS — обслуживание

- Удалены временные файлы (`/tmp/*b64.txt`, `/tmp/nginx_*.txt`)
- Удалены старые logo-*.html (7 файлов)
- Диск: 8.6G / 58G (16%)

---

## 3. Исправленные баги

| Баг | Причина | Исправление |
|---|---|---|
| `node.slack` AttributeError | Поле в модели называется `total_float` | `slack` → `total_float` в excel_export.py |
| `scalar_one_or_none()` ResourceClosedError | Двойной вызов | Убран повторный вызов |
| План: проценты 0% вместо 100% | CSS-класс `tag-done` был, но текст процентов не обновлён | Исправлены текстовые проценты |
| Фронтенд «Failed to fetch» | api.profyplan.ru без HTTPS | URL → profyplan.ru/api |
| План/отчёт 404 | nginx root не в контейнере | root + docker cp в контейнер |

---

## 4. Текущее состояние

```
GitHub:      5 коммитов, working tree clean
VPS:         5 контейнеров healthy (api, web, nginx, db, redis)
API:         18 эндпоинтов — все 200 (кроме GSheets — ждёт ключ)
Фронтенд:    CCM Dashboard работает
План:        plan.html — все задачи 100%
Отчёт:       delivery-report.html v1.0
БД:          5 проектов, 97 операций, 28 ресурсов
```

### Ссылки
- https://profyplan.ru — лендинг
- https://profyplan.ru/ccm-v2 — CCM-дашборд
- https://profyplan.ru/plan.html — план реализации
- https://profyplan.ru/report.html — delivery report
- https://github.com/oooincom-lab/ProfyPlan — репозиторий
- Доступ: `planner@demo.ru` / `demo123`

---

## 5. Ожидает владельца

| Пункт | Что нужно |
|---|---|
| Google Sheets Sync | Добавить `GOOGLE_SHEETS_CREDENTIALS_JSON` в docker-compose.yml (JSON-ключ сервисного аккаунта Google Cloud) |
| CI/CD Pipeline | Добавить GitHub Secrets: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` |

---

*06.08.2026 · ProfyPlan v1.0 · HandyHost VPS (31.184.198.113)*
