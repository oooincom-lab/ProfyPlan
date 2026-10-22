param(
    [string]$Name = "ProfyPlanCompanion"
)

$ErrorActionPreference = "Stop"
$source = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "Сборка $Name..." -ForegroundColor Cyan
python -m pip install --upgrade pyinstaller | Out-Host
python -m PyInstaller --noconfirm --clean --onefile --console --name $Name --hidden-import tray --hidden-import pystray._win32 --collect-submodules pystray --distpath (Join-Path $source "dist") --workpath (Join-Path $source "build") (Join-Path $source "agent.py")
if ($LASTEXITCODE -ne 0) { throw "PyInstaller завершился с ошибкой" }
$out = Join-Path (Join-Path $source "dist") "$Name.exe"
Write-Host "Built: $out" -ForegroundColor Green
Write-Host "Sign the EXE with a code-signing certificate before giving it to a client." -ForegroundColor Yellow
