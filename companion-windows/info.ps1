param(
    [Parameter(Mandatory = $true)][string]$InfoPath
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

$info = Get-Content -LiteralPath $InfoPath -Raw -Encoding UTF8 | ConvertFrom-Json
$isUpdate = ([string]$info.mode -eq "update")
$titleText = if ($isUpdate) { "Проверка обновления" } else { "О программе" }
$form = New-Object System.Windows.Forms.Form
$form.Text = "ProfyPlan Companion — " + $titleText
$form.ClientSize = New-Object System.Drawing.Size(640, 560)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedSingle"
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.BackColor = C "#F8FAFC"
$form.Font = F 9
$form.TopMost = $true
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
Add-Text $header "Модуль обмена данными" 94 48 420 22 9 "#93C5FD" | Out-Null
$brand = Add-Text $header "ProfyPlan" 500 24 116 24 10 "#93C5FD" "Bold"
$brand.TextAlign = "MiddleRight"

$content = New-Object System.Windows.Forms.Panel
$content.Left = 0; $content.Top = 92; $content.Width = 640; $content.Height = 468
$content.AutoScroll = $true; $content.BackColor = C "#F8FAFC"
$form.Controls.Add($content)

$status = [string]$info.status
$update = [bool]$info.update_available
$statusColor = if ($update) { "#B45309" } else { "#15803D" }
if ([string]$info.error) { $statusColor = "#B91C1C" }

if ($isUpdate) {
    $card = New-Card $content 18 154
    Add-Text $card "СОСТОЯНИЕ" 18 16 200 18 8 "#64748B" "Bold" | Out-Null
    Add-Text $card $status 18 38 556 32 16 $statusColor "Bold" | Out-Null
    Add-Text $card ("Текущая версия: " + [string]$info.current + "     ·     Доступна: " + $(if ([string]$info.latest) { [string]$info.latest } else { "—" })) 18 78 556 22 9 "#334155" | Out-Null
    Add-Text $card ("Проверено: " + [string]$info.checked_at) 18 106 556 20 8 "#64748B" | Out-Null
    if ([string]$info.notes) {
        $card2 = New-Card $content 188 112
        Add-Text $card2 "ЧТО НОВОГО" 18 14 200 18 8 "#64748B" "Bold" | Out-Null
        Add-Text $card2 ([string]$info.notes) 18 36 556 60 9 "#0F172A" | Out-Null
        $top = 316
    } else {
        $top = 188
    }
} else {
    $card = New-Card $content 18 214
    Add-Text $card "ПОДКЛЮЧЕНИЕ" 18 14 200 18 8 "#64748B" "Bold" | Out-Null
    Add-Text $card ("Версия: " + [string]$info.current) 18 36 260 22 10 "#0F172A" "Bold" | Out-Null
    Add-Text $card ("Подключение: " + [string]$info.connection_name) 18 66 556 22 9 "#334155" | Out-Null
    Add-Text $card ("Сервер: " + [string]$info.api_base) 18 94 556 22 9 "#334155" | Out-Null
    Add-Text $card ("Папка обмена: " + [string]$info.root_dir) 18 122 556 22 9 "#334155" | Out-Null
    Add-Text $card ("Интервал: " + [string]$info.interval_minutes + " мин") 18 150 556 22 9 "#334155" | Out-Null
    Add-Text $card ("Проверка обновлений: " + $status) 18 178 556 22 9 "#64748B" | Out-Null
    $card2 = New-Card $content 246 112
    Add-Text $card2 "О ПРОГРАММЕ" 18 14 200 18 8 "#64748B" "Bold" | Out-Null
    Add-Text $card2 "Универсальный модуль обмена файлами ProfyPlan с учётными системами. 1С:УНФ — один из коннекторов. Работает в трее, сохраняет настройки и обновляется автоматически." 18 36 556 64 9 "#334155" | Out-Null
    $top = 382
}

$buttonY = 400
$primary = New-Object System.Windows.Forms.Button
$primary.Top = $buttonY; $primary.Height = 38; $primary.Width = 190
$primary.Left = 240
$primary.FlatStyle = "Flat"; $primary.FlatAppearance.BorderSize = 0
$primary.BackColor = C "#2563EB"; $primary.ForeColor = [System.Drawing.Color]::White
$primary.Font = F 10 "Bold"; $primary.Cursor = "Hand"
$content.Controls.Add($primary)

$secondary = New-Object System.Windows.Forms.Button
$secondary.Top = $buttonY; $secondary.Height = 38; $secondary.Width = 140
$secondary.Left = 442
$secondary.FlatStyle = "Flat"; $secondary.FlatAppearance.BorderSize = 1
$secondary.FlatAppearance.BorderColor = C "#CBD5E1"
$secondary.BackColor = [System.Drawing.Color]::White; $secondary.ForeColor = C "#334155"
$secondary.Font = F 9
$secondary.Cursor = "Hand"
$content.Controls.Add($secondary)

$script:code = 0
if ($isUpdate -and $update) {
    $primary.Text = "Скачать и установить"
    $secondary.Text = "Проверить снова"
    $primary.Add_Click({ $script:code = 10; $form.Close() })
    $secondary.Add_Click({ $script:code = 11; $form.Close() })
} elseif ($isUpdate) {
    $primary.Text = "Проверить снова"
    $primary.Left = 240
    $secondary.Text = "Закрыть"
    $primary.Add_Click({ $script:code = 11; $form.Close() })
    $secondary.Add_Click({ $form.Close() })
} else {
    $primary.Text = "Проверить обновление"
    $secondary.Text = "Закрыть"
    $primary.Add_Click({ $script:code = 11; $form.Close() })
    $secondary.Add_Click({ $form.Close() })
}

# Всегда держим вторую кнопку справа от первой, без наложения.
$secondary.Left = $primary.Left + $primary.Width + 12
$form.AcceptButton = $primary
[void]$form.ShowDialog()
exit $script:code
