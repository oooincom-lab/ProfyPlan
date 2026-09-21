$ErrorActionPreference = 'Stop'
$dir = 'C:\Users\user\.openclaw-autoclaw\agents\auto-designer\workspace\profyplan\apps\web\.openclaw\tmp\cpm-lab'
$base = 'http://localhost:8000'
$projId = '93dd15c9-1370-48d6-8843-efdf3f6eb517'
$orderId = '8707dc41-153d-4fb5-a6e6-3bb24a71ff41'

& curl.exe -s -X POST "$base/v1/auth/login" -H "Content-Type: application/json" --data-binary '{"email":"planner@demo.ru","password":"demo123"}' -o "$dir\login.json"
$login = Get-Content "$dir\login.json" -Raw | ConvertFrom-Json
$tok = $login.access_token
$tid = $login.tenants[0].id

& curl.exe -s "$base/v1/projects/$projId/operations/dependencies-map" -H "Authorization: Bearer $tok" -H "X-Tenant-Id: $tid" -o "$dir\api-deps.json"
& curl.exe -s -X POST "$base/v1/projects/$projId/calculate/cpm" -H "Authorization: Bearer $tok" -H "X-Tenant-Id: $tid" -H "Content-Type: application/json" --data-binary '{}' -o "$dir\api-cpm.json"
& curl.exe -s -X POST "$base/v1/projects/$projId/calculate/cpm" -H "Authorization: Bearer $tok" -H "X-Tenant-Id: $tid" -H "Content-Type: application/json" --data-binary ("{""order_id"":""" + $orderId + """}") -o "$dir\api-cpm-mt211.json"
Write-Output "fetched"
