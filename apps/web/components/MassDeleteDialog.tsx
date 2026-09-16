'use client';

/**
 * Мастер массового удаления для общей таблицы справочников (DirectoryTable).
 *
 * Порядок работы:
 *   1. Сухой прогон — по каждой выбранной записи дёргаем /v1/delete-check и сводим итог.
 *   2. Для заблокированных записей пользователь выбирает: перенести ссылки / в архив / пропустить.
 *   3. Выполнение — удаление безопасных записей и выбранные действия по заблокированным.
 *
 * Безопасные записи удаляются через /v1/safe-delete. Перенос ссылок и архив доступны
 * только для справочника операций (архив и замена ссылок поддерживается именно там).
 */

import { useEffect, useMemo, useState } from 'react';

type DepGroup = { key: string; label: string; count: number };
type CheckResult = {
  entity?: { type?: string; id?: string; name?: string; label?: string };
  cascade?: DepGroup[];
  blocking?: DepGroup[];
  can_delete?: boolean;
};
type Row = { id: string; name: string };
type BlockedMode = 'replace' | 'archive' | 'skip';

type Props = {
  apiBase: string;
  entity: string;
  entityType: string;
  entityLabel: string;
  ids: string[];
  rows: Row[];
  replaceOptions: { id: string; name: string }[];
  archiveCapable: boolean;
  onClose: () => void;
  onDone: () => void;
};

export default function MassDeleteDialog({ apiBase, entity, entityType, entityLabel, ids, rows, replaceOptions, archiveCapable, onClose, onDone }: Props) {
  const [phase, setPhase] = useState<'checking' | 'ready' | 'running' | 'done'>('checking');
  const [checks, setChecks] = useState<Record<string, CheckResult | null>>({});
  const [checkErrors, setCheckErrors] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<Record<string, BlockedMode>>({});
  const [replaceTarget, setReplaceTarget] = useState('');
  const [result, setResult] = useState<{ deleted: number; archived: number; skipped: number; failed: number } | null>(null);

  const token = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
  const authHeaders = (): Record<string, string> => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) h['Authorization'] = 'Bearer ' + token;
    return h;
  };
  const nameOf = (id: string) => rows.find(r => String(r.id) === String(id))?.name || id;
  // Перенос ссылок поддерживается только в справочнике операций.
  const canReplace = entityType === 'catalog_operation' && replaceOptions.length > 0;

  useEffect(() => {
    let alive = true;
    (async () => {
      const next: Record<string, CheckResult | null> = {};
      const errs: Record<string, string> = {};
      await Promise.all(ids.map(async (id) => {
        try {
          const r = await fetch(`${apiBase}/v1/delete-check/${entityType}/${id}`, { headers: authHeaders() });
          if (!r.ok) { next[id] = null; errs[id] = 'проверка недоступна (HTTP ' + r.status + ')'; return; }
          next[id] = await r.json();
        } catch (e: any) { next[id] = null; errs[id] = e?.message || 'ошибка проверки'; }
      }));
      if (!alive) return;
      const dm: Record<string, BlockedMode> = {};
      for (const id of ids) {
        const c = next[id];
        const blocked = !c || c.can_delete !== true;
        if (blocked) dm[id] = archiveCapable ? 'archive' : 'skip';
      }
      setChecks(next); setCheckErrors(errs); setMode(dm); setPhase('ready');
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const safeIds = useMemo(() => ids.filter(id => checks[id]?.can_delete === true), [ids, checks]);
  const blockedIds = useMemo(() => ids.filter(id => checks[id]?.can_delete !== true), [ids, checks]);

  const cascadeTotal = useMemo(
    () => safeIds.reduce((s, id) => s + ((checks[id]?.cascade || []).reduce((a, c) => a + (Number(c.count) || 0), 0)), 0),
    [safeIds, checks],
  );

  const plan = useMemo(() => {
    let del = safeIds.length, rep = 0, arch = 0, skip = 0;
    for (const id of blockedIds) {
      const m = mode[id] || 'skip';
      if (m === 'replace' && canReplace && replaceTarget) rep++;
      else if (m === 'archive' && archiveCapable) arch++;
      else skip++;
    }
    return { del, rep, arch, skip };
  }, [safeIds, blockedIds, mode, canReplace, replaceTarget, archiveCapable]);

  const needReplaceTarget = blockedIds.some(id => (mode[id] || 'skip') === 'replace') && canReplace;

  const run = async () => {
    setPhase('running');
    const res = { deleted: 0, archived: 0, skipped: 0, failed: 0 };
    for (const id of ids) {
      const c = checks[id];
      try {
        if (c?.can_delete === true) {
          const r = await fetch(`${apiBase}/v1/safe-delete/${entityType}/${id}`, { method: 'DELETE', headers: authHeaders() });
          if (r.ok) res.deleted++; else res.failed++;
          continue;
        }
        const m = mode[id] || 'skip';
        if (m === 'replace' && canReplace && replaceTarget) {
          const r = await fetch(`${apiBase}/v1/safe-delete/${entityType}/${id}?replace_with=${encodeURIComponent(replaceTarget)}`, { method: 'DELETE', headers: authHeaders() });
          if (r.ok) res.deleted++; else res.failed++;
        } else if (m === 'archive' && archiveCapable) {
          const r = await fetch(`${apiBase}/v1/directory/bulk/state`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ entity, ids: [id], is_active: false }) });
          if (r.ok) res.archived++; else res.failed++;
        } else {
          res.skipped++;
        }
      } catch {
        res.failed++;
      }
    }
    setResult(res);
    setPhase('done');
  };

  const plural = (n: number, one: string, few: string, many: string) => {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  };

  const btn = (extra?: React.CSSProperties): React.CSSProperties => ({
    border: '1px solid #2A4060', borderRadius: 6, padding: '6px 14px', fontSize: 12.5,
    cursor: 'pointer', fontFamily: 'Inter, sans-serif', ...extra,
  });

  const blockingText = (id: string): string => {
    if (checkErrors[id]) return checkErrors[id];
    const c = checks[id];
    if (!c) return 'проверка недоступна';
    if (c.can_delete === true) return '';
    const parts = (c.blocking || []).filter(b => (b.count || 0) > 0).map(b => `${b.label} (${b.count})`);
    const cas = (c.cascade || []).filter(b => (b.count || 0) > 0).map(b => `${b.label} (${b.count})`);
    const all = [...parts, ...cas];
    return all.length ? 'связано: ' + all.join(', ') : 'есть связи';
  };

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(3,10,20,.62)', zIndex: 10100 }} onClick={phase === 'running' ? undefined : onClose} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: '#0F1B2D', border: '1px solid #2A4060', borderRadius: 12, width: 560, maxWidth: '94vw', maxHeight: '84vh', display: 'flex', flexDirection: 'column', zIndex: 10101, boxShadow: '0 18px 50px rgba(0,0,0,.55)' }}>
        <div style={{ padding: '16px 20px 10px', borderBottom: '1px solid #1E3252' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#E8EEF5' }}>🗑 Массовое удаление — {entityLabel}</div>
          <div style={{ fontSize: 12, color: '#5A7090', marginTop: 2 }}>Выбрано записей: {ids.length}</div>
        </div>

        <div style={{ padding: '14px 20px', overflowY: 'auto', flex: 1 }}>
          {phase === 'checking' && (
            <div style={{ padding: '30px 0', textAlign: 'center', color: '#5A7090', fontSize: 13 }}>
              Сухой прогон: проверяю связи по {ids.length} {plural(ids.length, 'записи', 'записям', 'записям')}...
            </div>
          )}

          {phase !== 'checking' && (
            <>
              {/* Итог сухого прогона */}
              <div style={{ background: 'rgba(59,130,246,.08)', border: '1px solid rgba(59,130,246,.28)', borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
                <div style={{ fontSize: 12.5, color: '#CBD8EA' }}>
                  <span style={{ color: '#34D399', fontWeight: 600 }}>Будет удалено: {plan.del}</span>
                  {cascadeTotal > 0 && <span style={{ color: '#8FA3BD' }}> (+{cascadeTotal} связанных)</span>}
                  {plan.rep > 0 && <span style={{ color: '#93C5FD' }}> · Перенесено: {plan.rep}</span>}
                  {plan.arch > 0 && <span style={{ color: '#FBBF24' }}> · В архив: {plan.arch}</span>}
                  {plan.skip > 0 && <span style={{ color: '#8FA3BD' }}> · Пропущено: {plan.skip}</span>}
                </div>
                <div style={{ fontSize: 11.5, color: '#5A7090', marginTop: 4 }}>
                  Заблокировано: {blockedIds.length} — для них выберите действие ниже.
                </div>
              </div>

              {blockedIds.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: '#60A5FA', marginBottom: 6 }}>
                    Заблокированные записи
                  </div>
                  {blockedIds.map(id => (
                    <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', background: 'rgba(220,38,38,.07)', border: '1px solid rgba(220,38,38,.18)', borderRadius: 7, marginBottom: 6 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, color: '#E8EEF5', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nameOf(id)}</div>
                        <div style={{ fontSize: 11, color: '#F87171', marginTop: 1 }}>{blockingText(id)}</div>
                      </div>
                      <select
                        value={mode[id] || 'skip'}
                        onChange={e => setMode(m => ({ ...m, [id]: e.target.value as BlockedMode }))}
                        style={{ background: '#0A1628', border: '1px solid #2A4060', borderRadius: 6, color: '#CBD8EA', padding: '4px 6px', fontSize: 12, minWidth: 150 }}
                      >
                        {canReplace && <option value="replace">Перенести ссылки</option>}
                        {archiveCapable && <option value="archive">В архив</option>}
                        <option value="skip">Пропустить</option>
                      </select>
                    </div>
                  ))}
                </div>
              )}

              {needReplaceTarget && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 10px', background: 'rgba(59,130,246,.08)', border: '1px solid rgba(59,130,246,.28)', borderRadius: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 12.5, color: '#8FA3BD' }}>Перенести ссылки на:</span>
                  <select value={replaceTarget} onChange={e => setReplaceTarget(e.target.value)}
                    style={{ background: '#0A1628', border: '1px solid #2A4060', borderRadius: 6, color: '#E8EEF5', padding: '4px 8px', fontSize: 12.5, minWidth: 220 }}>
                    <option value="">— выберите запись —</option>
                    {replaceOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                  {!replaceTarget && <span style={{ fontSize: 11.5, color: '#FBBF24' }}>пока не выбрана — такие записи будут пропущены</span>}
                </div>
              )}

              {result && phase === 'done' && (
                <div style={{ background: 'rgba(16,185,129,.1)', border: '1px solid rgba(16,185,129,.3)', borderRadius: 8, padding: '10px 12px', fontSize: 12.5, color: '#A7F3D0' }}>
                  Удалено: {result.deleted} · В архив: {result.archived} · Пропущено: {result.skipped}
                  {result.failed > 0 && <span style={{ color: '#FCA5A5' }}> · Ошибок: {result.failed}</span>}
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ padding: '12px 20px 16px', display: 'flex', gap: 10, justifyContent: 'flex-end', borderTop: '1px solid #1E3252' }}>
          {phase === 'done' ? (
            <button style={btn({ background: 'linear-gradient(135deg,#3B82F6,#2563EB)', border: '1px solid #3B82F6', color: '#fff', fontWeight: 600 })}
              onClick={() => { onDone(); onClose(); }}>Готово</button>
          ) : (
            <>
              <button style={btn({ background: '#334155', color: '#CBD5E1' })} disabled={phase === 'running'} onClick={onClose}>Отмена</button>
              <button
                style={btn({ background: plan.del + plan.rep + plan.arch > 0 ? 'linear-gradient(135deg,#DC2626,#B91C1C)' : '#1E3252', border: '1px solid ' + (plan.del + plan.rep + plan.arch > 0 ? '#DC2626' : '#2A4060'), color: plan.del + plan.rep + plan.arch > 0 ? '#fff' : '#5A7090', fontWeight: 600, cursor: phase === 'running' || plan.del + plan.rep + plan.arch === 0 ? 'not-allowed' : 'pointer' })}
                disabled={phase === 'running' || plan.del + plan.rep + plan.arch === 0}
                onClick={run}
                title={plan.del + plan.rep + plan.arch === 0 ? 'Нет записей для действия' : 'Выполнить'}
              >
                {phase === 'running' ? 'Выполняю...' : 'Продолжить'}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
