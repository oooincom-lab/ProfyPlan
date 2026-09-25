const fs = require('fs');
const f = 'apps/web/components/CpmGraph.tsx';
const pats = [/drawnCrossings/, /computeDrawnCrossings/, /cpm-labels/, /cpm-metrics/, /cpm-layout/, /cpm-structure/, /labelNudge/, /from '\.\/cpm/, /from "\.\/cpm/];
const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
lines.forEach((l, i) => { if (pats.some(p => p.test(l))) console.log((i + 1) + ': ' + l.trim()); });
