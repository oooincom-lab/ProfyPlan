/* Временная самопроверка метрик раскладки CPM. Не часть проекта — удаляется после прогона. */
import {
  computeLayoutMetrics, segCross, rectsOverlap, CARD_W, CARD_H,
} from '../../../lib/cpm-metrics';

let pass = 0;
let fail = 0;
function check(name: string, got: unknown, want: unknown): void {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ok   ' + name + ' = ' + JSON.stringify(got)); }
  else { fail++; console.log('  FAIL ' + name + ': got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }
}

console.log('CARD = ' + CARD_W + 'x' + CARD_H);

console.log('\n[1] Примитивы геометрии');
check('segCross(крест)', segCross(0, 0, 10, 10, 0, 10, 10, 0), true);
check('segCross(параллельны)', segCross(0, 0, 10, 0, 0, 5, 10, 5), false);
check('rectsOverlap(перекрытие)', rectsOverlap({ x: 0, y: 0, hw: 104, hh: 30 }, { x: 10, y: 0, hw: 104, hh: 30 }), true);
check('rectsOverlap(врозь)', rectsOverlap({ x: 0, y: 0, hw: 104, hh: 30 }, { x: 300, y: 0, hw: 104, hh: 30 }), false);

console.log('\n[2] Два перекрывающихся прямоугольника → наложений узлов = 1');
const mLayout = { pos: { A: [0, 0] as [number, number], B: [10, 0] as [number, number] }, minX: -104, maxX: 114, minY: -30, maxY: 30 };
const m = computeLayoutMetrics(mLayout, [{ id: 'A', crit: false }, { id: 'B', crit: false }], [], false);
check('nodeOverlaps', m.nodeOverlaps, 1);
check('crossings', m.crossings, 0);
check('density > 0', m.density > 0, true);

console.log('\n[3] Два пересекающихся отрезка → пересечений = 1');
const cLayout = {
  pos: { A: [-200, -150] as [number, number], B: [200, 150] as [number, number], C: [-200, 150] as [number, number], D: [200, -150] as [number, number] },
  minX: -304, maxX: 304, minY: -180, maxY: 180,
};
const c = computeLayoutMetrics(cLayout, 'ABCD'.split('').map((id) => ({ id, crit: false })), [['A', 'B'], ['C', 'D']], false);
check('crossings', c.crossings, 1);
check('nodeOverlaps', c.nodeOverlaps, 0);
check('edgeNodeHits', c.edgeNodeHits, 0);

console.log('\n[4] Пара с общим концом не считается пересечением');
const sLayout = {
  pos: { A: [-400, 0] as [number, number], B: [400, 0] as [number, number], D: [400, 200] as [number, number] },
  minX: -504, maxX: 504, minY: -30, maxY: 230,
};
const s = computeLayoutMetrics(sLayout, [{ id: 'A', crit: false }, { id: 'B', crit: false }, { id: 'D', crit: false }], [['A', 'B'], ['A', 'D']], false);
check('crossings', s.crossings, 0);

console.log('\n[5] Связь обходит одиночный посторонний узел → наложений на узлы = 0');
const aLayout = {
  pos: { A: [-400, 0] as [number, number], B: [400, 0] as [number, number], M: [0, 0] as [number, number] },
  minX: -504, maxX: 504, minY: -30, maxY: 30,
};
const a = computeLayoutMetrics(aLayout, [{ id: 'A', crit: false }, { id: 'B', crit: false }, { id: 'M', crit: false }], [['A', 'B']], false);
check('edgeNodeHits', a.edgeNodeHits, 0);

console.log('\n[6] Стену узлов обойти нельзя → наложений на узлы = 1');
const wLayout = {
  pos: {
    A: [-400, 0] as [number, number], B: [400, 0] as [number, number],
    W1: [0, -100] as [number, number], W2: [0, -50] as [number, number], W3: [0, 0] as [number, number],
    W4: [0, 50] as [number, number], W5: [0, 100] as [number, number],
  },
  minX: -504, maxX: 504, minY: -130, maxY: 130,
};
const w = computeLayoutMetrics(wLayout, ['A', 'B', 'W1', 'W2', 'W3', 'W4', 'W5'].map((id) => ({ id, crit: false })), [['A', 'B']], false);
check('edgeNodeHits', w.edgeNodeHits, 1);

console.log('\n[7] Фильтр крит. пути сокращает набор узлов');
const f = computeLayoutMetrics(mLayout, [{ id: 'A', crit: true }, { id: 'B', crit: false }], [], true);
check('nodes', f.nodes, 1);
check('nodeOverlaps', f.nodeOverlaps, 0);

console.log('\n' + (fail === 0 ? 'ВСЁ ПРОШЛО' : 'ЕСТЬ ОШИБКИ') + ': ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail === 0 ? 0 : 1);
