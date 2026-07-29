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
| Хостинг | Vercel (фронт) + HandyHost VPS (бэк/БД) |

## Структура

```
profyplan/
├── apps/
│   ├── web/          # Next.js приложение
│   └── api/          # FastAPI приложение
├── docs/             # Документация
└── docker-compose.yml
```

## Быстрый старт

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

## Лицензия

Copyright © 2026 ProfyPlan. Все права защищены.
