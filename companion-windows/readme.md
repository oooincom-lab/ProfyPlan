# ProfyPlan Companion (Windows MVP)

**Версия:** 0.8.1 · **Описание модуля:** [ABOUT.md](ABOUT.md) · **История версий:** [VERSIONS.md](VERSIONS.md) · **Правила:** [DEVELOPMENT.md](DEVELOPMENT.md)

Универсальный файловый обмен ProfyPlan с учётными системами без браузера и без расширения. 1С:УНФ — первый коннектор. Companion работает как отдельный агент: читает `in`, отправляет пакеты в ProfyPlan, забирает `outbox` в `out`, переносит обработанное в `processed`.

## Зачем

- Работает без открытого браузера.
- Подходит для папки на сервере учётной системы (например, 1С) или сетевой папки (UNC).
- Один агент закрывает Windows; macOS-версия — следующий этап.
- Не требует Chrome Web Store и режима разработчика.

## Требования

- Windows 10/11 или Windows Server.
- Python 3.11+ для запуска из исходников **или** собранный `ProfyPlanCompanion.exe`.
- Для tray: `pip install pystray pillow` (входит в EXE).
- Доступ к API ProfyPlan по HTTPS.
- Учётная запись ProfyPlan с доступом к подключению обмена.

## Быстрый старт

```powershell
cd companion-windows
python agent.py init --api-base http://localhost:8000/v1
```

Мастер спросит email, пароль, подключение и папку обмена. Пароль шифруется Windows DPAPI и сохраняется в `%LOCALAPPDATA%\ProfyPlan\companion.json`.

Или привязка по коду из ProfyPlan (без email/пароля):

```powershell
python agent.py pair --api-base https://profyplan.ru/api/v1 --connection-id <UUID> --code <КОД>
```

Один цикл:

```powershell
python agent.py once
```

Постоянный цикл:

```powershell
python agent.py run
```

Статус:

```powershell
python agent.py status
```

С иконкой в трее (меню «Настройки» открывает окно, а не JSON):

```powershell
python agent.py tray
```

## Обновление

Tray проверяет `/companion/version.json` при запуске и раз в 6 часов. Пункты «Проверить обновление» и «Обновить» открывают окно с текущей/доступной версией, датой проверки и заметками. Если версия новее, по кнопке «Скачать и установить» приложение скачивает Setup, проверяет SHA-256 и запускает `--upgrade`; настройки и привязка сохраняются.

## Windows-служба

```powershell
# из установленного приложения, от администратора
ProfyPlanCompanion.exe install-service --config "%LOCALAPPDATA%\ProfyPlan\companion.json"
ProfyPlanCompanion.exe service-status
```

Служба `ProfyPlanCompanion` запускается автоматически до входа пользователя, конфиг лежит в `C:\ProgramData\ProfyPlanCompanion`, токен перешифрован машинным DPAPI. Подробности — [SERVICE.md](SERVICE.md).

## MSI

```powershell
winget install WiXToolset.WiXToolset
.\build.ps1
.\build-msi.ps1 -Version 0.7.1
```

`dist\ProfyPlanCompanion-0.7.1.msi` ставит приложение per-user и создаёт ярлык в меню «Пуск». MSI пока **не подписан**: нужен код-сертификат; после его получения — `.\sign.ps1 -Thumbprint <thumbprint>`.

## О программе

Пункт трея «О программе» показывает версию, подключение, сервер, папку обмена, интервал и статус обновления. Окна «Настройки», «О программе» и результат проверки оформлены в цветах ProfyPlan.

## Установка через Setup EXE

1. В ProfyPlan откройте окно подключения → «Создать код привязки».
2. Нажмите «Скачать установщик» — код скопируется в буфер.
3. Запустите `ProfyPlanCompanionSetup.exe`.
4. Установщик привяжет companion, поставит его в «Установленные программы», создаст ярлык и автозапуск в трее.

## Установка как задача Windows (legacy)

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```

Скрипт копирует агент в `%LOCALAPPDATA%\ProfyPlanCompanion`, запускает `init` (если конфига нет) и создаёт задачу «ProfyPlan Companion» с запуском при входе и повтором каждые 5 минут. Флаг `-Tray` создаёт задачу только на вход и запускает версию с иконкой в трее.

Для сервера учётной системы лучше запускать под сервисной учётной записью и с правами на папку обмена; задача должна работать без интерактивного входа. Это отдельная настройка, см. раздел «Ограничения».

## Структура папки

```
<root_dir>/
  in/            # учётная система кладёт входящие пакеты
  out/           # ProfyPlan кладёт исходящие
  processed/     # обработанные входящие
  state.json     # ключи обработанных файлов
  companion.log  # журнал
```

`in`, `out`, `processed` создаются автоматически.

## Что делает цикл

1. Логин в ProfyPlan по email/паролю; пароль расшифровывается DPAPI.
2. Захват lease на подключении: один активный обмен.
3. Отправка `in/*.json` через `/import-file`; успешный файл переносится в `processed`.
4. Получение `/outbox`, скачивание в `out`, подтверждение `ack`.
5. Освобождение lease.

Повторная обработка отсекается ключом `имя|размер|mtime` в `state.json`; серверный `packet_id` — вторая линия защиты.

## Безопасность

- Пароль хранится в DPAPI, не в открытом виде.
- Соединение только HTTPS (для локального стенда допускается HTTP).
- Агент не слушает входящие порты.
- Работает только с `in/out/processed` выбранной папки.
- Токен живёт в памяти процесса; в конфиг не пишется.

## Ограничения MVP

- Нет tray-интерфейса и мастера установки с подписью; установка через PowerShell.
- Нет pairing-кода: используется email/пароль и DPAPI.
- Нет автоперезапуска при ошибке — задача Windows повторяет запуск.
- Нет macOS-версии.
- Для серверной службы без входа пользователя нужен отдельный installer/служба.

## Сборка EXE

```powershell
powershell -ExecutionPolicy Bypass -File build.ps1
```

Результат — `dist\ProfyPlanCompanion.exe`. Для распространения клиенту EXE нужно подписать код-сертификатом, иначе Windows SmartScreen покажет предупреждение.

## Проверка

1. Положить `ping.json` в `in`.
2. `python agent.py once`.
3. Файл должен уйти в журнал ProfyPlan и переместиться в `processed`.
4. Сформировать исходящий пакет в ProfyPlan — файл должен появиться в `out`.
5. Запустить второй экземпляр — он должен получить «обмен занят».
