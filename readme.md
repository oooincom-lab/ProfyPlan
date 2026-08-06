# ProfyPlan

Облачный сервис производственного планирования под заказ (Make-to-Order).
CPM, PERT и CCM в одном интерфейсе.

## Стек

| Слой | Технология |
|------|-----------|
| Фронтенд | Next.js 14 + TypeScript + Tailwind CSS |
| Бэкенд | FastAPI + Python 3.12 + PostgreSQL 15 |
| Аутентификация | JWT + bcrypt |
| Платежи | ЮKassa + СБП |
| DevOps | Docker Compose + nginx + GitHub Actions |
| Хостинг | HandyHost VPS (31.184.198.113) |

## Production

- **Сайт:** https://profyplan.ru
- **План реализации:** https://profyplan.ru/plan.html
- **Delivery Report:** https://profyplan.ru/report.html
- **CCM Dashboard:** https://profyplan.ru/ccm-v2
- **Демо-доступ:** `planner@demo.ru` / `demo123`

## API Endpoints (v1)

| Группа | Эндпоинты |
|--------|----------|
| Auth | `POST /v1/auth/login` |
| Projects | CRUD `/v1/projects/` |
| Operations | CRUD `/v1/projects/{id}/operations/` |
| Resources | CRUD `/v1/resources/` |
| CPM | `POST /v1/projects/{id}/calculate/cpm` |
| CCM Multi-Project | `POST /v1/ccm/merge` |
| Resource Leveling | `POST /v1/ccm/level` |
| Forecast | `POST /v1/ccm/forecast` |
| Batch Scheduling | `GET /v1/ccm/projects/{id}/batch-scheduling` |
| Bottleneck Analysis | `GET /v1/ccm/projects/{id}/bottleneck` |
| Milestones | `GET /v1/ccm/projects/{id}/milestones` |
| PERT Analysis | `POST /v1/ccm/projects/{id}/pert` |
| Monte Carlo | `POST /v1/ccm/projects/{id}/monte-carlo` |
| Excel Export | `GET /v1/ccm/projects/{id}/export-excel` |
| Google Sheets Sync | `POST /v1/ccm/projects/{id}/sync-google-sheets` |

## Структура

```
profyplan/
├── apps/
│   ├── web/          # Next.js приложение
│   └── api/          # FastAPI приложение
├── nginx/            # nginx reverse-proxy конфигурация
├── test-data/        # Тестовые данные (BOM, production orders)
├── .github/          # CI/CD (GitHub Actions)
└── docker-compose.yml
```

## Быстрый старт (dev)

```bash
# Фронтенд
cd apps/web
npm install
npm run dev

# Бэкенд
cd apps/api
pip install -e ".[dev]"
uvicorn app.main:app --reload
```

## Деплой

```bash
# На VPS:
cd /opt/profyplan
git pull
docker compose build
docker compose up -d
```

## Требуются учётные данные

- **Google Sheets Sync:** переменная `GOOGLE_SHEETS_CREDENTIALS_JSON` в `docker-compose.yml` (JSON-ключ сервисного аккаунта Google Cloud)
- **CI/CD:** GitHub Secrets: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`

## Лицензия

Copyright © 2026 ProfyPlan. Все права защищены.
