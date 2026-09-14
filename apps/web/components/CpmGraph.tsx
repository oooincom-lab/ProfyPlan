'use client';
/**
 * Граф CPM — утверждённый вид (тот самый network_graph.html: круги операций, дни на связях,
 * режимы «абсолютный/относительный», ползунки масштаба, разброса и шрифта, «только критический путь»).
 *
 * Файл утверждённого вида лежит в public/cpm-network.html и встроен без изменений логики;
 * компонент передаёт в него операции и связи проекта из расчёта и получает выбранную операцию.
 *
 * Использование:
 *   как вид рабочего поля:  <CpmGraph cpmResult={netData} height={640} />
 *   как модальное окно:     <CpmGraphModal open cpmResult={netData} onClose={() => setOpen(false)} />
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getProjectDependencies } from '@/lib/api';
import { getPalette } from '@/lib/graph-styles';

export interface CpmGraphProps {
  cpmResult?: any;
  ops?: any[];
  deps?: [string, string][];
  height?: number | string;
  title?: string;
  compact?: boolean;
  onSelect?: (id: string | null) => void;
  paletteId?: string;
}

function mapOps(p: CpmGraphProps): any[] {
  if (p.ops && p.ops.length) return p.ops;
  const nodes = (p.cpmResult && p.cpmResult.nodes) || [];
  return nodes.map((n: any, i: number) => ({
    id: String(n.id),
    num: i + 1,
    name: String(n.name || n.id),
    dur: Number(n.duration_days != null ? n.duration_days : 1),
    unit: 'd',
    es: Number(n.early_start_day != null ? n.early_start_day : 0),
    ef: Number(n.early_finish_day != null ? n.early_finish_day : 0),
    ls: Number(n.late_start_day != null ? n.late_start_day : 0),
    lf: Number(n.late_finish_day != null ? n.late_finish_day : 0),
    crit: !!(n.is_critical != null ? n.is_critical : n.critical),
    float: Number(n.total_float_days || 0),
  }));
}

function mapDeps(p: CpmGraphProps): [string, string][] {
  if (p.deps && p.deps.length) return p.deps;
  const e = (p.cpmResult && (p.cpmResult.edges || p.cpmResult.links)) || [];
  return e
    .map((x: any) => [String(x.from ?? x.source ?? x.predecessor_id), String(x.to ?? x.target ?? x.successor_id)] as [string, string])
    .filter((d: [string, string]) => d[0] !== 'undefined' && d[1] !== 'undefined');
}

export default function CpmGraph(props: CpmGraphProps) {
  const { height = 640, title, onSelect, paletteId } = props;
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [periodFrom, setPeriodFrom] = useState<string>('');
  const [periodTo, setPeriodTo] = useState<string>('');
  const ops = useMemo(() => mapOps(props), [props.cpmResult, props.ops]);
  const deps = useMemo(() => mapDeps(props), [props.cpmResult, props.deps]);
  const start = (props.cpmResult && props.cpmResult.project_start_date) || undefined;

  // связи операций проекта: берём из расчёта, а если их там нет — запрашиваем у API
  const [fetched, setFetched] = useState<[string, string][]>([]);
  const [diag, setDiag] = useState<string>('нет проекта');
  useEffect(() => {
    const pid = props.cpmResult && props.cpmResult.project_id;
    if (deps.length) { setDiag('связи переданы извне'); return; }
    if (!pid) { setFetched([]); setDiag('нет проекта в расчёте'); return; }
    let alive = true;
    getProjectDependencies(String(pid))
      .then((d: any) => {
        if (!alive) return;
        const items = (d && Array.isArray(d.items)) ? d.items : [];
        setFetched(items.map((x: any) => [String(x.from), String(x.to)] as [string, string]));
        setDiag('получено ' + items.length);
      })
      .catch((e: any) => { if (alive) setDiag('ошибка: ' + String((e && e.message) || e).slice(0, 40)); });
    return () => { alive = false; };
  }, [props.cpmResult, deps.length]);

  const allDeps = deps.length ? deps : fetched;

  // кусты — связные компоненты графа связей
  const clusters = useMemo(() => {
    const adj: Record<string, string[]> = {};
    ops.forEach((o: any) => { adj[o.id] = []; });
    allDeps.forEach(([a, b]: [string, string]) => {
      if (adj[a] && adj[b]) { adj[a].push(b); adj[b].push(a); }
    });
    const seen: Record<string, boolean> = {};
    const comps: string[][] = [];
    ops.forEach((o: any) => {
      if (seen[o.id]) return;
      const stack = [o.id];
      const comp: string[] = [];
      seen[o.id] = true;
      while (stack.length) {
        const cur = stack.pop() as string;
        comp.push(cur);
        (adj[cur] || []).forEach((n) => { if (!seen[n]) { seen[n] = true; stack.push(n); } });
      }
      comps.push(comp);
    });
    return comps;
  }, [ops, allDeps, periodFrom, periodTo]);

  // дата старта проекта и перевод «дней от старта» в дату
  const startDate = (props.cpmResult && props.cpmResult.project_start_date) ? new Date(props.cpmResult.project_start_date) : null;
  const dayToDate = (d: number) => (startDate ? new Date(startDate.getTime() + d * 86400000) : null);
  const inPeriod = (d: number) => {
    const dd = dayToDate(d);
    if (!dd) return true;                       // нет даты старта — период не применяем
    if (periodFrom && dd < new Date(periodFrom)) return false;
    if (periodTo && dd > new Date(periodTo)) return false;
    return true;
  };
  // правила пустых дат: пусто «с» — от начала проекта; пусто «по» — до настоящего момента
  const fromEff = periodFrom || (startDate ? startDate.toISOString().slice(0, 10) : '');
  const toEff = periodTo || new Date().toISOString().slice(0, 10);

  const visible = ops.filter((o: any) => inPeriod(Number(o.es) || 0));
  const visibleIds = new Set(visible.map((o: any) => o.id));

  // выравнивание колонок: одинаковые «ранние начала» разводим по подколонкам,
  // иначе 37 операций с началом 0 встают столбиком и график не читается
  const opsForGraph = (() => {
    const byEs: Record<string, any[]> = {};
    visible.forEach((o: any) => { const k = String(o.es); (byEs[k] = byEs[k] || []).push(o); });
    const keys = Object.keys(byEs).map(Number).sort((a, b) => a - b);
    const out: any[] = [];
    keys.forEach((k, idx) => {
      const group = byEs[String(k)];
      const subs = Math.min(group.length, Math.max(1, Math.ceil(group.length / 8)));
      group.forEach((o: any, i: number) => {
        out.push({ ...o, es: idx + (subs > 1 ? (i % subs) * (0.9 / subs) : 0) });
      });
    });
    return out;
  })();
  const depsForGraph = allDeps.filter(([a, b]: [string, string]) => visibleIds.has(a) && visibleIds.has(b));

  const send = () => {
    const w = frameRef.current && frameRef.current.contentWindow;
    if (!w) return;
    const px = typeof height === 'number' ? height : (frameRef.current ? frameRef.current.clientHeight : 640);
    w.postMessage({ type: 'cpm-data', ops: opsForGraph, deps: depsForGraph, clusters, markers: [], pools: [], projectStart: start, height: px, palette: getPalette(paletteId) }, '*');
  };

  useEffect(() => { send(); }, [opsForGraph, depsForGraph, start, paletteId]);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d: any = e.data || {};
      if (d.type === 'cpm-ready') send();
      if (d.type === 'cpm-select' && onSelect) onSelect(d.id ? String(d.id) : null);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [onSelect]);

  const h = typeof height === 'number' ? height + 'px' : height;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12 }}>
        <span style={{ color: '#8FA3BD' }}>Период:</span>
        <input type="date" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} />
        <span style={{ color: '#8FA3BD' }}>—</span>
        <input type="date" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} />
        <button className="btn" onClick={() => { setPeriodFrom(''); setPeriodTo(''); }} style={{ padding: '3px 10px' }}>Весь проект</button>
        <button className="btn" onClick={() => { setPeriodFrom(''); setPeriodTo(new Date().toISOString().slice(0, 10)); }} style={{ padding: '3px 10px' }}>До сегодня</button>
        <span style={{ color: '#8FA3BD' }}>
          {periodFrom ? '' : 'с начала проекта'} {periodTo ? '' : 'по сегодня'} · показано {opsForGraph.length} из {ops.length}
        </span>
        <span style={{ marginLeft: 'auto', color: '#8FA3BD' }}>с {fromEff} по {toEff}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {title ? <b style={{ fontSize: 13 }}>{title}</b> : null}
        <span style={{ fontSize: 11.5, color: '#8FA3BD' }}>
          передано в граф: операций {ops.length} · связей {allDeps.length} · {diag}
          {ops.length ? ' · критических ' + ops.filter((o: any) => o.crit).length : ''}
        </span>
      </div>
      <div style={{ border: '1px solid #26364F', borderRadius: 10, overflow: 'hidden', height: h, minHeight: 260, background: '#0F1B2D' }}>
        <iframe
          ref={frameRef}
          src="/cpm-network.html"
          title={title || 'Граф CPM'}
          onLoad={send}
          style={{ width: '100%', height: '100%', border: 0, display: 'block' }}
        />
      </div>
    </div>
  );
}

/** Тот же утверждённый граф в модальном окне. */
export function CpmGraphModal({ open, onClose, ...rest }: CpmGraphProps & { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(6,12,22,0.72)', zIndex: 4000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: 'min(1400px, 97vw)', background: '#0F1B2D', border: '1px solid #26364F', borderRadius: 12, padding: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <b style={{ fontSize: 14 }}>{rest.title || 'Граф CPM'}</b>
          <button className="btn" onClick={onClose} style={{ marginLeft: 'auto', padding: '3px 10px' }}>Закрыть</button>
        </div>
        <CpmGraph {...rest} compact height="calc(88vh - 110px)" />
      </div>
    </div>
  );
}
