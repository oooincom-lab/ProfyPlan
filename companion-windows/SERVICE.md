# Windows-служба ProfyPlan Companion

**Версия:** 0.8.3 · **Статус:** реализовано локально, требуется проверка на чистой машине

## 1. Зачем WinSW

Python-приложение нельзя напрямую зарегистрировать как Windows-службу через `sc create` — служба должна реализовывать Service Control Protocol, иначе Windows вернёт ошибку 1053. Companion использует **WinSW** (Windows Service Wrapper), который запускает штатный `ProfyPlanCompanion.exe run --config ...` как службу.

`winsw.exe` лежит в `companion-windows/vendor/` и включается в PyInstaller-сборку.

## 2. Установка

Требуются права администратора.

```powershell
ProfyPlanCompanionCli.exe install-service --config "C:\ProgramData\ProfyPlanCompanion\companion.json"
```

Или установщик:

```powershell
ProfyPlanCompanionSetup.exe --service
```

Или после обычной установки:

```powershell
ProfyPlanCompanion.exe install --config "%LOCALAPPDATA%\ProfyPlan\companion.json" --service
```

Служба:

- имя: `ProfyPlanCompanion`;
- запуск: `Automatic`, с задержкой;
- учётная запись: `LocalSystem`;
- каталог: `C:\ProgramData\ProfyPlanCompanion`;
- конфиг: `C:\ProgramData\ProfyPlanCompanion\companion.json`;
- лог: `C:\ProgramData\ProfyPlanCompanion\logs`.

## 3. Машинный DPAPI

Обычный конфиг шифрует agent token через DPAPI текущего пользователя. Служба работает под `LocalSystem`, поэтому при установке токен перешифровывается с флагом `CRYPTPROTECT_LOCAL_MACHINE` (`dpapi-machine:`) и сохраняется в ProgramData. Каталог закрывается ACL: SYSTEM и Administrators.

Это позволяет службе расшифровать токен после перезагрузки без входа пользователя. Цена — токен доступен администраторам машины; для production нужен отдельный secret manager/ACL-регламент.

## 4. Управление

```powershell
ProfyPlanCompanionCli.exe service-status
ProfyPlanCompanionCli.exe uninstall-service
ProfyPlanCompanionCli.exe uninstall-service --purge
```

`uninstall-service` без `--purge` оставляет конфиг и логи; `--purge` удаляет файлы службы.

## 5. Обновление

Обычный `--upgrade`:

1. проверяет службу;
2. останавливает её (нужен администратор);
3. обновляет EXE и конфиг;
4. переустанавливает/запускает службу.

Если служба установлена, обновление из tray без прав администратора не сможет заменить EXE — нужен запуск установщика от администратора. Это ограничение Windows, не баг companion.

## 6. Ограничения

- Служба работает под LocalSystem; сетевые папки с другими учётными данными требуют отдельной настройки.
- Agent token имеет срок; после истечения нужна повторная привязка/обновление токена.
- Clean-machine тест и подпись EXE/MSI ещё не выполнены.
- UI управления службой пока через команды; отдельное окно — следующий этап.
