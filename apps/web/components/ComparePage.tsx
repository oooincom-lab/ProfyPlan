'use client';
/**
 * Страница «Сравнение» (блок 6.22.4 плана; спецификация — Дополнение 11 промта).
 *
 * Два запуска из реестра рядом: когда считали, каким методом, по какой версии данных,
 * срок расчёта и вероятностные процентили — с разницей. Ничего не пересчитывается:
 * числа берутся только из реестра запусков. PERT и Монте-Карло не усредняются —
 * сравниваются лишь одинаковые показатели. Если оба запуска вероятностные, сверху
 * накладываются их S-кривые (вероятность уложиться в срок).
 */
import React, { useMemo, useState } from 'react';

type Run = any;

function hoursText(hours: number | undefined | null): string {
  if (hours === undefined || hours === null || !Number.isFinite(Number(hours))) return '—';
  const abs = Math.abs(Number(hours));
  const days = Math.floor(abs / 24);
  const rest = Math.round((abs - days * 24) * 10) / 10;
  if (days === 0) return `${rest} ч`;
  return rest === 0 ? `${days} дн` : `${days} дн ${rest} ч`;
}

function fmtAt(value: any): string {
  if (!value) return 'дата не указана';
  try {
    return new Date(value).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return 'дата не указана'; }
}

function methodText(r: Run): string {
  return `${String(r?.planning_logic || 'cpm').toUpperCase()} + ${r?.uncertainty_analysis || '—'}`;
}

function runLabel(r: Run): string {
  const ver = r?.data_fingerprint ? ` · ${String(r.data_fingerprint).slice(0, 8)}` : '';
  return `${fmtAt(r?.data_date)} · ${methodText(r)}${ver}`;
}

function num(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const selectStyle: React.CSSProperties = {
  background: '#0B1B33', color: 'var(--fg)', border: '1px solid var(--border-2)',
  borderRadius: 5, padding: '4px 6px', fontSize: 12, minWidth: 280, maxWidth: 420,
};

export default function ComparePage({ runs, onOpenRuns }: { runs: Run[]; onOpenRuns?: () => void }) {
  const [leftId, setLeftId] = useState<string | null>(null);
  const [rightId, setRightId] = useState<string | null>(null);

  // По умолчанию — два последних запуска; если оба одного метода, второй — ближайший другого метода.
  const defaults = useMemo(() => {
    if (!runs || runs.length < 2) return [null, null] as [string | null, string | null];
    const a = runs[0];
    const b = runs.slice(1).find((r: Run) => r?.uncertainty_analysis !== a?.uncertainty_analysis) || runs[1];
    return [a?.id || null, b?.id || null] as [string | null, string | null];
  }, [runs]);

  const effLeft = leftId && runs.some((r) => r.id === leftId) ? leftId : defaults[0];
  const effRight = rightId && runs.some((r) => r.id === rightId) ? rightId : defaults[1];
  const left = runs.find((r) => r.id === effLeft) || null;
  const right = runs.find((r) => r.id === effRight) || null;

  const dur = (r: Run) => num(r?.result?.project_duration_hours);
  const crit = (r: Run) => num(r?.result?.critical_operations);
  const ops = (r: Run) => num(r?.result?.operations);
  const iters = (r: Run) => num(r?.result?.iterations);
  const pct = (r: Run, k: string) => num(r?.result?.percentiles?.[k]);

  const diff = (a: number | null, b: number | null) => {
    if (a === null || b === null) return null;
    const d = b - a;
    if (Math.abs(d) < 0.05) return 'совпадает';
    return (d > 0 ? '+' : '−') + hoursText(Math.abs(d));
  };

  if (!runs || runs.length < 2) {
    return (
      <div className="panel">
        <div className="panel-hdr">
          <div>
            <span className="panel-title">Сравнение запусков</span>
            <span className="panel-sub">нужно не меньше двух запусков</span>
          </div>
        </div>
        <div style={{ padding: '12px 16px', display: 'grid', gap: 10, fontSize: 12.5, color: 'var(--fg-3)' }}>
          <span>
            Сравнивать пока нечего: в реестре меньше двух запусков. Нажмите «Пересчитать» в полосе выше
            или «Рассчитать» на страницах расчёта — каждый запуск сохраняется автоматически.
          </span>
          {onOpenRuns ? (
            <div><button className="btn btn-secondary btn-sm" onClick={onOpenRuns}>Открыть «Запуски» →</button></div>
          ) : null}
        </div>
      </div>
    );
  }

  const rows: { label: string; a: string; b: string; d: string | null; title?: string }[] = [
    { label: 'Когда', a: fmtAt(left?.data_date), b: fmtAt(right?.data_date), d: null },
    { label: 'Метод', a: methodText(left), b: methodText(right), d: null, title: 'Обе оси метода на момент запуска' },
    { label: 'Версия данных', a: left?.data_fingerprint || '—', b: right?.data_fingerprint || '—', d: null, title: 'Отпечаток входных данных: видно, менялись ли данные между запусками' },
    { label: 'Операций', a: ops(left)?.toString() ?? '—', b: ops(right)?.toString() ?? '—', d: null },
    {
      label: 'Срок расчёта (детерминированный)',
      a: hoursText(dur(left)), b: hoursText(dur(right)), d: diff(dur(left), dur(right)),
      title: 'Одинаковый показатель для любых запусков — берётся из реестра',
    },
    { label: 'Критических операций', a: crit(left)?.toString() ?? '—', b: crit(right)?.toString() ?? '—', d: null },
  ];

  const hasAnyPct = ['p50', 'p80', 'p95'].some((k) => pct(left, k) !== null || pct(right, k) !== null);
  if (hasAnyPct) {
    rows.push({ label: 'Прогонов (Монте-Карло)', a: iters(left)?.toString() ?? '—', b: iters(right)?.toString() ?? '—', d: null });
    for (const k of ['p50', 'p80', 'p95']) {
      const a = pct(left, k);
      const b = pct(right, k);
      if (a === null && b === null) continue;
      rows.push({ label: `${k} — вероятностный срок`, a: hoursText(a), b: hoursText(b), d: diff(a, b) });
    }
  }

  const headDiff = diff(dur(left), dur(right));

  // Наложение S-кривых — только когда оба запуска вероятностные (у Монте-Карло есть S-кривая).
  const curveA: any[] = Array.isArray(left?.result?.s_curve) ? left.result.s_curve : [];
  const curveB: any[] = Array.isArray(right?.result?.s_curve) ? right.result.s_curve : [];
  const bothCurves = curveA.length > 1 && curveB.length > 1;
  let overlay: React.ReactNode = null;
  if (bothCurves) {
    const W = 860;
    const H = 200;
    const PADL = 46;
    const PADB = 26;
    const PADT = 10;
    const pt = (p: any) => ({ x: num(p?.duration ?? p?.x) ?? 0, y: num(p?.probability ?? p?.y) ?? 0 });
    const all = [...curveA.map(pt), ...curveB.map(pt)];
    const xmin = Math.min(...all.map((p) => p.x));
    const xmax = Math.max(...all.map((p) => p.x));
    const sx = (x: number) => PADL + ((x - xmin) / Math.max(1, xmax - xmin)) * (W - PADL - 14);
    const sy = (y: number) => H - PADB - y * (H - PADB - PADT);
    const line = (arr: any[]) => arr.map(pt).map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
    overlay = (
      <div>
        <div style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 6 }}>
          Наложение S-кривых: вероятность уложиться в срок — по сохранённым прогонам обоих запусков
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W, height: 'auto', display: 'block' }}>
          {[0, 0.5, 1].map((y) => (
            <g key={y}>
              <line x1={PADL} x2={W - 14} y1={sy(y)} y2={sy(y)} style={{ stroke: 'var(--border)' }} strokeWidth={1} />
              <text x={PADL - 8} y={sy(y) + 4} textAnchor="end" fontSize="10" style={{ fill: 'var(--fg-4)' }}>{Math.round(y * 100)} %</text>
            </g>
          ))}
          <polyline points={line(curveA)} fill="none" stroke="#3B82F6" strokeWidth={2} />
          <polyline points={line(curveB)} fill="none" stroke="#F59E0B" strokeWidth={2} />
          <text x={PADL} y={H - 8} fontSize="10" style={{ fill: 'var(--fg-4)' }}>{hoursText(xmin)}</text>
          <text x={W - 14} y={H - 8} fontSize="10" textAnchor="end" style={{ fill: 'var(--fg-4)' }}>{hoursText(xmax)}</text>
        </svg>
        <div style={{ display: 'flex', gap: 14, fontSize: 11.5, color: 'var(--fg-3)', marginTop: 4, flexWrap: 'wrap' }}>
          <span>
            <span style={{ display: 'inline-block', width: 10, height: 3, background: '#3B82F6', verticalAlign: 'middle', marginRight: 5 }} />
            A — {runLabel(left)}
          </span>
          <span>
            <span style={{ display: 'inline-block', width: 10, height: 3, background: '#F59E0B', verticalAlign: 'middle', marginRight: 5 }} />
            B — {runLabel(right)}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-hdr">
        <div>
          <span className="panel-title">Сравнение запусков</span>
          <span className="panel-sub">{runs.length} запусков в реестре · выберите два</span>
        </div>
      </div>
      <div style={{ padding: '12px 16px', display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ fontSize: 11.5, color: 'var(--fg-3)', display: 'flex', gap: 6, alignItems: 'center' }}>
            Запуск A
            <select value={effLeft || ''} onChange={(e) => setLeftId(e.target.value)} style={selectStyle}>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>{runLabel(r)}</option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: 11.5, color: 'var(--fg-3)', display: 'flex', gap: 6, alignItems: 'center' }}>
            Запуск B
            <select value={effRight || ''} onChange={(e) => setRightId(e.target.value)} style={selectStyle}>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>{runLabel(r)}</option>
              ))}
            </select>
          </label>
        </div>

        {headDiff ? (
          <div style={{ fontSize: 12.5, color: 'var(--fg-2)' }}>
            Срок расчёта: <b>B {headDiff === 'совпадает' ? 'совпадает с A' : `${headDiff} к A`}</b>
            <span style={{ color: 'var(--fg-4)' }}> · «+» — второй запуск длиннее, «−» — короче</span>
          </div>
        ) : null}

        <table className="tbl">
          <thead>
            <tr><th style={{ width: 280 }}>Показатель</th><th>Запуск A</th><th>Запуск B</th><th>Разница (B − A)</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <td style={{ color: 'var(--fg-3)' }} title={row.title}>{row.label}</td>
                <td className="t-mono">{row.a}</td>
                <td className="t-mono">{row.b}</td>
                <td className="t-mono" style={{ color: row.d && row.d !== 'совпадает' ? 'var(--fg-2)' : 'var(--fg-4)' }}>{row.d ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {overlay ?? (
          <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>
            {curveA.length > 1 || curveB.length > 1
              ? 'Наложение распределений доступно, когда у обоих запусков есть вероятностный расчёт (Монте-Карло); сейчас он есть только у одного из выбранных.'
              : 'Наложение распределений появится, когда среди выбранных запусков будут вероятностные (Монте-Карло).'}
          </div>
        )}

        <div style={{ fontSize: 11.5, color: 'var(--fg-4)' }}>
          Числа — из реестра запусков, ничего не пересчитывается. PERT и Монте-Карло не усредняются:
          сравниваются только одинаковые показатели.
        </div>
      </div>
    </div>
  );
}
