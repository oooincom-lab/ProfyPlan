param(
    [string]$InstallDir = "$env:LOCALAPPDATA\ProfyPlanCompanion",
    [string]$ConfigPath = "$env:LOCALAPPDATA\ProfyPlan\companion.json",
    [string]$PythonExe = "",
    [int]$IntervalMinutes = 5,
    [string]$TaskName = "ProfyPlan Companion",
    [switch]$Tray,
    [switch]$NoTask
)

$ErrorActionPreference = "Stop"
$source = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "ProfyPlan Companion - install" -ForegroundColor Cyan

if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}
Copy-Item (Join-Path $source "agent.py") (Join-Path $InstallDir "agent.py") -Force
Copy-Item (Join-Path $source "README.md") (Join-Path $InstallDir "README.md") -Force
Copy-Item (Join-Path $source "config.example.json") (Join-Path $InstallDir "config.example.json") -Force
$srcExe = Join-Path $source "ProfyPlanCompanion.exe"
if (-not (Test-Path $srcExe)) { $srcExe = Join-Path $source "dist\ProfyPlanCompanion.exe" }
if (Test-Path $srcExe) { Copy-Item $srcExe (Join-Path $InstallDir "ProfyPlanCompanion.exe") -Force }

$exe = Join-Path $InstallDir "ProfyPlanCompanion.exe"
if (-not (Test-Path $exe)) { $exe = "" }

$PythonConsole = $PythonExe
$PythonWindow = $PythonExe
if (-not $PythonConsole) {
    $pc = Get-Command python.exe -ErrorAction SilentlyContinue
    if (-not $pc) { throw "Python not found. Install Python 3.11+ or build EXE first." }
    $PythonConsole = $pc.Source
}
if (-not $PythonWindow) {
    $pw = Get-Command pythonw.exe -ErrorAction SilentlyContinue
    $PythonWindow = if ($pw) { $pw.Source } else { $PythonConsole }
}

if (-not (Test-Path $ConfigPath)) {
Write-Host "Initial setup (email, password, connection, folder):" -ForegroundColor Yellow
    if ($exe) {
        & $exe init --config $ConfigPath
    } else {
        & $PythonConsole (Join-Path $InstallDir "agent.py") init --config $ConfigPath
    }
    if ($LASTEXITCODE -ne 0) { throw "Setup was not completed" }
}

if ($NoTask) {
Write-Host "Windows task was not created (-NoTask)." -ForegroundColor Yellow
    exit 0
}

$mode = if ($Tray) { "tray" } else { "run" }
$program = if ($exe) { $exe } else { $PythonWindow }
$arguments = if ($exe) {
    "$mode --config `"$ConfigPath`""
} else {
    "`"$InstallDir\agent.py`" $mode --config `"$ConfigPath`""
}

$action = New-ScheduledTaskAction -Execute $program -Argument $arguments
$logon = New-ScheduledTaskTrigger -AtLogOn
$repeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) `
    -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

$triggers = if ($Tray) { @($logon) } else { @($logon, $repeat) }
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Description "ProfyPlan file exchange" -Force | Out-Null

Write-Host "Done. Task $TaskName created." -ForegroundColor Green
Write-Host "Check: $program $arguments" -ForegroundColor DarkGray
Write-Host "Run one cycle: $program $arguments" -ForegroundColor DarkGray
