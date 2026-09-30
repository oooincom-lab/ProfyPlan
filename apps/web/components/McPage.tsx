'use client';
/**
 * Страница Монте-Карло (блок 6.19 плана).
 *
 * Разыгрывает длительности операций по тройным оценкам (бета-PERT) и каждый раз считает сеть
 * целиком. Отвечает на вопрос, на который PERT ответить не может: с какой вероятностью проект
 * уложится в конкретную дату — потому что видит, как критическими становятся другие пути.
 *
 * Честные границы: ресурсы внутри прогонов НЕ пересчитываются (это отдельный, дорогой режим),
 * поэтому результат оптимистичнее реальности — это написано прямо на странице.
 */
import React, { useEffect, useState } from 'react';

export type McResult = {
  iterations?: number;
  deterministic_duration?: number;
  mean?: number;
  std_dev?: number;
  percentiles?: Record<string, number>;
  histogram?: any;
  s_curve?: any;
  warnings?: string[];
};

function hoursText(hours: number | undefined | null): string {
  if (hours === undefined || hours === null || !Number.isFinite(Number(hours))) return '—';
  const abs = Math.abs(Number(hours));
  const days = Math.floor(abs / 24);
  const rest = Math.round((abs - days * 24) * 10) / 10;
  if (days === 0) return `${rest} ч`;
  return rest === 0 ? `${days} дн` : `${days} дн ${rest} ч`;
}

export default function McPage({
  onRun,
  onOpenTab,
  lastRun,
  projectId,
}: {
  onRun: (iterations: number, seed: number | null) => Promise<McResult>;
  onOpenTab?: (tab: string) => void;
  lastRun?: any;
  projectId?: string;
}) {
  const [iterations, setIterations] = useState(10000);
  const [seed, setSeed] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<McResult | null>(null);
  const [error, setError] = useState('');
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [pickedIdx, setPickedIdx] = useState<number | null>(null);

  // Последний сохранённый запуск (реестр «Запуски»): расчёт не сбрасывается при переходе
  // на другую вкладку или к другому проекту — возвращаемся, и распределение уже на месте.
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [savedIter, setSavedIter] = useState<number | null>(null);
  const [savedSeed, setSavedSeed] = useState<string | null>(null);

  const fmtAt = (value: any) => {
    if (!value) return null;
    try {
      return new Date(value).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return null; }
  };
  useEffect(() => {
    if (lastRun && lastRun.result) {
      setResult(lastRun.result as McResult);
      setSavedAt(fmtAt(lastRun.data_date || lastRun.created_at));
      setSavedIter(Number(lastRun.params?.iterations ?? lastRun.result?.iterations ?? 0) || null);
      setSavedSeed(lastRun.params?.seed !== undefined && lastRun.params?.seed !== null ? String(lastRun.params.seed) : null);
    } else {
      setResult(null);
      setSavedAt(null);
      setSavedIter(null);
      setSavedSeed(null);
    }
    setHoverIdx(null);
    setPickedIdx(null);
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastRun?.id, projectId]);

  const run = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await onRun(iterations, seed.trim() === '' ? null : Number(seed));
      setResult(res || {});
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const variants = Array.isArray((result as any)?.histogram) ? (result as any).histogram : [];
  const maxCount = variants.reduce((m: number, v: any) => Math.max(m, Number(v?.count ?? v?.value ?? 0)), 0);
  const curve = Array.isArray((result as any)?.s_curve) ? (result as any).s_curve : [];
  const p = result?.percentiles || {};
  const totalRuns = variants.reduce((s: number, v: any) => s + Number(v?.count ?? 0), 0);
  const cdfShare = (i: number) => {
    if (!totalRuns) return 0;
    let acc = 0;
    for (let j = 0; j <= i && j < variants.length; j++) acc += Number(variants[j]?.count ?? 0);
    return acc / totalRuns;
  };
  const pctColor: Record<string, string> = { p50: '#3B82F6', p80: '#F59E0B', p95: '#EF4444' };

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
          <span className="panel-title">Монте-Карло — распределение срока</span>
          <span className="panel-sub">
            {result?.iterations ? `прогонов: ${result.iterations}` : 'прогоны не запускались'}
            {seed.trim() ? ` · зерно: ${seed}` : ' · зерно случайное'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ fontSize: 11.5, color: 'var(--fg-3)', display: 'flex', gap: 6, alignItems: 'center' }}>
            прогонов
            <input
              type="number" min={100} max={100000} step={100} value={iterations}
              onChange={(e) => setIterations(Number(e.target.value) || 10000)}
              style={{ width: 90, background: '#0B1B33', color: 'var(--fg)', border: '1px solid var(--border-2)', borderRadius: 5, padding: '4px 6px', fontSize: 12 }}
            />
          </label>
          <label style={{ fontSize: 11.5, color: 'var(--fg-3)', display: 'flex', gap: 6, alignItems: 'center' }}>
            зерно
            <input
              value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="случайное"
              style={{ width: 90, background: '#0B1B33', color: 'var(--fg)', border: '1px solid var(--border-2)', borderRadius: 5, padding: '4px 6px', fontSize: 12 }}
            />
          </label>
          <button className="btn btn-primary btn-sm" onClick={run} disabled={busy}>
            {busy ? 'Считаю…' : 'Рассчитать'}
          </button>
        </div>
      </div>

      <div style={{ padding: '12px 16px', display: 'grid', gap: 12 }}>
        <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>
          Длительности разыгрываются по бета-PERT много раз, и каждый прогон пересчитывает сеть целиком. Ресурсы внутри
          прогонов <b>не пересчитываются</b> — результат оптимистичнее реальности; расчёт с ресурсами — отдельный, более
          долгий режим (блок 6.20).
        </div>

        {savedAt ? (
          <div style={{ fontSize: 12, color: 'var(--fg-3)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span>
              Последний сохранённый расчёт: <b style={{ color: 'var(--fg-2)' }}>{savedAt}</b>
              {savedIter ? ` · прогонов: ${savedIter}` : ''}
              {savedSeed ? ` · зерно: ${savedSeed}` : ' · зерно случайное'} — виден на вкладке «Запуски».
            </span>
            {onOpenTab ? (
              <button type="button" onClick={() => onOpenTab('runs')} className="btn btn-secondary btn-sm" style={{ padding: '1px 8px', fontSize: 11 }}>
                Открыть «Запуски» →
              </button>
            ) : null}
          </div>
        ) : null}

        {error ? <div style={{ fontSize: 12.5, color: '#F59E0B' }}>Расчёт не выполнен: {error}</div> : null}

        {result ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
              {tile('Детерминированный срок', hoursText(result.deterministic_duration), 'по одной длительности на операцию')}
              {tile('Средний срок', hoursText(result.mean), 'среднее по прогонам')}
              {tile('p50', hoursText(p.p50), 'половина прогонов быстрее')}
              {tile('p80', hoursText(p.p80), '80 % прогонов укладываются')}
              {tile('p95', hoursText(p.p95), '95 % прогонов укладываются')}
            </div>

            {Object.keys(p).length ? (
              <table className="tbl">
                <thead>
                  <tr><th>Процентиль</th><th>Срок</th><th>Что это значит</th></tr>
                </thead>
                <tbody>
                  {['p50', 'p80', 'p90', 'p95', 'p99'].filter((k) => p[k] !== undefined).map((k) => (
                    <tr key={k}>
                      <td className="t-mono">{k}</td>
                      <td className="t-mono">{hoursText(p[k])}</td>
                      <td style={{ color: 'var(--fg-3)' }}>{k === 'p50' ? 'ровно посередине разброса' : `такой срок или быстрее — в ${k.slice(1)} % прогонов`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}

            {variants.length ? (
              <div>
                <div style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 6 }}>
                  Частота сроков по прогонам — наведите курсор на столбец, клик закрепляет выбор и показывает вероятность уложиться в этот срок.
                </div>
                <div onMouseLeave={() => setHoverIdx(null)} style={{ display: 'grid', gap: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 120 }}>
                    {variants.map((v: any, i: number) => {
                      const cnt = Number(v?.count ?? v?.value ?? 0);
                      const h = maxCount ? Math.round((cnt / maxCount) * 112) : 0;
                      const active = pickedIdx === i;
                      const hovered = hoverIdx === i;
                      return (
                        <button
                          key={i}
                          type="button"
                          aria-label={`Столбец ${i + 1}: срок ≤ ${hoursText(v?.to ?? v?.duration ?? v?.hours ?? v?.bin)} · прогонов ${cnt}`}
                          title={`до ${hoursText(v?.to)} · прогонов: ${cnt}`}
                          onMouseEnter={() => setHoverIdx(i)}
                          onFocus={() => setHoverIdx(i)}
                          onBlur={() => setHoverIdx(null)}
                          onClick={() => setPickedIdx(pickedIdx === i ? null : i)}
                          style={{
                            flex: 1,
                            height: Math.max(2, h),
                            background: active ? '#F59E0B' : '#3B82F6',
                            borderRadius: '2px 2px 0 0',
                            opacity: active ? 1 : hovered ? 1 : 0.8,
                            outline: hovered && !active ? '1px solid rgba(147,197,253,.7)' : 'none',
                            border: 'none',
                            padding: 0,
                            cursor: 'pointer',
                          }}
                        />
                      );
                    })}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--fg-4)' }}>
                    <span>{hoursText(variants[0]?.from)}</span>
                    <span>{hoursText((variants[variants.length - 1] as any)?.to)}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: 'var(--fg-4)' }}>Показать на диаграмме:</span>
                    {['p50', 'p80', 'p95'].filter((k) => p[k] !== undefined).map((k) => {
                      const idx = variants.findIndex((v: any) => Number(v?.from) <= Number(p[k]) && Number(p[k]) <= Number(v?.to));
                      return (
                        <button
                          key={k}
                          type="button"
                          onClick={() => idx >= 0 && setPickedIdx(idx)}
                          title={`Подсветить столбец с ${k} = ${hoursText(p[k])}`}
                          style={{ fontSize: 11, color: pctColor[k], background: 'transparent', border: '1px solid ' + pctColor[k] + '66', borderRadius: 6, padding: '1px 8px', cursor: 'pointer' }}
                        >
                          {k} — {hoursText(p[k])}
                        </button>
                      );
                    })}
                  </div>
                  {(hoverIdx !== null || pickedIdx !== null) && (() => {
                    const showingHover = hoverIdx !== null;
                    const i = (showingHover ? hoverIdx : pickedIdx) as number;
                    const v: any = variants[i] || {};
                    const share = cdfShare(i);
                    return (
                      <div style={{ fontSize: 12, color: 'var(--fg-2)' }}>
                        {showingHover ? 'Наведение: ' : 'Выбрано: '}
                        срок ≤ <b>{hoursText(v?.to)}</b> — вероятность уложиться <b>{Math.round(share * 100)} %</b>
                        <span style={{ color: 'var(--fg-4)' }}>
                          {' '}· прогонов в столбце: {Number(v?.count ?? 0)} из {totalRuns}
                          {!showingHover ? '; повторный клик — снять выбор' : ''}
                        </span>
                      </div>
                    );
                  })()}
                </div>
              </div>
            ) : null}

            {curve.length ? (
              <div>
                <div style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 6 }}>Вероятность уложиться в срок (S-кривая)</div>
                <table className="tbl">
                  <thead><tr><th>Срок</th><th>Вероятность</th></tr></thead>
                  <tbody>
                    {curve.filter((_: any, i: number) => i % Math.max(1, Math.round(curve.length / 12)) === 0).slice(0, 14).map((pt: any, i: number) => (
                      <tr key={i}>
                        <td className="t-mono">{hoursText(pt?.duration ?? pt?.x)}</td>
                        <td className="t-mono">{Math.round(Number(pt?.probability ?? pt?.y ?? 0) * 100)} %</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {result.warnings?.length ? (
              <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>
                Предупреждения: {result.warnings.join(' · ')}
              </div>
            ) : null}
          </>
        ) : (
          <div style={{ fontSize: 12.5, color: 'var(--fg-3)', display: 'grid', gap: 8 }}>
            <span>Нажмите «Рассчитать»: покажем распределение срока, процентили и вероятность уложиться в дату. Оценки берутся из вкладки «Оценки» — то, что заполнено по операциям проекта.</span>
            {onOpenTab ? (
              <div><button className="btn btn-secondary btn-sm" onClick={() => onOpenTab('estimates')}>Открыть «Оценки» →</button></div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
