# Изменения безопасности на VPS — 21.10.2026

## Сервер
- Хост: 31.184.198.113 (symtest.example.com), публичный домен: profyplan.ru
- Проект: ProfyPlan (docker-compose: profyplan-web, profyplan-api, profyplan-nginx, profyplan-db, profyplan-redis)

## Что изменено
1. **RDP (xrdp, порт 3389)** — остановлен и убран из автозапуска. Порт больше не слушается.
2. **Файрвол iptables** — политика INPUT DROP. Разрешены только: 22 (SSH), 80 (HTTP), 443 (HTTPS), ICMP, loopback, established/related.
3. **SSH** — `PasswordAuthentication no`. Вход только по ключу.
4. **SSH** — `PermitRootLogin prohibit-password`. root только по ключу.
5. Правила сохранены: `/etc/iptables/rules.v4` + systemd unit `iptables-restore.service` (enabled) — выживают перезагрузку.

## Важно для деплоя и работы с сервером
- Вход по паролю SSH НЕ работает — только ключи.
- Ключи в `/root/.ssh/authorized_keys`: `dev@profyplan.ru`, `profyplan-deploy`, `profyplan-reserve`.
- Подключение: `ssh -i <key> root@31.184.198.113`
- RDP (удалённый рабочий стол) недоступен.
- Порты БД (5432), Redis (6379), API (8000), web (3000) — только localhost, как и было.

## Не делать без согласования
- Не включать обратно xrdp / порт 3389.
- Не ослаблять iptables (INPUT DROP) — это защита от брутфорса.
- Не включать `PasswordAuthentication` — вернёт брутфорс.

## Бэкапы для отката
- `/root/iptables-backup-2026-10-21-175429.rules`
- `/etc/ssh/sshd_config.bak-*`

## Инцидент
21.10.2026 получено уведомление от HandyHost о критической уязвимости панели управления. Проведён аудит сервера: следов компрометации не найдено (пользователи UID 0, authorized_keys, cron, процессы, изменённые файлы — чисто). Закрыты векторы: открытый RDP, SSH по паролю, отсутствие файрвола.

## Не сделано (ожидает решения владельца)
- Перевыпуск секретов приложения: `JWT_SECRET_KEY`, `DB_PASSWORD`, `SMTP_PASSWORD`.
