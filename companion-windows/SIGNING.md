# Подпись и MSI — ProfyPlan Companion

## 1. Текущее состояние

- EXE и Setup **не подписаны**: в `Cert:\CurrentUser\My` и `Cert:\LocalMachine\My` нет Code Signing сертификата.
- MSI собирается без подписи; Windows SmartScreen может предупредить.
- Код-сертификат в репозиторий не добавляется.

## 2. Что нужно для подписи

Один из вариантов:

1. **Сертификат в хранилище Windows** — OV/EV Code Signing, приватный ключ доступен; нужен thumbprint.
2. **PFX-файл** — путь и пароль; для CI хранить в секрете, не в git.
3. **Azure Trusted Signing / аппаратный токен** — подпись через их CLI/провайдера; `signtool` должен видеть сертификат.

Требования: SHA-256, timestamp, цепочка доверия; подписывать **EXE, Setup и MSI** одним сертификатом.

## 3. Сборка MSI

```powershell
winget install WiXToolset.WiXToolset   # один раз
cd profyplan\companion-windows
.\build.ps1
.\build-msi.ps1 -Version 0.7.1
```

Результат: `dist\ProfyPlanCompanion-0.7.1.msi`.

MSI ставит приложение per-user в `%LOCALAPPDATA%\Programs\ProfyPlanCompanion`, создаёт ярлык в меню «Пуск» и запись в «Установленные программы». При первом запуске ярлык открывает мастер привязки companion; после привязки приложение создаёт свой ярлык запуска в трее.

## 4. Подпись

Из хранилища:

```powershell
.\sign.ps1 -Thumbprint "THUMBPRINT"
```

Из PFX:

```powershell
.\sign.ps1 -PfxPath "C:\secure\profyplan-codesign.pfx" -PfxPassword "***"
```

Без параметров скрипт подпишет `ProfyPlanCompanion.exe`, `ProfyPlanCompanionSetup.exe` и все `ProfyPlanCompanion-*.msi` в `dist`.

После подписи проверить:

```powershell
signtool verify /pa /v dist\ProfyPlanCompanion-0.7.1.msi
```

## 5. Ограничения

- Пока сертификата нет, MSI/EXE остаются unsigned; это не блокирует установку, но SmartScreen предупреждает.
- MSI не содержит код привязки: его нужно получить в ProfyPlan и вставить в мастер (clipboard/`companion-setup.json`), как в Setup EXE.
- Для clean-machine теста нужен компьютер без Visual C++/Python; EXE должен запускаться автономно.
