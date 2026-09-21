$ErrorActionPreference = 'Stop'
$base = 'http://localhost:8000'
$body = @{ email='planner@demo.ru'; password='demo123' } | ConvertTo-Json
$r = Invoke-RestMethod -Method Post -Uri "$base/v1/auth/login" -ContentType 'application/json' -Body $body -TimeoutSec 40
$H = @{ Authorization = "Bearer $($r.access_token)"; 'X-Tenant-Id' = $r.tenants[0].id }
$projId = '93dd15c9-1370-48d6-8843-efdf3f6eb517'
$orderId = '8707dc41-153d-4fb5-a6e6-3bb24a71ff41'
$out = 'C:\Users\user\.openclaw-autoclaw\agents\auto-designer\workspace\profyplan\apps\web\.openclaw\tmp\cpm-lab'
$b = @{ order_id = $orderId } | ConvertTo-Json
$cpm = Invoke-RestMethod -Method Post -Uri "$base/v1/projects/$projId/calculate/cpm" -Headers $H -ContentType 'application/json' -Body $b -TimeoutSec 180
[IO.File]::WriteAllText("$out\api-cpm-mt211.json", ($cpm | ConvertTo-Json -Depth 8))
Write-Output ("MT2-1.1 nodes=" + $cpm.nodes.Count + " order_id=" + $cpm.order_id)
