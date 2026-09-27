'use client';
/**
 * Страница PERT (блок 6.18 плана).
 *
 * Считает то, чего нет в детерминированном расчёте: интервал, в который проект попадает
 * с вероятностью 68 % и 95 %. Основа — ожидаемые длительности и разбросы операций
 * по трём оценкам (блок 6.17) и критический путь: разброс накапливается по критическим
 * операциям, потому что именно они сдвигают финиш.
 *
 * Формулы (PERT):
 *   ожидаемая длительность операции  te = (опт. + 4·вероятн. + пессим.) / 6
 *   разброс операции                 σ  = (пессим. − опт.) / 6
 *   ожидаемая длительность проекта   Σte по критическим операциям
 *   разброс проекта                  σΣ = √(Σ σ² по критическим операциям)
 *
 * Пустых и выдуманных чисел не показываем: нет оценок — пишем, чего не хватает.
 */
import React, { useMemo, useState } from 'react';

export type PertOp = {
  id: string;
  name: string;
  is_critical?: boolean;
  to_optimistic?: number | string | null;
  tm_likely?: number | string | null;
  tp_pessimistic?: number | string | null;
};

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function hoursText(hours: number): string {
  const sign = hours < 0 ? '−' : '';
  const abs = Math.abs(hours);
  const days = Math.floor(abs / 24);
  const rest = Math.round((abs - days * 24) * 10) / 10;
  if (days === 0) return `${sign}${rest} ч`;
  return rest === 0 ? `${sign}${days} дн` : `${sign}${days} дн ${rest} ч`;
}

export type PertOrder = { id: string; ext_id?: string | null; parent_order_id?: string | null; specification_name?: string | null; name?: string | null };

/** Локальный расчёт сети по выбранной области: свой критический путь, свои резервы. */
function localCpm(
  ops: { id: string; te: number; tm: number; sigma: number }[],
  deps: { predecessor_id: string; successor_id: string }[],
): { length: number; aggressive: number; sigma: number; criticalIds: Set<string>; slack: Map<string, number> } {
  const ids = new Set(ops.map((o) => o.id));
  const byId = new Map(ops.map((o) => [o.id, o]));
  const succ = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const o of ops) indeg.set(o.id, 0);
  for (const d of deps) {
    if (!ids.has(d.predecessor_id) || !ids.has(d.successor_id)) continue;
    const list = succ.get(d.predecessor_id) || [];
    list.push(d.successor_id);
    succ.set(d.predecessor_id, list);
    indeg.set(d.successor_id, (indeg.get(d.successor_id) || 0) + 1);
  }
  // Топологический порядок (защита от цикла: оставшиеся узлы считаем независящими)
  const queue = ops.filter((o) => (indeg.get(o.id) || 0) === 0).map((o) => o.id);
  const order: string[] = [];
  const left = new Map(indeg);
  while (queue.length) {
    const cur = queue.shift() as string;
    order.push(cur);
    for (const s of succ.get(cur) || []) {
      left.set(s, (left.get(s) || 0) - 1);
      if ((left.get(s) || 0) === 0) queue.push(s);
    }
  }
  for (const o of ops) if (!order.includes(o.id)) order.push(o.id);
  // Прямой проход: ранние сроки
  const es = new Map<string, number>();
  const ef = new Map<string, number>();
  const preds = new Map<string, string[]>();
  for (const d of deps) {
    if (!ids.has(d.predecessor_id) || !ids.has(d.successor_id)) continue;
    const list = preds.get(d.successor_id) || [];
    list.push(d.predecessor_id);
    preds.set(d.successor_id, list);
  }
  for (const id of order) {
    const own = byId.get(id);
    if (!own) continue;
    let start = 0;
    for (const p of preds.get(id) || []) start = Math.max(start, ef.get(p) || 0);
    es.set(id, start);
    ef.set(id, start + own.te);
  }
  const length = Math.max(0, ...ops.map((o) => ef.get(o.id) || 0));
  // Обратный проход: поздние сроки и резервы
  const lf = new Map<string, number>();
  const slack = new Map<string, number>();
  for (const id of [...order].reverse()) {
    const own = byId.get(id);
    if (!own) continue;
    let finish = length;
    const followers = succ.get(id) || [];
    if (followers.length) finish = Math.min(...followers.map((f) => (lf.get(f) ?? length)));
    lf.set(id, finish);
    slack.set(id, finish - own.te - (es.get(id) || 0));
  }
  const criticalIds = new Set(ops.filter((o) => Math.abs(slack.get(o.id) || 0) < 0.001).map((o) => o.id));
  const variance = ops.filter((o) => criticalIds.has(o.id)).reduce((s, o) => s + o.sigma * o.sigma, 0);
  const aggressive = ops.filter((o) => criticalIds.has(o.id)).reduce((s, o) => s + o.tm, 0);
  return { length, aggressive, sigma: Math.sqrt(variance), criticalIds, slack };
}

export default function PertPage({ operations, dependencies = [], resources = [], orders = [] }: { operations: PertOp[]; dependencies?: { predecessor_id: string; successor_id: string }[]; resources?: { operation_id: string; resource_id: string; resource_name?: string }[]; orders?: PertOrder[] }) {
  const [bufferK, setBufferK] = useState(2);
  const [areaOrderId, setAreaOrderId] = useState('');

  // Область расчёта: весь проект или ветка дерева заказов (заказ вместе со всеми дочерними)
  const orderTree = useMemo(() => {
    if (!orders.length) return [] as { id: string; label: string; depth: number }[];
    const byParent = new Map<string, PertOrder[]>();
    for (const o of orders) {
      const key = o.parent_order_id || '';
      const list = byParent.get(key) || [];
      list.push(o);
      byParent.set(key, list);
    }
    const out: { id: string; label: string; depth: number }[] = [];
    const label = (o: PertOrder) => `${o.ext_id || ''} ${o.specification_name || o.name || ''}`.trim() || 'заказ';
    const walk = (parent: string, depth: number, guard: Set<string>) => {
      for (const o of byParent.get(parent) || []) {
        if (guard.has(o.id)) continue;
        guard.add(o.id);
        out.push({ id: o.id, label: label(o), depth });
        walk(o.id, depth + 1, guard);
      }
    };
    walk('', 0, new Set<string>());
    // заказы без родителя, не попавшие в обход (битые ссылки), добавляем плоско
    for (const o of orders) if (!out.some((x) => x.id === o.id)) out.push({ id: o.id, label: label(o), depth: 0 });
    return out;
  }, [orders]);

  const areaSubtree = useMemo(() => {
    if (!areaOrderId) return null;
    const children = new Map<string, string[]>();
    for (const o of orders) {
      if (!o.parent_order_id) continue;
      const list = children.get(o.parent_order_id) || [];
      list.push(o.id);
      children.set(o.parent_order_id, list);
    }
    const ids = new Set<string>([areaOrderId]);
    const stack = [areaOrderId];
    while (stack.length) {
      const cur = stack.pop() as string;
      for (const c of children.get(cur) || []) if (!ids.has(c)) { ids.add(c); stack.push(c); }
    }
    return ids;
  }, [orders, areaOrderId]);

  const areaOps = useMemo(
    () => (areaSubtree ? operations.filter((o) => (o as any).order_id && areaSubtree.has((o as any).order_id)) : operations),
    [operations, areaSubtree],
  );
  const areaLabel = areaOrderId ? orderTree.find((o) => o.id === areaOrderId)?.label || 'выбранная ветка' : 'весь проект';

  const areaCpm = useMemo(() => {
    if (!areaOrderId) return null;
    const rows = areaOps
      .map((o) => {
        const to = num(o.to_optimistic);
        const tm = num(o.tm_likely);
        const tp = num(o.tp_pessimistic);
        if (to === null || tm === null || tp === null) return null;
        return { id: o.id, name: o.name, te: (to + 4 * tm + tp) / 6, tm, sigma: (tp - to) / 6 };
      })
      .filter(Boolean) as { id: string; name: string; te: number; tm: number; sigma: number }[];
    const ids = new Set(rows.map((r) => r.id));
    const deps = dependencies.filter((d) => ids.has(d.predecessor_id) && ids.has(d.successor_id));
    const cpm = localCpm(rows, dependencies);
    const cutEdges = dependencies.filter((d) => ids.has(d.successor_id) && !ids.has(d.predecessor_id)).length;
    return { rows, cpm, cutEdges };
  }, [areaOrderId, areaOps, dependencies]);

  /** Срез области из выполненного расчёта: состав и сумма ожидаемых — без критического пути и интервалов. */
  const areaSlice = useMemo(() => {
    const rows = areaOps
      .map((o) => {
        const to = num(o.to_optimistic);
        const tm = num(o.tm_likely);
        const tp = num(o.tp_pessimistic);
        if (to === null || tm === null || tp === null) return null;
        return { id: o.id, name: o.name, te: (to + 4 * tm + tp) / 6, sigma: (tp - to) / 6 };
      })
      .filter(Boolean) as { id: string; name: string; te: number; sigma: number }[];
    const sumTe = rows.reduce((s, r) => s + r.te, 0);
    return { rows, sumTe };
  }, [areaOps]);
  const data = useMemo(() => {
    const withEstimates = operations
      .map((op) => {
        const to = num(op.to_optimistic);
        const tm = num(op.tm_likely);
        const tp = num(op.tp_pessimistic);
        if (to === null || tm === null || tp === null) return null;
        const te = (to + 4 * tm + tp) / 6;
        const sigma = (tp - to) / 6;
        return { op, to, tm, tp, te, sigma, variance: sigma * sigma, critical: !!op.is_critical };
      })
      .filter(Boolean) as { op: PertOp; to: number; tm: number; tp: number; te: number; sigma: number; variance: number; critical: boolean }[];

    const critical = withEstimates.filter((r) => r.critical);
    const expected = critical.reduce((sum, r) => sum + r.te, 0);
    const aggressive = critical.reduce((sum, r) => sum + r.tm, 0);
    const variance = critical.reduce((sum, r) => sum + r.variance, 0);
    const sigma = Math.sqrt(variance);
    const totalVariance = variance || 1;
    return { withEstimates, critical, expected, aggressive, sigma, totalVariance };
  }, [operations]);

  const noEstimates = data.withEstimates.length === 0;
  const noCriticalEstimates = !noEstimates && data.critical.length === 0;

  // Питающие буферы: некритические ветви, входящие в цепь. Считаем по самой «разбросной» ветви:
  // буфер такой ветви = k · √(сумма дисперсий по ветви). Это стандартный приём критической цепи.
  const feeding = useMemo(() => {
    if (!dependencies.length) return [] as { name: string; sigma: number }[];
    const byId = new Map(data.withEstimates.map((r) => [r.op.id, r]));
    const preds = new Map<string, string[]>();
    for (const d of dependencies) {
      if (!byId.has(d.predecessor_id) || !byId.has(d.successor_id)) continue;
      const list = preds.get(d.successor_id) || [];
      list.push(d.predecessor_id);
      preds.set(d.successor_id, list);
    }
    const chainVar = new Map<string, number>();
    const inProgress = new Set<string>();
    // Наибольшая по дисперсии цепочка некритических работ, входящая в узел
    const walk = (id: string): number => {
      const cached = chainVar.get(id);
      if (cached !== undefined) return cached;
      if (inProgress.has(id)) return 0; // защита от цикла
      inProgress.add(id);
      const self = byId.get(id);
      let best = 0;
      for (const p of preds.get(id) || []) {
        const parent = byId.get(p);
        if (!parent) continue;
        const v = walk(p) + (parent.critical ? 0 : parent.variance);
        if (v > best) best = v;
      }
      inProgress.delete(id);
      const total = best + (self && self.critical ? 0 : 0);
      chainVar.set(id, total);
      return total;
    };
    const out: { name: string; sigma: number }[] = [];
    for (const r of data.critical) {
      let best = 0;
      for (const p of preds.get(r.op.id) || []) {
        const parent = byId.get(p);
        if (!parent || parent.critical) continue;
        const v = walk(p) + parent.variance;
        if (v > best) best = v;
      }
      if (best > 0) out.push({ name: r.op.name, sigma: Math.sqrt(best) });
    }
    return out.sort((a, b) => b.sigma - a.sigma).slice(0, 8);
  }, [dependencies, data]);

  // Разметка общих ресурсов: ресурс, задействованный в нескольких операциях, — кандидат на ресурсный буфер.
  // Буфер ставится перед первой операцией цепи на этом ресурсе: защищаемся от ОЖИДАНИЯ ресурса, а не от своей неопределённости.
  const sharedResources = useMemo(() => {
    if (!resources.length) return [] as { name: string; operations: number; onChain: number; sigma: number }[];
    const criticalIds = new Set(data.critical.map((r) => r.op.id));
    const byId = new Map(data.withEstimates.map((r) => [r.op.id, r]));
    const preds = new Map<string, string[]>();
    for (const d of dependencies) {
      const list = preds.get(d.successor_id) || [];
      list.push(d.predecessor_id);
      preds.set(d.successor_id, list);
    }
    const byResource = new Map<string, { name: string; ops: Set<string>; chain: Set<string> }>();
    const opsByResource = new Map<string, Set<string>>();
    for (const r of resources) {
      const entry = byResource.get(r.resource_id) || { name: r.resource_name || 'ресурс', ops: new Set<string>(), chain: new Set<string>() };
      entry.ops.add(r.operation_id);
      if (criticalIds.has(r.operation_id)) entry.chain.add(r.operation_id);
      byResource.set(r.resource_id, entry);
      const set = opsByResource.get(r.resource_id) || new Set<string>();
      set.add(r.operation_id);
      opsByResource.set(r.resource_id, set);
    }
    /** σ ожидания для ресурса: разброс некритических работ на этом ресурсе, которые идут перед работой цепи */
    const waitSigma = (resourceId: string, chainOpId: string): number => {
      const users = opsByResource.get(resourceId) || new Set<string>();
      const memo = new Map<string, number>();
      const busy = new Set<string>();
      const walk = (id: string): number => {
        const cached = memo.get(id);
        if (cached !== undefined) return cached;
        if (busy.has(id)) return 0;
        busy.add(id);
        let best = 0;
        for (const p of preds.get(id) || []) {
          const owner = byId.get(p);
          if (!owner) continue;
          const own = users.has(p) && !owner.critical ? owner.variance : 0;
          const val = walk(p) + own;
          if (val > best) best = val;
        }
        busy.delete(id);
        memo.set(id, best);
        return best;
      };
      return Math.sqrt(walk(chainOpId));
    };
    return [...byResource.entries()]
      .filter(([, e]) => e.ops.size > 1)
      .map(([rid, e]) => {
        let sigma = 0;
        for (const c of e.chain) sigma = Math.max(sigma, waitSigma(rid, c));
        return { name: e.name, operations: e.ops.size, onChain: e.chain.size, sigma };
      })
      .sort((a, b) => b.sigma - a.sigma || b.onChain - a.onChain || b.operations - a.operations)
      .slice(0, 12);
  }, [resources, data, dependencies]);

  const tile = (title: string, value: string, sub: string) => (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-2)', padding: '10px 12px' }}>
      <div style={{ fontSize: 11, color: 'var(--fg-4)' }}>{title}</div>
      <div style={{ fontSize: 17, color: 'var(--fg)', margin: '4px 0 2px' }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--fg-4)' }}>{sub}</div>
    </div>
  );

  return (
    <div className="panel">
      <div className="panel-hdr">
        <div>
          <span className="panel-title">PERT — интервалы срока</span>
          <span className="panel-sub">
            оценок у операций: {data.withEstimates.length} из {operations.length} · в критическом пути с оценками: {data.critical.length}
          </span>
        </div>
        {orderTree.length ? (
          <label style={{ fontSize: 11.5, color: 'var(--fg-3)', display: 'flex', gap: 6, alignItems: 'center' }}>
            область расчёта
            <select
              value={areaOrderId}
              onChange={(e) => setAreaOrderId(e.target.value)}
              title="Весь проект или ветка заказов: заказ считается вместе со всеми дочерними"
              style={{ background: '#0B1B33', color: 'var(--fg)', border: '1px solid var(--border-2)', borderRadius: 6, padding: '4px 8px', fontSize: 12, fontFamily: 'inherit', maxWidth: 320 }}
            >
              <option value="">весь проект</option>
              {orderTree.map((o) => (
                <option key={o.id} value={o.id}>{'\u00A0'.repeat(o.depth * 3) + o.label}</option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <div style={{ padding: '12px 16px', display: 'grid', gap: 12 }}>
        {areaOrderId && areaCpm ? (
          <div style={{ border: '1px solid var(--border-2)', borderRadius: 8, background: 'var(--bg-2)', padding: '12px 14px', display: 'grid', gap: 10 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>Область: {areaLabel} — пересчёт по области</div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>
              Операций в области: {areaCpm.rows.length} из {operations.length} · связей внутри области: {areaCpm.rows.length ? 'учтены' : '—'}
              {areaCpm.cutEdges > 0 ? ` · отсечено связей на границе области: ${areaCpm.cutEdges}` : ''}
            </div>
            {areaCpm.rows.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--fg-3)' }}>
                В этой ветке нет операций с тройными оценками — заполните их на вкладке «Оценки».
              </div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                  {tile('Срок области (ожидаемый)', hoursText(areaCpm.cpm.length), 'по критическому пути внутри области')}
                  {tile('Разброс области σ', hoursText(areaCpm.cpm.sigma), 'накоплен по критическим операциям области')}
                  {tile('Интервал 68 %', `${hoursText(areaCpm.cpm.length - areaCpm.cpm.sigma)} … ${hoursText(areaCpm.cpm.length + areaCpm.cpm.sigma)}`, '± один разброс σ области')}
                  {tile('Интервал 95 %', `${hoursText(areaCpm.cpm.length - 2 * areaCpm.cpm.sigma)} … ${hoursText(areaCpm.cpm.length + 2 * areaCpm.cpm.sigma)}`, '± два разброса σ области')}
                  {tile('Агрессивный срок области', hoursText(areaCpm.cpm.aggressive), 'по наиболее вероятным длительностям критических операций')}
                  {tile('Буфер области', hoursText(bufferK * areaCpm.cpm.sigma), `запас ${bufferK}·σ области`)}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--fg-4)' }}>
                  Это собственный расчёт области: критический путь построен только по её операциям, поэтому интервалы и буфер относятся
                  именно к ветке, а не к проекту. Связи, выходящие за границу области, отсечены — их число показано выше.
                </div>
                <table className="tbl">
                  <thead><tr><th>Операция области</th><th>Ожидаемая</th><th>Разброс σ</th><th>Резерв</th></tr></thead>
                  <tbody>
                    {areaCpm.rows.slice(0, 25).map((r) => (
                      <tr key={r.id}>
                        <td style={{ maxWidth: 380 }}>
                          {r.name}
                          {areaCpm.cpm.criticalIds.has(r.id) ? <span style={{ color: '#F87171', marginLeft: 6 }} title="Критическая операция области">●</span> : null}
                        </td>
                        <td className="t-mono">{r.te.toFixed(2)}</td>
                        <td className="t-mono">{r.sigma.toFixed(2)}</td>
                        <td className="t-mono">{(areaCpm.cpm.slack.get(r.id) || 0).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        ) : null}

        {noEstimates ? (
          <div style={{ fontSize: 12.5, color: 'var(--fg-3)' }}>
            Пока нечего считать: ни у одной операции нет трёх оценок. Заполните их на вкладке «Оценки» — и здесь появятся
            ожидаемый срок и интервалы.
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
              {tile('Ожидаемый срок', hoursText(data.expected), 'сумма ожидаемых длительностей критических операций')}
              {tile('Интервал 68 %', `${hoursText(data.expected - data.sigma)} … ${hoursText(data.expected + data.sigma)}`, '± один разброс σ')}
              {tile('Интервал 95 %', `${hoursText(data.expected - 2 * data.sigma)} … ${hoursText(data.expected + 2 * data.sigma)}`, '± два разброса σ')}
              {tile('Разброс σ', hoursText(data.sigma), data.critical.length ? 'накоплен по критическим операциям' : 'нет критических операций с оценками')}
            </div>

            {noCriticalEstimates ? (
              <div style={{ fontSize: 12.5, color: 'var(--fg-3)' }}>
                Оценки есть, но ни одна критическая операция их не имеет. Разброс срока складывается именно из критических
                операций — заполните оценки по ним, и интервалы станут осмысленными.
              </div>
            ) : null}

            {/* Защита срока буферами (блок 6.20): первая часть — буфер по критическому пути */}
            {data.critical.length ? (
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-2)', padding: '12px 14px', display: 'grid', gap: 10 }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>Защита срока буферами (критическая цепь)</div>
                  <label style={{ fontSize: 11.5, color: 'var(--fg-3)', display: 'flex', gap: 6, alignItems: 'center' }}>
                    запас буфера, k·σ
                    <input
                      type="number" min={0} max={4} step={0.25} value={bufferK}
                      onChange={(e) => setBufferK(Number(e.target.value) || 0)}
                      style={{ width: 70, background: '#0B1B33', color: 'var(--fg)', border: '1px solid var(--border-2)', borderRadius: 5, padding: '3px 6px', fontSize: 12 }}
                    />
                  </label>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                  {tile('Агрессивный срок', hoursText(data.aggressive), 'чаще всего случающаяся длительность критических операций')}
                  {tile('Проектный буфер', hoursText(bufferK * data.sigma), `запас ${bufferK}·σ на непредвиденное в конце цепи`)}
                  {tile('Защищённый срок', hoursText(data.aggressive + bufferK * data.sigma), 'агрессивный срок плюс буфер')}
                  {tile('Сравнение с ожидаемым', hoursText(data.aggressive + bufferK * data.sigma - data.expected), 'насколько защищённый срок отличается от обычного расчёта')}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--fg-4)' }}>
                  Смысл приёма: длительности операций берутся напряжённые (в половине случаев выполнимые), а весь риск собирается
                  в один буфер в конце — им и управляют, вместо того чтобы прятать запас в каждой операции.
                </div>

                {/* Буферная диаграмма: цепь + буфер = защищённый срок; отдельно отмечен обычный расчёт */}
                {(() => {
                  const aggressive = data.aggressive;
                  const buffer = bufferK * data.sigma;
                  const protectedTotal = aggressive + buffer;
                  const expectedPos = protectedTotal > 0 ? Math.min(100, Math.max(0, (data.expected / protectedTotal) * 100)) : 0;
                  const chainPct = protectedTotal > 0 ? (aggressive / protectedTotal) * 100 : 100;
                  const bufPct = 100 - chainPct;
                  return (
                    <div>
                      <div style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 6 }}>Буферная диаграмма</div>
                      <div style={{ position: 'relative', display: 'flex', height: 30, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border-2)' }}>
                        <div style={{ width: chainPct + '%', background: 'linear-gradient(180deg,#3B82F6,#2563EB)', color: '#EAF2FF', fontSize: 11.5, display: 'flex', alignItems: 'center', paddingLeft: 8, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                          цепь · {hoursText(aggressive)}
                        </div>
                        <div style={{ width: bufPct + '%', background: 'repeating-linear-gradient(45deg,#F59E0B,#F59E0B 6px,#B45309 6px,#B45309 12px)', color: '#1F1300', fontSize: 11.5, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                          буфер · {hoursText(buffer)}
                        </div>
                        {expectedPos > 0 && expectedPos < 100 ? (
                          <div title={'Обычный расчёт: ' + hoursText(data.expected)} style={{ position: 'absolute', left: expectedPos + '%', top: 0, bottom: 0, width: 2, background: '#E8EEF5' }} />
                        ) : null}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--fg-4)', marginTop: 5 }}>
                        Защищённый срок {hoursText(protectedTotal)} · полосатый участок — буфер, им и управляют при исполнении.
                        {expectedPos > 0 && expectedPos < 100 ? ' Белая черта — обычный расчёт по ожидаемым длительностям (' + hoursText(data.expected) + '): видно, что агрессивный план напряжённее, а защита после буфера — надёжнее.' : ''}
                      </div>
                    </div>
                  );
                })()}

                {sharedResources.length ? (
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 6 }}>
                      Общие ресурсы — кандидаты на ресурсный буфер (задействованы более чем в одной операции)
                    </div>
                    <table className="tbl">
                      <thead><tr><th>Ресурс</th><th>Операций</th><th>Из них в цепи</th><th>Ожидание, σ</th><th>Буфер</th><th>Что предлагается</th></tr></thead>
                      <tbody>
                        {sharedResources.map((r, i) => (
                          <tr key={i}>
                            <td>{r.name}</td>
                            <td className="t-mono">{r.operations}</td>
                            <td className="t-mono">{r.onChain}</td>
                            <td className="t-mono">{r.onChain > 0 ? r.sigma.toFixed(2) : '—'}</td>
                            <td className="t-mono">{r.onChain > 0 && r.sigma > 0 ? hoursText(bufferK * r.sigma) : '—'}</td>
                            <td style={{ color: 'var(--fg-3)' }}>
                              {r.onChain > 0
                                ? (r.sigma > 0 ? 'буфер перед первой операцией цепи на этом ресурсе' : 'ожидания нет: некритические работы на этом ресурсе в цепь не входят')
                                : 'буфер пока не нужен: в цепи не участвует'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div style={{ fontSize: 11.5, color: 'var(--fg-4)', marginTop: 4 }}>
                      Размер буфера считается по σ ожидания — разбросу некритических работ на этом ресурсе, которые идут перед
                      работой цепи, с тем же запасом k, что и проектный буфер. Буфер ставится перед первой операцией цепи,
                      использующей ресурс: он защищает от ОЖИДАНИЯ ресурса, а не от собственной неопределённости работ.
                    </div>
                  </div>
                ) : null}

                {feeding.length ? (
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 6 }}>
                      Питающие буферы — некритические ветви, которые могут сдвинуть цепь (сверху самые «разбросные», запас {bufferK}·σ)
                    </div>
                    <table className="tbl">
                      <thead><tr><th>Вход в цепь</th><th>Питающая ветвь, σ</th><th>Буфер</th></tr></thead>
                      <tbody>
                        {feeding.map((f, i) => (
                          <tr key={i}>
                            <td>{f.name}</td>
                            <td className="t-mono">{f.sigma.toFixed(2)}</td>
                            <td className="t-mono">{hoursText(bufferK * f.sigma)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div style={{ fontSize: 11.5, color: 'var(--fg-4)', marginTop: 4 }}>
                      Буфер ставится перед входом ветви в цепь: если ветвь начинает запаздывать, съедается сначала он, а не срок цели.
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--fg-4)', marginTop: 6 }}>
                      Честная граница: проектный и питающие буферы считаются по текущему критическому пути. Ресурсные буферы перед
                      общими ресурсами появятся вместе с полной критической цепью и ресурсным выравниванием (остаток блока 6.20), 
                      а правило расхода буфера — вместе с фактом исполнения.
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div>
              <div style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 6 }}>
                Вклад операций в разброс срока — сверху те, из-за кого срок «плывёт» сильнее всего
              </div>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Операция</th>
                    <th>Опт. / вероятн. / пессим.</th>
                    <th>Ожидаемая</th>
                    <th>Разброс σ</th>
                    <th>Вклад в разброс</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.withEstimates]
                    .sort((a, b) => b.variance - a.variance)
                    .slice(0, 40)
                    .map((r) => (
                      <tr key={r.op.id}>
                        <td style={{ maxWidth: 340 }}>
                          {r.op.name}
                          {r.critical ? <span style={{ color: '#F87171', marginLeft: 6 }} title="Критическая операция">●</span> : null}
                        </td>
                        <td className="t-mono">{r.to} / {r.tm} / {r.tp}</td>
                        <td className="t-mono">{r.te.toFixed(2)}</td>
                        <td className="t-mono">{r.sigma.toFixed(2)}</td>
                        <td className="t-mono">{Math.round((r.variance / data.totalVariance) * 100)} %</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            <div style={{ fontSize: 11.5, color: 'var(--fg-4)' }}>
              Интервалы считаются по критическому пути: предполагается, что его состав не меняется. Полный разбор с симуляцией
              (гистограмма, S-кривая, процентили) появится на вкладке «Монте-Карло» — блок 6.19.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
