param(
    [Parameter(Mandatory = $true)][string]$ConfigPath
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$cfg = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$form = New-Object System.Windows.Forms.Form
$form.Text = "ProfyPlan Companion — настройки"
$form.Size = New-Object System.Drawing.Size(600, 420)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.Font = New-Object System.Drawing.Font("Segoe UI", 9)

function Add-Label($text, $top) {
    $l = New-Object System.Windows.Forms.Label
    $l.Text = $text
    $l.Left = 18
    $l.Top = $top
    $l.Width = 150
    $form.Controls.Add($l)
    return $l
}

Add-Label "Подключение" 18 | Out-Null
$conn = New-Object System.Windows.Forms.TextBox
$conn.Left = 175; $conn.Top = 15; $conn.Width = 390
$conn.Text = [string]$cfg.connection_name + "  ·  " + [string]$cfg.connection_id
$conn.ReadOnly = $true
$form.Controls.Add($conn)

Add-Label "Адрес API" 58 | Out-Null
$api = New-Object System.Windows.Forms.TextBox
$api.Left = 175; $api.Top = 55; $api.Width = 390
$api.Text = [string]$cfg.api_base
$api.ReadOnly = $true
$form.Controls.Add($api)

Add-Label "Папка обмена" 98 | Out-Null
$folder = New-Object System.Windows.Forms.TextBox
$folder.Left = 175; $folder.Top = 95; $folder.Width = 300
$folder.Text = [string]$cfg.root_dir
$form.Controls.Add($folder)
$browse = New-Object System.Windows.Forms.Button
$browse.Text = "Выбрать…"
$browse.Left = 482; $browse.Top = 93; $browse.Width = 83
$form.Controls.Add($browse)

Add-Label "Интервал, минут" 141 | Out-Null
$interval = New-Object System.Windows.Forms.NumericUpDown
$interval.Left = 175; $interval.Top = 138; $interval.Width = 80
$interval.Minimum = 1
$interval.Maximum = 60
$interval.Value = [Math]::Max(1, [Math]::Min(60, [int]([double]$cfg.interval_seconds / 60)))
$form.Controls.Add($interval)

$hint = New-Object System.Windows.Forms.Label
$hint.Text = "Папка создаётся автоматически: in, out, processed. Пароль и токен здесь не меняются."
$hint.Left = 18; $hint.Top = 180; $hint.Width = 550; $hint.Height = 40
$hint.ForeColor = [System.Drawing.Color]::DimGray
$form.Controls.Add($hint)

$status = New-Object System.Windows.Forms.Label
$status.Left = 18; $status.Top = 230; $status.Width = 550; $status.Height = 40
$status.ForeColor = [System.Drawing.Color]::FromArgb(180, 30, 30)
$form.Controls.Add($status)

$browse.Add_Click({
    $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
    $dlg.SelectedPath = $folder.Text
    if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
        $folder.Text = $dlg.SelectedPath
    }
})

$save = New-Object System.Windows.Forms.Button
$save.Text = "Сохранить"
$save.Left = 380; $save.Top = 300; $save.Width = 90
$form.Controls.Add($save)

$cancel = New-Object System.Windows.Forms.Button
$cancel.Text = "Отмена"
$cancel.Left = 478; $cancel.Top = 300; $cancel.Width = 87
$form.Controls.Add($cancel)

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
        $status.ForeColor = [System.Drawing.Color]::FromArgb(20, 120, 60)
        $status.Text = "Сохранено. Приложение применит настройки в следующем цикле."
        Start-Sleep -Milliseconds 600
        $form.Close()
    } catch {
        $status.ForeColor = [System.Drawing.Color]::FromArgb(180, 30, 30)
        $status.Text = "Ошибка: " + $_.Exception.Message
    }
})

[void]$form.ShowDialog()
