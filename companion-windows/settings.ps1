param(
    [Parameter(Mandatory = $true)][string]$ConfigPath,
    [string]$Version = ""
)

$ErrorActionPreference = "Stop"
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

$cfg = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$form = New-Object System.Windows.Forms.Form
$form.Text = "ProfyPlan Companion — Настройки"
$form.ClientSize = New-Object System.Drawing.Size(640, 560)
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
Add-Text $header "Настройки обмена с 1С · УНФ" 94 48 420 22 9 "#93C5FD" | Out-Null
if ($Version) {
    $ver = Add-Text $header ("v" + $Version) 500 24 116 24 10 "#93C5FD" "Bold"
    $ver.TextAlign = "MiddleRight"
}

$content = New-Object System.Windows.Forms.Panel
$content.Left = 0; $content.Top = 92; $content.Width = 640; $content.Height = 468
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

$status = Add-Text $content "" 24 396 592 28 9 "#B91C1C"
$status.Visible = $false

$save = New-Object System.Windows.Forms.Button
$save.Text = "Сохранить"
$save.Left = 378; $save.Top = 420; $save.Width = 120; $save.Height = 38
$save.FlatStyle = "Flat"; $save.FlatAppearance.BorderSize = 0
$save.BackColor = C "#2563EB"; $save.ForeColor = [System.Drawing.Color]::White
$save.Font = F 10 "Bold"; $save.Cursor = "Hand"
$content.Controls.Add($save)
$cancel = New-Object System.Windows.Forms.Button
$cancel.Text = "Отмена"
$cancel.Left = 506; $cancel.Top = 420; $cancel.Width = 110; $cancel.Height = 38
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
        $json = $cfg | ConvertTo-Json -Depth 8
        [System.IO.File]::WriteAllText($ConfigPath, $json, (New-Object System.Text.UTF8Encoding($false)))
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

$form.AcceptButton = $save
$form.CancelButton = $cancel
[void]$form.ShowDialog()
