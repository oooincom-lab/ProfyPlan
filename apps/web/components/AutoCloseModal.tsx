/**
 * AutoCloseModal — диалог автозакрытия предшествующих операций.
 */
'use client';

import type { CPMNode } from '@/lib/types';

interface Props {
  targetOp: CPMNode;
  predecessors: Array<CPMNode & { index: number }>;
  onAutoClose: () => void;
  onManualOnly: () => void;
  onCancel: () => void;
}

export default function AutoCloseModal({
  targetOp, predecessors, onAutoClose, onManualOnly, onCancel,
}: Props) {
  const opNum = targetOp.id;
  const count = predecessors.length;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div style={{
        background: 'var(--bg-2, #0F1E36)', border: '1px solid var(--border, #1E3252)',
        borderRadius: 12, width: 480, maxHeight: '80vh', overflowY: 'auto',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      }}>
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid var(--border, #1E3252)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 22 }}>⚡</span>
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>
            Автозакрытие предшествующих операций
          </h3>
        </div>

        <div style={{ padding: '16px 20px', fontSize: 13, color: 'var(--fg-2, #B0C4DE)', lineHeight: 1.6 }}>
          <p>
            Операция <strong>{targetOp.name} (№{opNum})</strong> не может быть завершена
            раньше, чем операции на пути к ней.
          </p>
          <p>Следующие операции будут закрыты автоматически по плановым данным:</p>

          <table style={{
            width: '100%', borderCollapse: 'collapse', margin: '12px 0',
          }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', fontSize: 10, color: 'var(--fg-4, #5A7090)', padding: '6px 8px', borderBottom: '1px solid var(--border, #1E3252)' }}>№</th>
                <th style={{ textAlign: 'left', fontSize: 10, color: 'var(--fg-4, #5A7090)', padding: '6px 8px', borderBottom: '1px solid var(--border, #1E3252)' }}>Операция</th>
                <th style={{ textAlign: 'left', fontSize: 10, color: 'var(--fg-4, #5A7090)', padding: '6px 8px', borderBottom: '1px solid var(--border, #1E3252)' }}>По плану</th>
              </tr>
            </thead>
            <tbody>
              {predecessors.map(op => (
                <tr key={op.id}>
                  <td style={{ fontSize: 12, padding: '6px 8px', borderBottom: '1px solid rgba(30,50,82,0.5)' }}>{op.index}</td>
                  <td style={{ fontSize: 12, padding: '6px 8px', borderBottom: '1px solid rgba(30,50,82,0.5)' }}>{op.name}</td>
                  <td style={{ fontSize: 12, padding: '6px 8px', borderBottom: '1px solid rgba(30,50,82,0.5)' }}>{op.duration}ч, 100%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{
          padding: '12px 20px', borderTop: '1px solid var(--border, #1E3252)',
          display: 'flex', gap: 8, justifyContent: 'flex-end',
        }}>
          <button onClick={onCancel} style={{
            background: 'none', color: 'var(--fg-3, #8FA3BD)', border: 'none',
            fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}>
            Отмена
          </button>
          <button onClick={onManualOnly} style={{
            background: 'var(--bg-3, #162844)', color: 'var(--fg-2, #B0C4DE)',
            border: '1px solid var(--border, #1E3252)', padding: '8px 16px',
            borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}>
            Закрыть только №{opNum}
          </button>
          <button onClick={onAutoClose} style={{
            background: 'var(--accent, #3B82F6)', color: '#fff', border: 'none',
            padding: '8px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}>
            Закрыть {count} оп. + перейти к №{opNum}
          </button>
        </div>
      </div>
    </div>
  );
}
