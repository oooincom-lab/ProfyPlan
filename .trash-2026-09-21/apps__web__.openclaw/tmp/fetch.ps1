$ErrorActionPreference = 'Stop'
$base = 'http://localhost:8000'
$body = @{ email='planner@demo.ru'; password='demo123' } | ConvertTo-Json
$r = Invoke-RestMethod -Method Post -Uri "$base/v1/auth/login" -ContentType 'application/json' -Body $body -TimeoutSec 40
$tok = $r.access_token
$tid = $r.tenants[0].id
$H = @{ Authorization = "Bearer $tok"; 'X-Tenant-Id' = $tid }
$projId = '93dd15c9-1370-48d6-8843-efdf3f6eb517'
$out = 'C:\Users\user\.openclaw-autoclaw\agents\auto-designer\workspace\profyplan\apps\web\.openclaw\tmp\cpm-lab'

# deps
$deps = Invoke-RestMethod -Method Get -Uri "$base/v1/projects/$projId/operations/dependencies-map" -Headers $H -TimeoutSec 60
[IO.File]::WriteAllText("$out\api-deps.json", ($deps | ConvertTo-Json -Depth 6))

# cpm whole project
$cpm = Invoke-RestMethod -Method Post -Uri "$base/v1/projects/$projId/calculate/cpm" -Headers $H -ContentType 'application/json' -Body '{}' -TimeoutSec 180
[IO.File]::WriteAllText("$out\api-cpm.json", ($cpm | ConvertTo-Json -Depth 8))

# orders
$orders = Invoke-RestMethod -Method Get -Uri "$base/v1/production-orders/?project_id=$projId" -Headers $H -TimeoutSec 60
[IO.File]::WriteAllText("$out\api-orders.json", ($orders | ConvertTo-Json -Depth 6))

Write-Output ("deps=" + $deps.items.Count + " nodes=" + $cpm.nodes.Count + " orders=" + $orders.Count)
