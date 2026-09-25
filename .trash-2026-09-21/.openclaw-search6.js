const fs = require('fs');
const f = 'apps/web/app/workspace/page.tsx';
const pats = [/login/, /password/, /profyplan_token/, /tenant/, /isAuthenticated/, /authState/, /useState\((true|false)\)/];
const l = fs.readFileSync(f, 'utf8').split(/\r?\n/);
l.forEach((x, i) => { if (pats.some(p => p.test(x))) console.log((i + 1) + ': ' + x.trim()); });
