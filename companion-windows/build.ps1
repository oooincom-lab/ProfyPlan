param(
    [string]$Name = "ProfyPlanCompanion"
)

$ErrorActionPreference = "Stop"
$source = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "Сборка $Name..." -ForegroundColor Cyan
python -m pip install --upgrade pyinstaller | Out-Host
python -m PyInstaller --noconfirm --clean --onefile --console --name $Name --distpath (Join-Path $source "dist") --workpath (Join-Path $source "build") (Join-Path $source "agent.py")
if ($LASTEXITCODE -ne 0) { throw "PyInstaller завершился с ошибкой" }
Write-Host "Готово: $(Join-Path $source 'dist\'$Name'.exe')" -ForegroundColor Green
Write-Host "Перед передачей клиенту подпишите EXE код-сертификатом." -ForegroundColor Yellow
