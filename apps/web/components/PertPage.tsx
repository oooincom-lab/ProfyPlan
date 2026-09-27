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
import React, { useMemo } from 'react';

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

export default function PertPage({ operations }: { operations: PertOp[] }) {
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
    const variance = critical.reduce((sum, r) => sum + r.variance, 0);
    const sigma = Math.sqrt(variance);
    const totalVariance = variance || 1;
    return { withEstimates, critical, expected, sigma, totalVariance };
  }, [operations]);

  const noEstimates = data.withEstimates.length === 0;
  const noCriticalEstimates = !noEstimates && data.critical.length === 0;

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
      </div>
      <div style={{ padding: '12px 16px', display: 'grid', gap: 12 }}>
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
