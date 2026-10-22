param(
    [Parameter(Mandatory = $true)][string]$ConfigPath,
    [string]$Version = "",
    [string]$CliPath = ""
)

$ErrorActionPreference = "Stop"
$script:CliPath = $CliPath
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

function C([string]$hex) { return [System.Drawing.ColorTranslator]::FromHtml($hex) }
function F([double]$size, [string]$style = "Regular") {
    return New-Object System.Drawing.Font("Segoe UI", $size, [System.Drawing.FontStyle]::$style)
}
function Add-Text($parent, [string]$text, [int]$left, [int]$top, [int]$width, [int]$height, [double]$size = 9, [string]$color = "#0F172A", [string]$style = "Regular") {
    $l = New-Object System.Windows.Forms.Label
    $l.Text = $text
    $l.Left = $left; $l.Top = $top; $l.Width = $width; $l.Height = $height
    $l.Font = F $size $style
    $l.ForeColor = C $color
    $l.BackColor = [System.Drawing.Color]::Transparent
    $parent.Controls.Add($l)
    return $l
}
function New-Card($parent, [int]$top, [int]$height) {
    $p = New-Object System.Windows.Forms.Panel
    $p.Left = 24; $p.Top = $top; $p.Width = 592; $p.Height = $height
    $p.BackColor = [System.Drawing.Color]::White
    $p.BorderStyle = "FixedSingle"
    $parent.Controls.Add($p)
    return $p
}
function Style-Input($box) {
    $box.Font = F 10
    $box.BorderStyle = "FixedSingle"
    $box.BackColor = [System.Drawing.Color]::White
    $box.ForeColor = C "#0F172A"
}

function Get-CliPath {
    if ($script:CliPath -and (Test-Path -LiteralPath $script:CliPath)) { return $script:CliPath }
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA "Programs\ProfyPlanCompanion\ProfyPlanCompanionCli.exe"),
        (Join-Path (Split-Path -Parent $PSCommandPath) "ProfyPlanCompanionCli.exe")
    )
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
    throw "Не найден ProfyPlanCompanionCli.exe. Переустановите companion."
}

function Start-Tray {
    try {
        $cli = Get-CliPath
        $exe = Join-Path (Split-Path -Parent $cli) "ProfyPlanCompanion.exe"
        if (-not (Test-Path -LiteralPath $exe)) { return }
        $running = Get-CimInstance Win32_Process -Filter "Name='ProfyPlanCompanion.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -match "tray" }
        if (-not $running) {
            Start-Process -FilePath $exe -ArgumentList @("tray", "--config", $ConfigPath) -WindowStyle Hidden | Out-Null
        }
    } catch {
        # tray не должен мешать сохранению настроек
    }
}

function Get-TrayAutostart {
    try {
        $value = (Get-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "ProfyPlanCompanion" -ErrorAction SilentlyContinue).ProfyPlanCompanion
        return [bool]$value
    } catch {
        return $false
    }
}

function Set-TrayAutostart([bool]$Enabled) {
    $key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
    if ($Enabled) {
        $cli = Get-CliPath
        $exe = Join-Path (Split-Path -Parent $cli) "ProfyPlanCompanion.exe"
        if (-not (Test-Path -LiteralPath $exe)) { throw "Не найден ProfyPlanCompanion.exe." }
        New-Item -Path $key -Force | Out-Null
        $value = '"' + $exe + '" tray --config "' + $ConfigPath + '"'
        Set-ItemProperty -Path $key -Name "ProfyPlanCompanion" -Value $value
    } else {
        Remove-ItemProperty -Path $key -Name "ProfyPlanCompanion" -ErrorAction SilentlyContinue
    }
}

function Invoke-ServiceCli {
    param([string[]]$Arguments)
    $cli = Get-CliPath
    $proc = Start-Process -FilePath $cli -ArgumentList $Arguments -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ErrorAction Stop
    if ($proc.ExitCode -ne 0) {
        throw ("Команда службы завершилась с кодом " + $proc.ExitCode + ". Проверьте права администратора.")
    }
}

function Update-ServiceUi {
    $svc = Get-Service -Name "ProfyPlanCompanion" -ErrorAction SilentlyContinue
    if ($null -eq $svc) {
        $serviceState.Text = "Служба не установлена"
        $serviceState.ForeColor = C "#B45309"
        $serviceMode.Checked = $false
        $startService.Enabled = $true
        $startService.BackColor = C "#2563EB"
        $startService.ForeColor = [System.Drawing.Color]::White
        $stopService.Enabled = $false
        return
    }
    $serviceMode.Checked = $true
    if ($svc.Status -eq "Running") {
        $serviceState.Text = "Служба работает · автозапуск при загрузке"
        $serviceState.ForeColor = C "#15803D"
        $startService.Enabled = $false
        $startService.BackColor = C "#93C5FD"
        $startService.ForeColor = C "#EFF6FF"
        $stopService.Enabled = $true
    } else {
        $stateText = switch ([string]$svc.Status) {
            "Running" { "работает" }
            "Stopped" { "остановлена" }
            "StartPending" { "запускается" }
            "StopPending" { "останавливается" }
            default { [string]$svc.Status }
        }
        $serviceState.Text = ("Служба установлена · " + $stateText)
        $serviceState.ForeColor = C "#B45309"
        $startService.Enabled = $true
        $startService.BackColor = C "#2563EB"
        $startService.ForeColor = [System.Drawing.Color]::White
        $stopService.Enabled = $false
    }
}

$cfg = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$form = New-Object System.Windows.Forms.Form
$form.Text = "ProfyPlan Companion — Настройки"
$form.ClientSize = New-Object System.Drawing.Size(640, 748)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedSingle"
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.BackColor = C "#F8FAFC"
$form.Font = F 9
$form.AutoScaleMode = "Dpi"

$header = New-Object System.Windows.Forms.Panel
$header.Dock = "Top"; $header.Height = 92; $header.BackColor = C "#0F1E36"
$form.Controls.Add($header)
$logo = New-Object System.Windows.Forms.Panel
$logo.Left = 24; $logo.Top = 20; $logo.Width = 52; $logo.Height = 52
$logo.BackColor = C "#2563EB"
$header.Controls.Add($logo)
$logoText = Add-Text $logo "P" 0 4 52 44 24 "#FFFFFF" "Bold"
$logoText.TextAlign = "MiddleCenter"
Add-Text $header "ProfyPlan Companion" 92 18 420 30 16 "#FFFFFF" "Bold" | Out-Null
Add-Text $header "Настройки модуля обмена" 94 48 420 22 9 "#93C5FD" | Out-Null
if ($Version) {
    $ver = Add-Text $header ("v" + $Version) 500 24 116 24 10 "#93C5FD" "Bold"
    $ver.TextAlign = "MiddleRight"
}

$content = New-Object System.Windows.Forms.Panel
$content.Left = 0; $content.Top = 92; $content.Width = 640; $content.Height = 656
$content.AutoScroll = $true; $content.BackColor = C "#F8FAFC"
$form.Controls.Add($content)

$card1 = New-Card $content 18 154
Add-Text $card1 "ПОДКЛЮЧЕНИЕ" 18 14 200 18 8 "#64748B" "Bold" | Out-Null
Add-Text $card1 ([string]$cfg.connection_name) 18 38 556 24 11 "#0F172A" "Bold" | Out-Null
Add-Text $card1 ("ID: " + [string]$cfg.connection_id) 18 68 556 20 8 "#64748B" | Out-Null
Add-Text $card1 ([string]$cfg.api_base) 18 98 556 22 9 "#334155" | Out-Null
Add-Text $card1 "Подключение задаётся при установке и не редактируется здесь." 18 124 556 18 8 "#94A3B8" | Out-Null

$card2 = New-Card $content 188 206
Add-Text $card2 "ПАПКА ОБМЕНА" 18 14 200 18 8 "#64748B" "Bold" | Out-Null
$folder = New-Object System.Windows.Forms.TextBox
$folder.Left = 18; $folder.Top = 38; $folder.Width = 448; $folder.Height = 28
$folder.Text = [string]$cfg.root_dir
Style-Input $folder
$card2.Controls.Add($folder)
$browse = New-Object System.Windows.Forms.Button
$browse.Text = "Выбрать"
$browse.Left = 478; $browse.Top = 37; $browse.Width = 96; $browse.Height = 30
$browse.FlatStyle = "Flat"; $browse.FlatAppearance.BorderSize = 1
$browse.FlatAppearance.BorderColor = C "#CBD5E1"
$browse.BackColor = [System.Drawing.Color]::White; $browse.ForeColor = C "#334155"
$browse.Font = F 9; $browse.Cursor = "Hand"
$card2.Controls.Add($browse)
Add-Text $card2 "Внутри создаются папки in, out и processed." 18 74 556 18 8 "#94A3B8" | Out-Null

Add-Text $card2 "ИНТЕРВАЛ ОБМЕНА" 18 108 220 18 8 "#64748B" "Bold" | Out-Null
$interval = New-Object System.Windows.Forms.NumericUpDown
$interval.Left = 18; $interval.Top = 132; $interval.Width = 80; $interval.Height = 28
$interval.Minimum = 1; $interval.Maximum = 60
$interval.Value = [Math]::Max(1, [Math]::Min(60, [int]([double]$cfg.interval_seconds / 60)))
$interval.Font = F 10
$card2.Controls.Add($interval)
Add-Text $card2 "мин" 104 136 40 20 9 "#64748B" | Out-Null
Add-Text $card2 "Проверка входящих файлов и отправка исходящих." 150 136 420 20 8 "#94A3B8" | Out-Null

$card3 = New-Card $content 402 166
Add-Text $card3 "СЛУЖБА WINDOWS" 18 12 300 18 8 "#64748B" "Bold" | Out-Null
$serviceState = Add-Text $card3 "Проверка состояния..." 18 34 556 20 9 "#64748B"
$startService = New-Object System.Windows.Forms.Button
$startService.Text = "Запустить службу"
$startService.Left = 18; $startService.Top = 56; $startService.Width = 170; $startService.Height = 30
$startService.FlatStyle = "Flat"; $startService.FlatAppearance.BorderSize = 0
$startService.BackColor = C "#2563EB"; $startService.ForeColor = [System.Drawing.Color]::White
$startService.Font = F 9 "Bold"; $startService.Cursor = "Hand"
$card3.Controls.Add($startService)
$stopService = New-Object System.Windows.Forms.Button
$stopService.Text = "Остановить службу"
$stopService.Left = 198; $stopService.Top = 56; $stopService.Width = 180; $stopService.Height = 30
$stopService.FlatStyle = "Flat"; $stopService.FlatAppearance.BorderSize = 1
$stopService.FlatAppearance.BorderColor = C "#CBD5E1"
$stopService.BackColor = [System.Drawing.Color]::White; $stopService.ForeColor = C "#334155"
$stopService.Font = F 9; $stopService.Cursor = "Hand"
$card3.Controls.Add($stopService)
$serviceMode = New-Object System.Windows.Forms.CheckBox
$serviceMode.Text = "Запускать в виде службы"
$serviceMode.Left = 18; $serviceMode.Top = 94; $serviceMode.Width = 320; $serviceMode.Height = 24
$serviceMode.Font = F 9; $serviceMode.ForeColor = C "#0F172A"
$card3.Controls.Add($serviceMode)
$trayAutostart = New-Object System.Windows.Forms.CheckBox
$trayAutostart.Text = "Запускать в трее при запуске Windows"
$trayAutostart.Left = 18; $trayAutostart.Top = 118; $trayAutostart.Width = 400; $trayAutostart.Height = 22
$trayAutostart.Font = F 9; $trayAutostart.ForeColor = C "#0F172A"
$card3.Controls.Add($trayAutostart)
Add-Text $card3 "Снять галочку службы — остановить и удалить её. Нужны права администратора." 18 142 556 18 8 "#94A3B8" | Out-Null

$status = Add-Text $content "" 24 576 592 26 9 "#B91C1C"
$status.Visible = $false

$save = New-Object System.Windows.Forms.Button
$save.Text = "Сохранить"
$save.Left = 378; $save.Top = 610; $save.Width = 120; $save.Height = 38
$save.FlatStyle = "Flat"; $save.FlatAppearance.BorderSize = 0
$save.BackColor = C "#2563EB"; $save.ForeColor = [System.Drawing.Color]::White
$save.Font = F 10 "Bold"; $save.Cursor = "Hand"
$content.Controls.Add($save)
$cancel = New-Object System.Windows.Forms.Button
$cancel.Text = "Отмена"
$cancel.Left = 506; $cancel.Top = 610; $cancel.Width = 110; $cancel.Height = 38
$cancel.FlatStyle = "Flat"; $cancel.FlatAppearance.BorderSize = 1
$cancel.FlatAppearance.BorderColor = C "#CBD5E1"
$cancel.BackColor = [System.Drawing.Color]::White; $cancel.ForeColor = C "#334155"
$cancel.Font = F 9; $cancel.Cursor = "Hand"
$content.Controls.Add($cancel)

$browse.Add_Click({
    $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
    $dlg.SelectedPath = $folder.Text
    if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
        $folder.Text = $dlg.SelectedPath
    }
})
$startService.Add_Click({
    try {
        $svc = Get-Service -Name "ProfyPlanCompanion" -ErrorAction SilentlyContinue
        if ($null -eq $svc) {
            Invoke-ServiceCli @("install-service", "--config", $ConfigPath)
        } else {
            Invoke-ServiceCli @("start-service")
        }
        Update-ServiceUi
        Start-Tray
        $script:initialServiceMode = $true
        $status.ForeColor = C "#15803D"
        $status.Text = "Служба запущена. Она будет работать без входа пользователя."
        $status.Visible = $true
    } catch {
        $status.ForeColor = C "#B91C1C"
        $status.Text = "Не удалось запустить службу: " + $_.Exception.Message
        $status.Visible = $true
    }
})
$stopService.Add_Click({
    try {
        Invoke-ServiceCli @("stop-service")
        Update-ServiceUi
        Start-Tray
        $script:initialServiceMode = $true
        $status.ForeColor = C "#B45309"
        $status.Text = "Служба остановлена. Конфигурация сохранена."
        $status.Visible = $true
    } catch {
        $status.ForeColor = C "#B91C1C"
        $status.Text = "Не удалось остановить службу: " + $_.Exception.Message
        $status.Visible = $true
    }
})
$cancel.Add_Click({ $form.Close() })
$save.Add_Click({
    try {
        $root = $folder.Text.Trim()
        if (-not $root) { throw "Укажите папку обмена" }
        $rootPath = [System.IO.Path]::GetFullPath($root)
        [System.IO.Directory]::CreateDirectory($rootPath) | Out-Null
        foreach ($sub in @("in", "out", "processed")) {
            [System.IO.Directory]::CreateDirectory((Join-Path $rootPath $sub)) | Out-Null
        }
        $cfg.root_dir = $rootPath
        $cfg.in_dir = Join-Path $rootPath "in"
        $cfg.out_dir = Join-Path $rootPath "out"
        $cfg.processed_dir = Join-Path $rootPath "processed"
        $cfg.interval_seconds = [int]$interval.Value * 60
        $cfg | Add-Member -NotePropertyName tray_autostart -NotePropertyValue ([bool]$trayAutostart.Checked) -Force
        $json = $cfg | ConvertTo-Json -Depth 8
        [System.IO.File]::WriteAllText($ConfigPath, $json, (New-Object System.Text.UTF8Encoding($false)))
        if ($serviceMode.Checked -ne $script:initialServiceMode) {
            $svc = Get-Service -Name "ProfyPlanCompanion" -ErrorAction SilentlyContinue
            if ($serviceMode.Checked) {
                if ($null -eq $svc) {
                    Invoke-ServiceCli @("install-service", "--config", $ConfigPath)
                } else {
                    Invoke-ServiceCli @("start-service")
                }
            } elseif ($null -ne $svc) {
                Invoke-ServiceCli @("uninstall-service")
            }
            $script:initialServiceMode = $serviceMode.Checked
            Update-ServiceUi
        }
        Set-TrayAutostart ([bool]$trayAutostart.Checked)
        Start-Tray
        $status.ForeColor = C "#15803D"
        $status.Text = "Сохранено. Новые параметры применятся в следующем цикле."
        $status.Visible = $true
        Start-Sleep -Milliseconds 600
        $form.Close()
    } catch {
        $status.ForeColor = C "#B91C1C"
        $status.Text = "Ошибка: " + $_.Exception.Message
        $status.Visible = $true
    }
})

Update-ServiceUi
$trayAutostart.Checked = Get-TrayAutostart
$script:initialServiceMode = $serviceMode.Checked
$script:initialTrayAutostart = $trayAutostart.Checked
$form.AcceptButton = $save
$form.CancelButton = $cancel
[void]$form.ShowDialog()