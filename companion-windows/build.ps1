param(
    [string]$Name = "ProfyPlanCompanion"
)

$ErrorActionPreference = "Stop"
$source = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "Сборка $Name..." -ForegroundColor Cyan
python -m pip install --upgrade pyinstaller | Out-Host
$common = @("--noconfirm","--clean","--onefile","--hidden-import","tray","--hidden-import","service","--hidden-import","pystray._win32","--collect-submodules","pystray","--add-data","$source\settings.ps1;.","--add-data","$source\info.ps1;.","--add-data","$source\vendor\winsw.exe;vendor")
python -m PyInstaller @common --console --name $Name --distpath (Join-Path $source "dist") --workpath (Join-Path $source "build") (Join-Path $source "agent.py")
if ($LASTEXITCODE -ne 0) { throw "PyInstaller CLI failed" }
$setupCommon = $common + @("--add-data", "$source\dist\$Name.exe;payload")
python -m PyInstaller @setupCommon --windowed --name "ProfyPlanCompanionSetup" --distpath (Join-Path $source "dist") --workpath (Join-Path $source "build-setup") (Join-Path $source "agent.py")
if ($LASTEXITCODE -ne 0) { throw "PyInstaller setup failed" }
$out = Join-Path (Join-Path $source "dist") "$Name.exe"
Write-Host "Built: $out" -ForegroundColor Green
Write-Host "Sign the EXE with a code-signing certificate before giving it to a client." -ForegroundColor Yellow
