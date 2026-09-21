import fs from 'node:fs';
const BASE = 'http://localhost:8000';
const projId = '93dd15c9-1370-48d6-8843-efdf3f6eb517';
const orderId = '8707dc41-153d-4fb5-a6e6-3bb24a71ff41';
const dir = 'C:/Users/user/.openclaw-autoclaw/agents/auto-designer/workspace/profyplan/apps/web/.openclaw/tmp/cpm-lab';

const login = await (await fetch(BASE + '/v1/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'planner@demo.ru', password: 'demo123' }),
})).json();
const H = { Authorization: 'Bearer ' + login.access_token, 'X-Tenant-Id': login.tenants[0].id };

const deps = await (await fetch(`${BASE}/v1/projects/${projId}/operations/dependencies-map`, { headers: H })).json();
const cpm = await (await fetch(`${BASE}/v1/projects/${projId}/calculate/cpm`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: '{}' })).json();
const cpmOrder = await (await fetch(`${BASE}/v1/projects/${projId}/calculate/cpm`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ order_id: orderId }) })).json();

fs.writeFileSync(dir + '/api-deps.json', JSON.stringify(deps));
fs.writeFileSync(dir + '/api-cpm.json', JSON.stringify(cpm));
fs.writeFileSync(dir + '/api-cpm-mt211.json', JSON.stringify(cpmOrder));
console.log('deps=' + deps.items.length + ' cpmNodes=' + cpm.nodes.length + ' order=' + (cpmOrder.order_id || '-') + ' orderNodes=' + cpmOrder.nodes.length);
console.log('node0 name=' + cpm.nodes[0].name);
