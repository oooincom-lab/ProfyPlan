const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');
const startMark = 'function computeLayout(ops: GOp[], deps: [string, string][], mode: Mode): Layout {';
const endMark = '/* ─────────────────────────── компонент ─────────────────────────── */';
const i = s.indexOf(startMark);
const j = s.indexOf(endMark);
if (i < 0 || j < 0 || j < i) { console.error('markers not found', i, j); process.exit(1); }
const stub = `function computeLayout(ops: GOp[], deps: [string, string][], mode: Mode): Layout {
  // Раскладка вынесена в чистый модуль @/lib/cpm-layout: колонки по датам/слоям,
  // упорядочивание внутри колонки (барицентр), локальные улучшения по счётчику
  // качества (перестановки соседних узлов) и подтяжка узла к средней линии соседей.
  return buildCpmLayout(ops, deps, mode);
}

`;
s = s.slice(0, i) + stub + s.slice(j);
// add import after the cpm-metrics import block
const impAfter = "} from '@/lib/cpm-metrics';";
const impIdx = s.indexOf(impAfter);
if (impIdx < 0) { console.error('import anchor not found'); process.exit(1); }
const insertAt = impIdx + impAfter.length;
s = s.slice(0, insertAt) + "\nimport { computeLayout as buildCpmLayout } from '@/lib/cpm-layout';" + s.slice(insertAt);
fs.writeFileSync(p, s);
console.log('patched OK');
