param(
    [string]$Thumbprint,
    [string]$PfxPath,
    [string]$PfxPassword,
    [string]$TimestampUrl = "http://timestamp.digicert.com",
    [string[]]$Files
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dist = Join-Path $root "dist"

if (-not $Files -or $Files.Count -eq 0) {
    $Files = @(
        (Join-Path $dist "ProfyPlanCompanion.exe"),
        (Join-Path $dist "ProfyPlanCompanionSetup.exe")
    )
    $Files += @(Get-ChildItem $dist -Filter "ProfyPlanCompanion-*.msi" -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
}
$Files = @($Files | Where-Object { Test-Path $_ })
if ($Files.Count -eq 0) {
    throw "Нет файлов для подписи. Соберите EXE/Setup/MSI."
}
if (-not $Thumbprint -and -not $PfxPath) {
    throw "Укажите -Thumbprint (сертификат в хранилище) или -PfxPath/-PfxPassword. Код-сертификат в комплект не входит."
}

$signtool = (Get-Command signtool.exe -ErrorAction SilentlyContinue).Source
if (-not $signtool) {
    $kits = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
    if (Test-Path $kits) {
        $signtool = (Get-ChildItem $kits -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -match "x64" } |
            Select-Object -First 1).FullName
    }
}
if (-not $signtool) {
    throw "signtool.exe не найден. Установите Windows SDK (Signing Tools) или задайте PATH."
}

foreach ($file in $Files) {
    Write-Host "Подпись: $file" -ForegroundColor Cyan
    $signArgs = @("sign", "/fd", "SHA256", "/tr", $TimestampUrl, "/td", "SHA256")
    if ($Thumbprint) {
        $signArgs += @("/sha1", $Thumbprint, "/a")
    } else {
        $signArgs += @("/f", $PfxPath)
        if ($PfxPassword) { $signArgs += @("/p", $PfxPassword) }
    }
    $signArgs += $file
    & $signtool @signArgs
    if ($LASTEXITCODE -ne 0) { throw "Ошибка подписи: $file" }
    & $signtool verify /pa /v $file
    if ($LASTEXITCODE -ne 0) { throw "Ошибка проверки подписи: $file" }
}
Write-Host "Подписано файлов: $($Files.Count)" -ForegroundColor Green
