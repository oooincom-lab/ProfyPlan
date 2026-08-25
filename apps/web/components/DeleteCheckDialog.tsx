'use client';

import { useState } from 'react';
import DebugBadge from './DebugBadge';

interface DeleteCheckResult {
  entity: { type: string; id: string; name: string; label: string };
  cascade: Array<{ key: string; label: string; count: number; items: Array<{ name: string; field?: string }> }>;
  blocking: Array<{ key: string; label: string; count: number; items: Array<{ name: string; field?: string }> }>;
  detach: Array<{ key: string; label: string; count: number; items: Array<{ name: string; field?: string }>; message: string }>;
  can_delete: boolean;
}

interface DeleteCheckDialogProps {
  entityType: string;
  entityId: string;
  entityName?: string;
  onClose: () => void;
  onDeleted?: () => void;
  result?: DeleteCheckResult | null;
  loading?: boolean;
  error?: string | null;
  debug?: boolean;
}

export default function DeleteCheckDialog({ entityType, entityId, entityName, onClose, onDeleted, result, loading, error, debug = false }: DeleteCheckDialogProps) {
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDelete = async () => {
    if (!result?.can_delete) return;
    setDeleting(true);
    try {
      const tok = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
      const h: Record<string, string> = { 'Content-Type': 'application/json' };
      if (tok) h['Authorization'] = `Bearer ${tok}`;
      const r = await fetch('https://profyplan.ru/api/v1/safe-delete/' + entityType + '/' + entityId, {
        method: 'DELETE',
        headers: h,
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ detail: r.statusText }));
        setDeleteError(err.detail || 'Ошибка удаления');
        setDeleting(false);
        return;
      }
      onDeleted?.();
      onClose();
    } catch (e: any) {
      setDeleteError(e.message || 'Ошибка удаления');
      setDeleting(false);
    }
  };

  const displayError = error || deleteError;
  const totalCascade = result?.cascade.reduce((s, c) => s + c.count, 0) || 0;
  const totalBlocking = result?.blocking.reduce((s, b) => s + b.count, 0) || 0;

  return (
    <>
      <div style={styles.overlay} onClick={onClose} />
      <div style={styles.dialog}>
        <style>{`
          .dc-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:999}
          .dc-dialog{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#1E293B;border:1px solid #334155;border-radius:12px;padding:0;width:480px;max-width:90vw;max-height:80vh;display:flex;flex-direction:column;z-index:1000;box-shadow:0 16px 48px rgba(0,0,0,.4)}
          .dc-header{padding:20px 24px 12px;border-bottom:1px solid #334155}
          .dc-title{font-size:16px;font-weight:600;color:#F1F5F9;margin:0 0 4px}
          .dc-entity{font-size:13px;color:#64748B}
          .dc-body{padding:16px 24px;overflow-y:auto;flex:1}
          .dc-block{background:rgba(220,38,38,.08);border:1px solid rgba(220,38,38,.15);border-radius:8px;padding:10px 14px;margin-bottom:10px}
          .dc-block-title{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin:0 0 6px;color:#F87171}
          .dc-cascade{background:rgba(59,130,246,.06);border:1px solid rgba(59,130,246,.1);border-radius:8px;padding:10px 14px;margin-bottom:8px}
          .dc-cascade-title{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin:0 0 6px;color:#60A5FA}
          .dc-row{font-size:12px;color:#94A3B8;padding:2px 0 2px 12px;border-left:2px solid #334155;margin:2px 0}
          .dc-row-more{font-size:11px;color:#64748B;padding:2px 0 2px 12px;font-style:italic}
          .dc-footer{padding:12px 24px 20px;display:flex;gap:10px;justify-content:flex-end;border-top:1px solid #334155}
          .dc-safe{background:rgba(5,150,105,.12);border:1px solid rgba(5,150,105,.15);border-radius:8px;padding:10px 14px;margin-bottom:8px}
          .dc-safe-text{font-size:12px;color:#34D399;margin:0}
          .dc-btn{border:none;border-radius:8px;padding:8px 20px;font-size:13px;font-weight:500;cursor:pointer;transition:all .12s;font-family:Inter,sans-serif}
          .dc-btn-cancel{background:#334155;color:#CBD5E1}
          .dc-btn-cancel:hover{background:#475569}
          .dc-btn-danger{background:#DC2626;color:#fff}
          .dc-btn-danger:hover{background:#EF4444}
          .dc-btn-danger:disabled{opacity:.4;cursor:not-allowed}
          .dc-loader{display:flex;align-items:center;justify-content:center;padding:40px;color:#64748B;font-size:14px}
        `}</style>
        <div className="dc-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 className="dc-title" style={{ margin: 0 }}>⚠️ Удаление {result?.entity.label.toLowerCase() || entityType}</h2>
            <DebugBadge debug={debug} text="[delete:dialog]" copy={`[delete:dialog] «${result?.entity.label.toLowerCase() || entityType}»`} />
          </div>
          <div className="dc-entity">{result?.entity.name || entityName || entityId}</div>
        </div>
        <div className="dc-body">
          {loading && <div className="dc-loader">Проверка зависимостей...</div>}
          {displayError && <div className="dc-block"><div className="dc-block-title">Ошибка</div><div className="dc-row">{displayError}</div></div>}
          {result && !result.can_delete && totalBlocking > 0 && (
            <div className="dc-block">
              <div className="dc-block-title">⛔ Невозможно удалить — {totalBlocking} ссылок</div>
              {result.blocking.map(b => (
                <div key={b.key}>
                  <div style={{ fontSize: 12, color: '#FCA5A5', fontWeight: 500, marginTop: 6 }}>{b.label} ({b.count})</div>
                  {b.items.slice(0, 5).map((item, i) => <div key={i} className="dc-row">{item.name}{item.field && <span style={{ color: '#64748B', marginLeft: 6 }}>({item.field})</span>}</div>)}
                  {b.count > 5 && <div className="dc-row-more">...и ещё {b.count - 5}</div>}
                </div>
              ))}
            </div>
          )}
          {result && result.can_delete && totalCascade > 0 && (
            <>
              <div style={{ fontSize: 13, color: '#FBBF24', fontWeight: 500, marginBottom: 8 }}>Будут удалены связанные объекты:</div>
              {result.cascade.map(c => (
                <div key={c.key} className="dc-cascade">
                  <div className="dc-cascade-title">{c.label} ({c.count})</div>
                  {c.items.slice(0, 5).map((item, i) => <div key={i} className="dc-row">{item.name}</div>)}
                  {c.count > 5 && <div className="dc-row-more">...и ещё {c.count - 5}</div>}
                </div>
              ))}
            </>
          )}
          {result?.detach && result.detach.length > 0 && (
            <>
              {result.detach.map(d => (
                <div key={d.key} style={{ background: 'rgba(139,92,246,.08)', border: '1px solid rgba(139,92,246,.15)', borderRadius: 8, padding: '10px 14px', marginBottom: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', margin: '0 0 6px', color: '#A78BFA' }}>{d.label} ({d.count}) — {d.message}</div>
                  {d.items.slice(0, 5).map((item, i) => <div key={i} className="dc-row">{item.name}</div>)}
                  {d.count > 5 && <div className="dc-row-more">...и ещё {d.count - 5}</div>}
                </div>
              ))}
            </>
          )}
          {result && result.can_delete && totalCascade === 0 && (!result.detach || result.detach.length === 0) && (
            <div className="dc-safe"><div className="dc-safe-text">Объект нигде не используется. Удаление безопасно.</div></div>
          )}
        </div>
        <div className="dc-footer">
          <button className="dc-btn dc-btn-cancel" onClick={onClose} disabled={deleting}>{result?.can_delete === false ? 'OK' : 'Отмена'}</button>
          {result?.can_delete && (
            <button className="dc-btn dc-btn-danger" onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Удаление...' : (totalCascade > 0 ? 'Удалить всё (' + (totalCascade + 1) + ')' : (result?.detach?.length ? 'Удалить пул (освободить ' + result.detach.reduce((s, d) => s + d.count, 0) + ')' : 'Удалить'))}
            </button>
          )}
        </div>
      </div>
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 999 },
  dialog: { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: '#1E293B', border: '1px solid #334155', borderRadius: 12, padding: 0, width: 480, maxWidth: '90vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column', zIndex: 1000, boxShadow: '0 16px 48px rgba(0,0,0,.4)' },
};
