/* Временная проверка структуры CPM: реальные данные + синтетика. Не часть проекта. */
import fs from 'node:fs';
import path from 'node:path';
import { checkCpmStructure } from '../../../lib/cpm-structure';

const DIR = __dirname;
const data = JSON.parse(fs.readFileSync(process.env.CPM_DATA || path.join(DIR, 'data.json'), 'utf8'));
const nodes = data.cpm.nodes.map((n: any) => ({ id: String(n.id), num: n.number, name: n.name }));
const ids = new Set(nodes.map((n: any) => n.id));
const deps: [string, string][] = (data.deps || []).map((d: any) => [String(d[0]), String(d[1])]).filter(([a, b]: string[]) => ids.has(a) && ids.has(b));

console.log('=== РЕАЛЬНЫЙ ПРОЕКТ «Полигон A — Мосты (тест)» ===');
const real = checkCpmStructure(nodes, deps);
console.log('предупреждений: ' + real.length);
real.forEach((w) => console.log('  [' + w.kind + '] ' + w.title + ' — ' + w.detail));

console.log('\n=== СИНТЕТИКА ===');
const N = [
  { id: 'a', num: 1 }, { id: 'b', num: 2 }, { id: 'c', num: 3 }, { id: 'd', num: 4 },
];
console.log('цикл a→b→c→a, d висячая, дубль a→b:');
const cases = checkCpmStructure(N, [['a', 'b'], ['b', 'c'], ['c', 'a'], ['a', 'b'], ['a', 'b']]);
console.log('  предупреждений: ' + cases.length);
cases.forEach((w) => console.log('  [' + w.kind + '] ' + w.title + ' — ' + w.detail));

console.log('корректная цепочка a→b→c:');
const okChain = checkCpmStructure([{ id: 'a', num: 1 }, { id: 'b', num: 2 }, { id: 'c', num: 3 }], [['a', 'b'], ['b', 'c']]);
console.log('  предупреждений: ' + okChain.length);

console.log('одинокая d среди a→b→c:');
const lonely = checkCpmStructure(N, [['a', 'b'], ['b', 'c']]);
console.log('  предупреждений: ' + lonely.length);
lonely.forEach((w) => console.log('  [' + w.kind + '] ' + w.title + ' — ' + w.detail));
