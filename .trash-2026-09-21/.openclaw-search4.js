const fs = require('fs');
const f = 'apps/web/app/workspace/page.tsx';
const pats = [/CpmGraph/, /cpmResult/, /cpmOps/, /mapOps/, /dependencies-map/, /calculate\/cpm/, /order_id/, /period/i, /Полигон/];
const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
lines.forEach((l, i) => { if (pats.some(p => p.test(l))) console.log((i + 1) + ': ' + l.trim()); });
