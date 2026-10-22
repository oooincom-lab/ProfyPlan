param(
    [string]$Version = "0.7.1"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dist = Join-Path $root "dist"
$obj = Join-Path $root "build-msi"
$wxs = Join-Path $root "msi\Product.wxs"

if (-not (Test-Path (Join-Path $dist "ProfyPlanCompanion.exe"))) {
    throw "Сначала соберите ProfyPlanCompanion.exe через build.ps1"
}

$candle = (Get-Command candle.exe -ErrorAction SilentlyContinue).Source
$light = (Get-Command light.exe -ErrorAction SilentlyContinue).Source
if (-not $candle -or -not $light) {
    $base = Join-Path ${env:ProgramFiles(x86)} "WiX Toolset v3.14\bin"
    $candle = Join-Path $base "candle.exe"
    $light = Join-Path $base "light.exe"
}
if (-not (Test-Path $candle) -or -not (Test-Path $light)) {
    throw "WiX Toolset 3 не найден. Установите: winget install WiXToolset.WiXToolset"
}

New-Item -ItemType Directory -Force -Path $obj, $dist | Out-Null
$wixobj = Join-Path $obj "Product.wixobj"
$msi = Join-Path $dist ("ProfyPlanCompanion-{0}.msi" -f $Version)

& $candle -nologo "-dVersion=$Version" "-dSourceDir=$dist" -out $wixobj $wxs
if ($LASTEXITCODE -ne 0) { throw "candle failed" }
& $light -nologo -out $msi $wixobj
if ($LASTEXITCODE -ne 0) { throw "light failed" }
Write-Host "MSI: $msi" -ForegroundColor Green
Write-Host ('Для подписи: .\sign.ps1 -Thumbprint <thumbprint> -Files "' + $msi + '"') -ForegroundColor Yellow
