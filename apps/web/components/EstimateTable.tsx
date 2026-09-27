'use client';
/**
 * Экспертная таблица тройных оценок (блок 6.17 плана).
 *
 * Ввод по всем операциям проекта: оптимистичная, наиболее вероятная и пессимистичная оценки.
 * Рядом сразу видно, что из них следует: ожидаемая длительность и разброс (PERT).
 * Правило порядка — оптимистичная ≤ вероятная ≤ пессимистичная: нарушение подсвечивается,
 * и такая строка не сохраняется, пока порядок не исправлен.
 *
 * Значения по умолчанию не подставляются: пустая оценка остаётся пустой, а не превращается
 * в правдоподобное число.
 */
import React, { useMemo, useState } from 'react';

export type EstimateOp = {
  id: string;
  name: string;
  duration_base?: number | string | null;
  to_optimistic?: number | string | null;
  tm_likely?: number | string | null;
  tp_pessimistic?: number | string | null;
};

/** Ожидаемая длительность и разброс по трём оценкам (PERT). */
export function pertEstimate(to: number, tm: number, tp: number): { mean: number; sigma: number } {
  const mean = (to + 4 * tm + tp) / 6;
  const sigma = (tp - to) / 6;
  return { mean, sigma };
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export default function EstimateTable({
  operations,
  onSave,
}: {
  operations: EstimateOp[];
  onSave: (id: string, patch: Record<string, number | null>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Record<string, { to: string; tm: string; tp: string }>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const filled = useMemo(
    () => operations.filter((o) => num(o.to_optimistic) !== null && num(o.tm_likely) !== null && num(o.tp_pessimistic) !== null).length,
    [operations],
  );

  const cell = (id: string, key: 'to' | 'tm' | 'tp'): string => {
    const d = draft[id];
    if (d) return d[key];
    const op = operations.find((o) => o.id === id);
    const v = op ? num(key === 'to' ? op.to_optimistic : key === 'tm' ? op.tm_likely : op.tp_pessimistic) : null;
    return v === null ? '' : String(v);
  };

  const setCell = (id: string, key: 'to' | 'tm' | 'tp', value: string) => {
    setDraft((prev) => {
      const cur = prev[id] || { to: cell(id, 'to'), tm: cell(id, 'tm'), tp: cell(id, 'tp') };
      return { ...prev, [id]: { ...cur, [key]: value } };
    });
  };

  const rowNumbers = (op: EstimateOp) => ({
    to: num(cell(op.id, 'to')),
    tm: num(cell(op.id, 'tm')),
    tp: num(cell(op.id, 'tp')),
  });

  const saveRow = async (op: EstimateOp) => {
    const { to, tm, tp } = rowNumbers(op);
    if (to === null && tm === null && tp === null) return;
    if (to !== null && tm !== null && tp !== null && !(to <= tm && tm <= tp)) {
      setNote('Порядок оценок нарушен: должно быть оптимистичная ≤ вероятная ≤ пессимистичная');
      return;
    }
    setSavingId(op.id);
    try {
      await onSave(op.id, { to_optimistic: to, tm_likely: tm, tp_pessimistic: tp });
      setDraft((prev) => {
        const next = { ...prev };
        delete next[op.id];
        return next;
      });
      setNote('Оценки сохранены');
    } catch (e: any) {
      setNote('Не удалось сохранить: ' + (e?.message || String(e)));
    } finally {
      setSavingId(null);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: 62,
    background: '#0B1B33',
    color: 'var(--fg)',
    border: '1px solid var(--border-2)',
    borderRadius: 5,
    padding: '3px 6px',
    fontSize: 12,
    textAlign: 'right',
    fontFamily: 'ui-monospace, monospace',
  };

  return (
    <div className="panel">
      <div className="panel-hdr">
        <div>
          <span className="panel-title">Экспертная таблица оценок</span>
          <span className="panel-sub">
            операций {operations.length} · оценок заполнено {filled} из {operations.length}
          </span>
        </div>
      </div>
      <div style={{ padding: '0 16px 14px' }}>
        <div style={{ fontSize: 12, color: 'var(--fg-3)', margin: '8px 0 10px' }}>
          Введите три оценки по каждой операции. Порядок: оптимистичная ≤ вероятная ≤ пессимистичная — иначе строка
          не сохранится. Ожидаемая длительность и разброс считаются тут же и ничего не меняют в данных.
        </div>
        {operations.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--fg-3)' }}>
            У проекта ещё нет операций: сначала нужен состав и маршрут (окно заказа, вкладка «Маршрут»).
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Операция</th>
                <th>Опт.</th>
                <th>Вероятн.</th>
                <th>Пессим.</th>
                <th>Ожидаемая</th>
                <th>Разброс σ</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {operations.map((op) => {
                const { to, tm, tp } = rowNumbers(op);
                const allThree = to !== null && tm !== null && tp !== null;
                const badOrder = allThree && !(to! <= tm! && tm! <= tp!);
                const est = allThree ? pertEstimate(to!, tm!, tp!) : null;
                const dirty = !!draft[op.id];
                return (
                  <tr key={op.id}>
                    <td style={{ maxWidth: 340 }}>{op.name}</td>
                    <td><input style={{ ...inputStyle, borderColor: badOrder ? '#F59E0B' : undefined }} value={cell(op.id, 'to')} onChange={(e) => setCell(op.id, 'to', e.target.value)} placeholder="—" /></td>
                    <td><input style={{ ...inputStyle, borderColor: badOrder ? '#F59E0B' : undefined }} value={cell(op.id, 'tm')} onChange={(e) => setCell(op.id, 'tm', e.target.value)} placeholder="—" /></td>
                    <td><input style={{ ...inputStyle, borderColor: badOrder ? '#F59E0B' : undefined }} value={cell(op.id, 'tp')} onChange={(e) => setCell(op.id, 'tp', e.target.value)} placeholder="—" /></td>
                    <td className="t-mono">{est ? est.mean.toFixed(2) : '—'}</td>
                    <td className="t-mono">{est ? est.sigma.toFixed(2) : '—'}</td>
                    <td>
                      {dirty ? (
                        <button className="btn btn-primary btn-sm" disabled={badOrder || savingId === op.id} onClick={() => saveRow(op)} title={badOrder ? 'Проверьте порядок оценок' : 'Сохранить строку'}>
                          {savingId === op.id ? '…' : 'Сохранить'}
                        </button>
                      ) : (
                        <span style={{ color: 'var(--fg-4)', fontSize: 11 }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {note ? <div style={{ marginTop: 10, fontSize: 12, color: 'var(--fg-3)' }}>{note}</div> : null}
      </div>
    </div>
  );
}
