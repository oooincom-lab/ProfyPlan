/**
 * OperationPanel — боковая панель редактирования фактического выполнения.
 */
'use client';

import { useState, useEffect } from 'react';
import type { CPMNode, ActualFact } from '@/lib/types';
import { getActual, saveActual } from '@/lib/api';

interface Props {
  node: CPMNode | null;
  onSave: (updatedNode: CPMNode) => void;
  onClose: () => void;
  onStatusChange: (nodeId: string, newStatus: string) => void;
}

const STATUS_OPTIONS = [
  { key: 'not_started', label: 'Не начата' },
  { key: 'in_progress', label: 'В процессе' },
  { key: 'completed', label: 'Завершена' },
  { key: 'delayed', label: 'Задержана' },
  { key: 'cancelled', label: 'Отменена' },
];

const REASON_OPTIONS = [
  { value: '', label: '— нет отклонений —' },
  { value: 'machine', label: 'Простой станка' },
  { value: 'material', label: 'Отсутствие материала' },
  { value: 'tool', label: 'Брак инструмента' },
  { value: 'quality', label: 'Качество сырья' },
  { value: 'plan_error', label: 'Ошибка планирования' },
  { value: 'other', label: 'Другое' },
];

export default function OperationPanel({ node, onSave, onClose, onStatusChange }: Props) {
  const [actual, setActual] = useState<ActualFact | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState('not_started');
  const [factStart, setFactStart] = useState('');
  const [factEnd, setFactEnd] = useState('');
  const [qtyDone, setQtyDone] = useState<number | ''>('');
  const [qtyDefect, setQtyDefect] = useState<number | ''>('');
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');

  useEffect(() => {
    if (!node) return;
    setLoading(true);
    setError(null);
    getActual(node.id)
      .then(data => {
        if (data) {
          setActual(data);
          setStatus(data.status || 'not_started');
          setFactStart(data.fact_start ? data.fact_start.slice(0, 16) : '');
          setFactEnd(data.fact_end ? data.fact_end.slice(0, 16) : '');
          setQtyDone(data.quantity_completed ?? '');
          setQtyDefect(data.quantity_defect ?? '');
          setReason(data.deviation_reason || '');
          setComment(data.comment || '');
        } else {
          // New — prefill from plan
          setActual(null);
          setStatus('not_started');
          setFactStart('');
          setFactEnd('');
          setQtyDone('');
          setQtyDefect('');
          setReason('');
          setComment('');
        }
      })
      .catch(() => setError('Ошибка загрузки'))
      .finally(() => setLoading(false));
  }, [node]);

  if (!node) return null;

  const handleStatusClick = (newStatus: string) => {
    setStatus(newStatus);
    onStatusChange(node.id, newStatus);
  };

  const handleSave = async () => {
    if (!node) return;
    setSaving(true);
    setError(null);
    try {
      const data: ActualFact = {
        operation_id: node.id,
        status: status as ActualFact['status'],
        fact_start: factStart ? new Date(factStart).toISOString() : undefined,
        fact_end: factEnd ? new Date(factEnd).toISOString() : undefined,
        quantity_completed: qtyDone === '' ? undefined : Number(qtyDone),
        quantity_defect: qtyDefect === '' ? undefined : Number(qtyDefect),
        deviation_reason: reason || undefined,
        comment: comment || undefined,
        source: 'manual',
      };
      const result = await saveActual(node.id, data);
      setActual(result);
      const updated = { ...node };
      onSave(updated);
    } catch (e: any) {
      setError(e.message || 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const dirty = actual
    ? (status !== actual.status ||
       factStart !== (actual.fact_start?.slice(0, 16) || '') ||
       factEnd !== (actual.fact_end?.slice(0, 16) || '') ||
       (qtyDone === '' ? undefined : Number(qtyDone)) !== actual.quantity_completed ||
       (qtyDefect === '' ? undefined : Number(qtyDefect)) !== actual.quantity_defect ||
       reason !== (actual.deviation_reason || '') ||
       comment !== (actual.comment || ''))
    : (status !== 'not_started' || factStart || factEnd || qtyDone !== '' || qtyDefect !== '' || reason || comment);

  return (
    <div style={{
      width: 340, background: 'var(--bg-2, #0F1E36)',
      borderLeft: '1px solid var(--border, #1E3252)',
      display: 'flex', flexDirection: 'column', overflowY: 'auto',
      flexShrink: 0,
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 18px', borderBottom: '1px solid var(--border, #1E3252)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>⚙ {node.name}</h3>
          <span style={{ fontSize: 10, color: 'var(--fg-4, #5A7090)' }}>
            План: {node.early_start}ч – {node.early_finish}ч ({node.duration}ч)
            {node.is_critical ? ' | Критический' : ''}
          </span>
        </div>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', color: 'var(--fg-4, #5A7090)',
          fontSize: 20, cursor: 'pointer', padding: 0, lineHeight: 1,
        }}>&times;</button>
      </div>

      {/* Body */}
      <div style={{ padding: '14px 18px' }}>
        {loading && <div style={{ fontSize: 12, color: 'var(--fg-4)' }}>Загрузка...</div>}
        {error && <div style={{ fontSize: 12, color: 'var(--danger, #EF4444)', marginBottom: 12 }}>{error}</div>}

        {/* Status */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: 'var(--fg-3)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Статус
          </label>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {STATUS_OPTIONS.map(opt => (
              <button
                key={opt.key}
                onClick={() => handleStatusClick(opt.key)}
                style={{
                  padding: '4px 10px', borderRadius: 100,
                  fontSize: 10, fontWeight: 600, cursor: 'pointer',
                  border: status === opt.key
                    ? '1px solid var(--accent, #3B82F6)'
                    : '1px solid var(--border, #1E3252)',
                  background: status === opt.key
                    ? 'rgba(59,130,246,0.15)'
                    : 'var(--bg, #0A1628)',
                  color: status === opt.key
                    ? 'var(--accent-3, #60A5FA)'
                    : 'var(--fg-3, #8FA3BD)',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Date row */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: 'var(--fg-3)', marginBottom: 4, textTransform: 'uppercase' }}>
              Факт. начало
            </label>
            <input
              type="datetime-local"
              value={factStart}
              onChange={e => setFactStart(e.target.value)}
              style={{
                width: '100%', padding: '6px 10px', borderRadius: 6,
                background: 'var(--bg, #0A1628)', border: '1px solid var(--border, #1E3252)',
                color: 'var(--fg)', fontSize: 12, fontFamily: 'inherit',
              }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: 'var(--fg-3)', marginBottom: 4, textTransform: 'uppercase' }}>
              Факт. завершение
            </label>
            <input
              type="datetime-local"
              value={factEnd}
              onChange={e => setFactEnd(e.target.value)}
              style={{
                width: '100%', padding: '6px 10px', borderRadius: 6,
                background: 'var(--bg, #0A1628)', border: '1px solid var(--border, #1E3252)',
                color: 'var(--fg)', fontSize: 12, fontFamily: 'inherit',
              }}
            />
          </div>
        </div>

        {/* Qty row */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: 'var(--fg-3)', marginBottom: 4, textTransform: 'uppercase' }}>
              Выполнено, шт
            </label>
            <input
              type="number"
              value={qtyDone}
              onChange={e => setQtyDone(e.target.value ? Number(e.target.value) : '')}
              placeholder="100"
              style={{
                width: '100%', padding: '6px 10px', borderRadius: 6,
                background: 'var(--bg, #0A1628)', border: '1px solid var(--border, #1E3252)',
                color: 'var(--fg)', fontSize: 12, fontFamily: 'inherit',
              }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: 'var(--fg-3)', marginBottom: 4, textTransform: 'uppercase' }}>
              Брак, шт
            </label>
            <input
              type="number"
              value={qtyDefect}
              onChange={e => setQtyDefect(e.target.value ? Number(e.target.value) : '')}
              placeholder="0"
              style={{
                width: '100%', padding: '6px 10px', borderRadius: 6,
                background: 'var(--bg, #0A1628)', border: '1px solid var(--border, #1E3252)',
                color: 'var(--fg)', fontSize: 12, fontFamily: 'inherit',
              }}
            />
          </div>
        </div>

        {/* Reason */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: 'var(--fg-3)', marginBottom: 4, textTransform: 'uppercase' }}>
            Причина отклонения
          </label>
          <select
            value={reason}
            onChange={e => setReason(e.target.value)}
            style={{
              width: '100%', padding: '6px 10px', borderRadius: 6,
              background: 'var(--bg, #0A1628)', border: '1px solid var(--border, #1E3252)',
              color: 'var(--fg)', fontSize: 12, fontFamily: 'inherit',
            }}
          >
            {REASON_OPTIONS.map(r => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>

        {/* Comment */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: 'var(--fg-3)', marginBottom: 4, textTransform: 'uppercase' }}>
            Комментарий
          </label>
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="Детали выполнения..."
            rows={3}
            style={{
              width: '100%', padding: '6px 10px', borderRadius: 6,
              background: 'var(--bg, #0A1628)', border: '1px solid var(--border, #1E3252)',
              color: 'var(--fg)', fontSize: 12, fontFamily: 'inherit',
              resize: 'vertical',
            }}
          />
        </div>

        {/* Action row */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1, padding: '8px', borderRadius: 6,
              background: 'var(--bg, #0A1628)', border: '1px solid var(--border, #1E3252)',
              color: 'var(--fg-2)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Отмена
          </button>
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            style={{
              flex: 1, padding: '8px', borderRadius: 6, border: 'none',
              background: dirty ? 'var(--accent, #3B82F6)' : 'var(--bg-3, #162844)',
              color: dirty ? '#fff' : 'var(--fg-4)',
              fontSize: 12, fontWeight: 600, cursor: dirty ? 'pointer' : 'default',
            }}
          >
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>

        {/* Audit bar */}
        {actual && actual.source && (
          <div style={{
            paddingTop: 10, borderTop: '1px solid var(--border, #1E3252)',
            fontSize: 10, color: 'var(--fg-4)', lineHeight: 1.5,
          }}>
            <div>
              Создано: {actual.recorded_at || actual.updated_at || '—'}&nbsp;
              ({actual.source === 'auto_closed' ? 'автоматически' : 'вручную'})
            </div>
            {actual.updated_at && actual.updated_at !== actual.recorded_at && (
              <div>
                <strong>Последнее изменение: {actual.updated_at}</strong>&nbsp;
                {actual.edit_count != null && actual.edit_count > 0 && (
                  <span>· правок: {actual.edit_count}</span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
