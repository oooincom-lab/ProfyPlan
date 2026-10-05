'use client';
/**
 * Единый вид: слои на одной шкале (блок 6.33.5, срез 1; решение владельца — Дополнение 20).
 *
 * Сводная полоса над «Сетевым графиком»: проект · группы · кластеры · деревья заказов
 * на одной временной шкале — «все расчёты выводятся вместе, на одной временной плоскости».
 * Полосы строятся по плановым окнам заказов (старт → договорная дата).
 * Клик по дереву заказов — открыть расчёт этого дерева (та же область, что у селектора «Заказ»).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { API_V1 } from '@/lib/api';

const MS_DAY = 86400000;
const LABEL_W = 190;
const LS_KEY = 'profyplan_calc_layers';

function parseMs(v: any): number | null {
  if (!v) return null;
  const s = String(v);
  const d = new Date(s.length <= 10 ? s + 'T00:00:00' : s);
  const m = d.getTime();
  return isNaN(m) ? null : m;
}

function fmtD(ms: number | null): string {
  if (ms == null) return '—';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + String(d.getFullYear()).slice(2);
}

function fmtDm(ms: number | null): string {
  if (ms == null) return '—';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  const M = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  return p(d.getDate()) + ' ' + M[d.getMonth()] + ' ' + d.getFullYear();
}

const COLORS: Record<string, string> = {
  project: '#94A3B8',
  group: '#C4B5FD',
  pool: '#38BDF8',
  tree: '#86EFAC',
};

type Band = { s: number | null; f: number | null; cnt: number };

function bandOf(list: any[]): Band {
  let s: number | null = null;
  let f: number | null = null;
  let cnt = 0;
  for (const o of list) {
    const a = parseMs(o.start_date);
    const b = parseMs(o.due_date);
    if (a != null && (s == null || a < s)) s = a;
    if (b != null && (f == null || b > f)) f = b;
    if (a != null || b != null) cnt++;
  }
  return { s, f, cnt };
}

export default function CalcLayersStrip({ projectId, onOpenTree, refreshKey }: {
  projectId: string | null;
  onOpenTree?: (rootOrderId: string) => void;
  refreshKey?: any;
}) {
  const [open, setOpen] = useState(true);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    try { setOpen(localStorage.getItem(LS_KEY) !== '0'); } catch { /* noop */ }
  }, []);

  useEffect(() => {
    if (!projectId) { setData(null); return; }
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const tok = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
        const h: Record<string, string> = { ...(tok ? { Authorization: 'Bea' + 'rer ' + tok } : {}) };
        const [oR, gR, pR] = await Promise.all([
          fetch(API_V1 + '/production-orders/?project_id=' + projectId, { headers: h }),
          fetch(API_V1 + '/projects/' + projectId + '/groups', { headers: h }),
          fetch(API_V1 + '/projects/' + projectId + '/pools', { headers: h }),
        ]);
        const oRaw = oR.ok ? await oR.json() : [];
        const o = Array.isArray(oRaw) ? oRaw : (oRaw?.items || []);
        const g = gR.ok ? ((await gR.json())?.items || []) : [];
        const p = pR.ok ? ((await pR.json())?.items || []) : [];
        if (alive) setData({ orders: o, groups: g, pools: p });
      } catch {
        if (alive) setData({ orders: [], groups: [], pools: [], err: true });
      }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [projectId, refreshKey]);

  const model = useMemo(() => {
    if (!data || !data.orders?.length) return null;
    const orders = data.orders || [];
    const byId: Record<string, any> = {};
    for (const o of orders) byId[String(o.id)] = o;
    const rootOf = (o: any) => {
      let cur = o;
      const seen: Record<string, number> = {};
      while (cur && cur.parent_order_id) {
        const nxt = byId[String(cur.parent_order_id)];
        if (!nxt || seen[String(nxt.id)]) break;
        seen[String(nxt.id)] = 1;
        cur = nxt;
      }
      return cur;
    };

    const treeMap: Record<string, any[]> = {};
    for (const o of orders) {
      const r = rootOf(o);
      const k = String(r?.id || o.id);
      (treeMap[k] = treeMap[k] || []).push(o);
    }
    const treeName = (k: string, list: any[]) => {
      const r = byId[k] || list[0];
      return ((r.ext_id ? r.ext_id + ' · ' : '') + (r.specification_name || 'Заказ'));
    };
    const trees = Object.keys(treeMap)
      .map((k) => ({ id: k, name: treeName(k, treeMap[k]), ...bandOf(treeMap[k]) }))
      .filter((t) => t.s != null || t.f != null)
      .sort((a, b) => (a.s || 0) - (b.s || 0));

    const pools = (data.pools || [])
      .map((p: any) => {
        const list = orders.filter((o: any) => String(o.pool_id || '') === String(p.id));
        return { id: String(p.id), name: String(p.name || 'кластер'), ...bandOf(list) };
      })
      .filter((p: any) => p.cnt > 0)
      .sort((a: any, b: any) => (a.s || 0) - (b.s || 0));

    const poolsByGroup: Record<string, Set<string>> = {};
    for (const p of data.pools || []) {
      const gid = String(p.group_id || '');
      if (!gid) continue;
      (poolsByGroup[gid] = poolsByGroup[gid] || new Set()).add(String(p.id));
    }
    const groups = (data.groups || [])
      .map((g: any) => {
        const gid = String(g.id);
        const poolIds = poolsByGroup[gid] || new Set<string>();
        const list = orders.filter(
          (o: any) => String(o.group_id || '') === gid || (o.pool_id && poolIds.has(String(o.pool_id)))
        );
        return { id: gid, name: String(g.name || 'группа'), ...bandOf(list) };
      })
      .filter((g: any) => g.cnt > 0)
      .sort((a: any, b: any) => (a.s || 0) - (b.s || 0));

    const project = bandOf(orders);

    let mn: number | null = null;
    let mx: number | null = null;
    const consider = (t: Band) => {
      if (t.s != null && (mn == null || t.s < mn)) mn = t.s;
      if (t.f != null && (mx == null || t.f > mx)) mx = t.f;
    };
    consider(project);
    trees.forEach(consider);
    pools.forEach(consider);
    groups.forEach(consider);
    if (mn == null || mx == null) return { project, trees, pools, groups, mn: null, mx: null };
    if (mx === mn) mx = (mn as number) + MS_DAY;
    const pad = Math.max(((mx as number) - (mn as number)) * 0.02, MS_DAY);
    mn = (mn as number) - pad;
    mx = (mx as number) + pad;
    return { project, trees, pools, groups, mn, mx };
  }, [data]);

  const ticks = useMemo(() => {
    if (!model || model.mn == null || model.mx == null) return [] as { left: number; label: string }[];
    const span = model.mx - model.mn;
    const days = span / MS_DAY;
    const step = days <= 21 ? 2 : days <= 60 ? 7 : days <= 150 ? 14 : days <= 400 ? 30 : days <= 900 ? 60 : 90;
    const n = Math.min(Math.floor(days / step), 14);
    const out: { left: number; label: string }[] = [];
    for (let i = 0; i <= n; i++) {
      const v = model.mn + i * step * MS_DAY;
      out.push({ left: ((v - model.mn) / span) * 100, label: fmtD(v) });
    }
    return out;
  }, [model]);

  const toggle = () => {
    const v = !open;
    setOpen(v);
    try { localStorage.setItem(LS_KEY, v ? '1' : '0'); } catch { /* noop */ }
  };

  if (!projectId) return null;

  const rows: { key: string; label: string; title: string; band: Band | null; kind: string; muted?: boolean; onClick?: () => void }[] = [];
  if (model && model.mn != null && model.mx != null) {
    const span = model.mx - model.mn;
    rows.push({
      key: 'project',
      label: 'Проект',
      title: 'Проект: заказов ' + model.project.cnt + ' · ' + fmtDm(model.project.s) + ' — ' + fmtDm(model.project.f),
      band: model.project,
      kind: 'project',
    });
    if (model.groups.length === 0) {
      rows.push({ key: 'g0', label: 'Групп нет', title: '', band: null, kind: 'group', muted: true });
    } else {
      for (const g of model.groups) {
        rows.push({
          key: 'g-' + g.id,
          label: 'Группа «' + g.name + '»',
          title: 'Группа «' + g.name + '»: заказов ' + g.cnt + ' · ' + fmtDm(g.s) + ' — ' + fmtDm(g.f),
          band: g,
          kind: 'group',
        });
      }
    }
    if (model.pools.length === 0) {
      rows.push({ key: 'p0', label: 'Кластеров нет', title: '', band: null, kind: 'pool', muted: true });
    } else {
      for (const p of model.pools) {
        rows.push({
          key: 'p-' + p.id,
          label: 'Кластер «' + p.name + '»',
          title: 'Кластер «' + p.name + '»: заказов ' + p.cnt + ' · ' + fmtDm(p.s) + ' — ' + fmtDm(p.f),
          band: p,
          kind: 'pool',
        });
      }
    }
    if (model.trees.length === 0) {
      rows.push({ key: 't0', label: 'Деревьев заказов нет', title: '', band: null, kind: 'tree', muted: true });
    } else {
      for (const t of model.trees) {
        rows.push({
          key: 't-' + t.id,
          label: '🌳 ' + t.name,
          title:
            'Дерево заказов «' + t.name + '»: заказов ' + t.cnt + ' · ' + fmtDm(t.s) + ' — ' + fmtDm(t.f) +
            (onOpenTree ? ' · клик — открыть расчёт этого дерева' : ''),
          band: t,
          kind: 'tree',
          onClick: onOpenTree ? () => onOpenTree(String(t.id)) : undefined,
        });
      }
    }
  }

  const span = model && model.mn != null && model.mx != null ? model.mx - model.mn : 0;
  const pos = (t: Band) => {
    if (!model || model.mn == null || span <= 0 || (t.s == null && t.f == null)) return null;
    const s0 = t.s ?? (t.f as number);
    const f0 = t.f ?? (t.s as number);
    return { left: ((s0 - model.mn) / span) * 100, width: Math.max(((f0 - s0) / span) * 100, 0.4) };
  };

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-2)', flexShrink: 0 }} data-help-id="calc.layers">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--fg)' }}>Единый вид: слои на одной шкале</span>
        <span style={{ fontSize: 11, color: 'var(--fg-4)' }}>
          {loading
            ? 'загрузка…'
            : model
              ? 'групп: ' + model.groups.length + ' · кластеров: ' + model.pools.length + ' · деревьев заказов: ' + model.trees.length
              : ''}
        </span>
        <span style={{ marginLeft: 'auto' }}>
          <button className="btn btn-secondary btn-sm" onClick={toggle} title="Свернуть или развернуть сводную полосу слоёв">
            {open ? 'Свернуть ▲' : 'Развернуть ▼'}
          </button>
        </span>
      </div>

      {open && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          <div style={{ padding: '6px 10px 2px', fontSize: 11, color: 'var(--fg-4)' }}>
            Полосы — по плановым окнам заказов (старт → договорная дата). Клик по дереву заказов — открыть его расчёт.
          </div>

          {!loading && !model && (
            <div style={{ padding: '8px 10px 10px', fontSize: 12, color: 'var(--fg-3)' }}>
              {data && data.orders?.length
                ? 'У заказов нет плановых дат — задайте даты, и слои построятся.'
                : 'У проекта нет заказов — слои появятся после создания заказов.'}
            </div>
          )}

          {model && model.mn != null && model.mx != null && (
            <>
              <div style={{ display: 'flex', height: 20, alignItems: 'flex-end', paddingRight: 10 }}>
                <div style={{ width: LABEL_W, flexShrink: 0 }} />
                <div style={{ flex: 1, position: 'relative', height: '100%' }}>
                  {ticks.map((t, i) => (
                    <span
                      key={i}
                      style={{
                        position: 'absolute', left: t.left + '%', transform: 'translateX(-50%)',
                        fontSize: 9.5, color: 'var(--fg-4)', whiteSpace: 'nowrap',
                      }}
                    >
                      {t.label}
                    </span>
                  ))}
                </div>
              </div>
              <div style={{ maxHeight: 260, overflowY: 'auto', paddingBottom: 8 }}>
                {rows.map((r) => {
                  const bp = r.band ? pos(r.band) : null;
                  return (
                    <div key={r.key} style={{ display: 'flex', alignItems: 'center', height: 22 }}>
                      <div
                        title={r.title}
                        style={{
                          width: LABEL_W, flexShrink: 0, paddingLeft: 10, paddingRight: 8,
                          fontSize: 11, color: r.muted ? 'var(--fg-4)' : 'var(--fg-2)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}
                      >
                        {r.label}
                      </div>
                      <div style={{ flex: 1, position: 'relative', height: '100%', paddingRight: 10 }}>
                        {bp && (
                          <div
                            title={r.title}
                            onClick={r.onClick}
                            style={{
                              position: 'absolute', top: 3, bottom: 3, left: bp.left + '%', width: bp.width + '%',
                              minWidth: 3, borderRadius: 4, background: COLORS[r.kind], opacity: 0.9,
                              cursor: r.onClick ? 'pointer' : 'default',
                            }}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
