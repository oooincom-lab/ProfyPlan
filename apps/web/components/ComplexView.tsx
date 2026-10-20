'use client';
// Комплекс (C v1): межпроектные связи и объединённый CPM-расчёт (просмотр).
import { useEffect, useMemo, useState } from 'react';

type Api = (path: string, opts?: any) => Promise<any>;

const card: any = { background: 'var(--bg-2, #0D1F3A)', border: '1px solid var(--border, #1E3252)', borderRadius: 10, padding: '12px 14px', marginBottom: 10 };
const inp: any = { background: '#0A1628', border: '1px solid #1E3252', borderRadius: 6, color: '#E8EEF5', padding: '6px 9px', fontSize: 12.5, fontFamily: 'inherit' };
const btn: any = { background: 'transparent', border: '1px solid #2A4060', color: '#8FA3BD', borderRadius: 8, padding: '6px 12px', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' };
const btnP: any = { ...btn, background: '#2563EB', border: 'none', color: '#fff', fontWeight: 600 };
const th: any = { textAlign: 'left', color: '#5A7090', fontWeight: 600, padding: '4px 8px', borderBottom: '1px solid #16294A', fontSize: 11.5 };
const td: any = { padding: '5px 8px', borderBottom: '1px solid #16294A', fontSize: 12, color: '#E8EEF5' };

export default function ComplexView({ api, projects, notify }: { api: Api; projects: any[]; notify: (m: string) => void }) {
  const active = (projects || []).filter((p: any) => p.status !== 'archived');
  const [aId, setAId] = useState('');
  const [bId, setBId] = useState('');
  const [opsA, setOpsA] = useState<any[]>([]);
  const [opsB, setOpsB] = useState<any[]>([]);
  const [links, setLinks] = useState<any[]>([]);
  const [src, setSrc] = useState('');
  const [tgt, setTgt] = useState('');
  const [dtype, setDtype] = useState('FS');
  const [lag, setLag] = useState('0');
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const byId = useMemo(() => new Map((projects || []).map((p: any) => [p.id, p])), [projects]);
  const opsName = useMemo(() => {
    const m = new Map<string, string>();
    [...opsA, ...opsB].forEach((o: any) => m.set(o.id, o.name));
    return m;
  }, [opsA, opsB]);

  useEffect(() => {
    if (!aId && active.length) setAId(active[0].id);
    if (!bId && active.length > 1) setBId(active[1].id);
    /* eslint-disable-next-line */
  }, [projects]);

  useEffect(() => {
    if (!aId) return;
    api(`/projects/${aId}/operations`).then((r: any) => setOpsA(Array.isArray(r) ? r : (r?.items || []))).catch(() => setOpsA([]));
    /* eslint-disable-next-line */
  }, [aId]);
  useEffect(() => {
    if (!bId) return;
    api(`/projects/${bId}/operations`).then((r: any) => setOpsB(Array.isArray(r) ? r : (r?.items || []))).catch(() => setOpsB([]));
    /* eslint-disable-next-line */
  }, [bId]);

  const loadLinks = async () => {
    if (!aId) return;
    try {
      const r = await api(`/ccm/inter-deps?project_id=${aId}`);
      const items = r?.items || [];
      setLinks(items.filter((d: any) => (d.source_project_id === aId && d.target_project_id === bId) || (d.source_project_id === bId && d.target_project_id === aId)));
    } catch {
      setLinks([]);
    }
  };
  /* eslint-disable-next-line */
  useEffect(() => { void loadLinks(); }, [aId, bId]);

  const create = async () => {
    if (!aId || !bId || !src || !tgt) { notify('Выберите проекты и операции для связи'); return; }
    setBusy(true);
    try {
      await api('/ccm/inter-deps', {
        method: 'POST',
        body: JSON.stringify({ source_project_id: aId, source_operation_id: src, target_project_id: bId, target_operation_id: tgt, dependency_type: dtype, lag_hours: Number(lag) || 0 }),
      });
      notify('Связь создана');
      setSrc(''); setTgt('');
      await loadLinks();
    } catch (e: any) { notify('Ошибка создания связи: ' + (e?.message || e)); }
    setBusy(false);
  };

  const del = async (id: string) => {
    try { await api(`/ccm/inter-deps/${id}`, { method: 'DELETE' }); notify('Связь удалена'); await loadLinks(); }
    catch (e: any) { notify('Ошибка удаления: ' + (e?.message || e)); }
  };

  const calc = async () => {
    if (!aId || !bId) { notify('Выберите два проекта'); return; }
    setBusy(true);
    try {
      const r = await api('/ccm/merge', { method: 'POST', body: JSON.stringify([aId, bId]) });
      setRes(r);
      notify(`Расчёт комплекса: ${r.total_duration} ч, критических операций — ${r.critical_count}`);
    } catch (e: any) { notify('Ошибка расчёта: ' + (e?.message || e)); }
    setBusy(false);
  };

  const pname = (id: string) => (byId.get(id)?.name || '—');

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 16, fontWeight: 700 }}>🧩 Комплекс (C v1)</span>
        <span style={{ fontSize: 11.5, color: '#5A7090' }}>межпроектные связи и сквозной CPM; расчёт — только просмотр</span>
      </div>

      <div style={{ ...card, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: '#8FA3BD' }}>Проект A</span>
        <select style={inp} value={aId} onChange={(e) => setAId(e.target.value)}>
          {active.map((p: any) => (<option key={p.id} value={p.id}>{p.name}</option>))}
        </select>
        <span style={{ fontSize: 12, color: '#8FA3BD' }}>Проект B</span>
        <select style={inp} value={bId} onChange={(e) => setBId(e.target.value)}>
          {active.map((p: any) => (<option key={p.id} value={p.id}>{p.name}</option>))}
        </select>
        <button style={btnP} disabled={busy} onClick={() => void calc()}>Рассчитать комплекс</button>
      </div>

      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#B0C4DE', marginBottom: 8 }}>Связи между A и B</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
          <select style={inp} value={src} onChange={(e) => setSrc(e.target.value)}>
            <option value="">A: операция-источник…</option>
            {opsA.map((o: any) => (<option key={o.id} value={o.id}>{o.name}</option>))}
          </select>
          <span style={{ color: '#5A7090' }}>→</span>
          <select style={inp} value={tgt} onChange={(e) => setTgt(e.target.value)}>
            <option value="">B: операция-приёмник…</option>
            {opsB.map((o: any) => (<option key={o.id} value={o.id}>{o.name}</option>))}
          </select>
          <select style={inp} value={dtype} onChange={(e) => setDtype(e.target.value)}>
            <option value="FS">FS</option><option value="SS">SS</option><option value="FF">FF</option>
          </select>
          <input style={{ ...inp, width: 64 }} value={lag} onChange={(e) => setLag(e.target.value)} title="Лаг, часы" />
          <button style={btnP} disabled={busy} onClick={() => void create()}>＋ Связь</button>
        </div>
        {links.length === 0 && <div style={{ fontSize: 12, color: '#5A7090' }}>Связей между этими проектами нет.</div>}
        {links.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Источник</th><th style={th}>Тип</th><th style={th}>Приёмник</th><th style={th}>Лаг, ч</th><th style={th}></th></tr></thead>
            <tbody>
              {links.map((d: any) => (
                <tr key={d.id}>
                  <td style={td}>{pname(d.source_project_id)} · {opsName.get(d.source_operation_id) || '—'}</td>
                  <td style={td}>{d.dependency_type}</td>
                  <td style={td}>{pname(d.target_project_id)} · {opsName.get(d.target_operation_id) || '—'}</td>
                  <td style={td}>{d.lag_hours}</td>
                  <td style={td}><button style={btn} onClick={() => void del(d.id)}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {res && (
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#B0C4DE', marginBottom: 6 }}>
            Результат расчёта: {res.total_duration} ч · операций {res.node_count} · критических {res.critical_count}
          </div>
          <div style={{ fontSize: 11.5, color: '#5A7090', marginBottom: 8 }}>Время указано в часах плана от общего нуля комплекса. Проектные планы не изменяются.</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Проект</th><th style={th}>Операция</th><th style={th}>ES</th><th style={th}>EF</th><th style={th}>Резерв</th><th style={th}>Крит.</th></tr></thead>
            <tbody>
              {(res.nodes || []).slice().sort((a: any, b: any) => a.early_start - b.early_start).map((n: any) => (
                <tr key={n.id} style={{ background: n.is_critical ? 'rgba(248,113,113,.06)' : 'transparent' }}>
                  <td style={td}>{pname(n.project_id)}</td>
                  <td style={td}>{n.name}</td>
                  <td style={td}>{n.early_start}</td>
                  <td style={td}>{n.early_finish}</td>
                  <td style={td}>{n.total_float}</td>
                  <td style={{ ...td, color: n.is_critical ? '#F87171' : '#5A7090', fontWeight: 600 }}>{n.is_critical ? '●' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
