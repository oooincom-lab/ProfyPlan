const fs = require('fs');
const f = 'apps/web/components/CpmGraph.tsx';
const pats = [/layoutFull/, /const layout\b/, /layout =/, /virtualInfo/, /drawnCrossings =/, /labelNudge =/, /cutMarkers/];
const l = fs.readFileSync(f, 'utf8').split(/\r?\n/);
l.forEach((x, i) => { if (pats.some(p => p.test(x))) console.log((i + 1) + ': ' + x.trim()); });
