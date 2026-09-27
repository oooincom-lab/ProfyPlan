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
import React, { useState } from 'react';

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
}: {
  onRun: (iterations: number, seed: number | null) => Promise<McResult>;
}) {
  const [iterations, setIterations] = useState(10000);
  const [seed, setSeed] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<McResult | null>(null);
  const [error, setError] = useState('');

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
                <div style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 6 }}>Частота сроков по прогонам</div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 120 }}>
                  {variants.map((v: any, i: number) => {
                    const h = maxCount ? Math.round((Number(v?.count ?? v?.value ?? 0) / maxCount) * 112) : 0;
                    return (
                      <div
                        key={i}
                        title={`${hoursText(v?.duration ?? v?.hours ?? v?.bin)} · ${v?.count ?? v?.value ?? ''}`}
                        style={{ flex: 1, height: Math.max(2, h), background: '#3B82F6', borderRadius: '2px 2px 0 0', opacity: 0.85 }}
                      />
                    );
                  })}
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
          <div style={{ fontSize: 12.5, color: 'var(--fg-3)' }}>
            Нажмите «Рассчитать»: покажем распределение срока, процентили и вероятность уложиться в дату. Оценки берутся
            из вкладки «Оценки» — сейчас это {result ? '' : 'то, что заполнено по операциям проекта'}.
          </div>
        )}
      </div>
    </div>
  );
}
