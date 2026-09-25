const fs = require('fs');
const path = require('path');
const roots = ['apps/web', 'apps/api'];
const pats = [/align/i, /localStorage/i, /обрезк/i, /Обрезк/i, /store/i];
function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.next' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
}
const files = [];
for (const r of roots) { if (fs.existsSync(r)) walk(r, files); }
for (const f of files) {
  if (!/\.(ts|tsx|js|jsx)$/.test(f)) continue;
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  lines.forEach((l, i) => {
    if (/alignCut|AlignCut|align_cut/.test(l)) console.log(f + ':' + (i + 1) + ': ' + l.trim());
  });
}
