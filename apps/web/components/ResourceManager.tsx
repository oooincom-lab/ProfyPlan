'use client';

import { useState, useEffect, type CSSProperties } from 'react';
import ResourceForm, { typeLabel, capUnitLabel } from './ResourceForm';
import DebugBadge from './DebugBadge';

const API = 'https://profyplan.ru/api/v1';

type Resource = {
  id: string;
  project_id?: string | null;
  name: string;
  parent_id?: string | null;
  resource_type: string;
  capacity_per_unit: number | string;
  capacity_unit: string;
  unit?: string | null;
  country_code?: string | null;
  schedule_id?: string | null;
  is_active: boolean;
};

type Assignment = {
  id: string;
  project_id: string;
  resource_id: string;
  schedule_id?: string | null;
  capacity_share: number | string;
  date_from?: string | null;
  date_to?: string | null;
  resource_name?: string | null;
  schedule_name?: string | null;
};

type Project = { id: string; name: string; country_code?: string };

const shareLabel = (v: number | string) => `${Math.round(parseFloat(String(v ?? 1)) * 100)}%`;
const periodLabel = (a: Assignment) => {
  const f = a.date_from ? a.date_from.slice(0, 10) : '';
  const t = a.date_to ? a.date_to.slice(0, 10) : '';
  if (!f && !t) return 'весь проект';
  return `${f || '…'} – ${t || '…'}`;
};

export default function ResourceManager({ projects, windowMode = false, debug = false, onOpenResEdit }: { projects: Project[]; windowMode?: boolean; debug?: boolean; onOpenResEdit?: (res: any | null) => void }) {
  // Глобальный справочник
  const [rows, setRows] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [schedules, setSchedules] = useState<any[]>([]);

  // Назначение на проекты
  const [assignProjectId, setAssignProjectId] = useState<string>('');
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignFormOpen, setAssignFormOpen] = useState(false);
  const [assignForm, setAssignForm] = useState<Record<string, string>>({});
  const [assignSaving, setAssignSaving] = useState(false);

  useEffect(() => { if (!assignProjectId && projects.length) setAssignProjectId(projects[0].id); }, [projects, assignProjectId]);

  const af = async (path: string, opts?: RequestInit) => {
    const tok = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
    const h: Record<string, string> = { 'Content-Type': 'application/json', ...(opts?.headers as any || {}) };
    if (tok) h['Authorization'] = `Bearer ${tok}`;
    const r = await fetch(`${API}${path}`, { ...opts, headers: h });
    if (r.status === 401) { localStorage.removeItem('profyplan_token'); throw new Error('AUTH_REQUIRED'); }
    if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
    if (r.status === 204) return undefined as any;
    return r.json();
  };

  const load = async () => {
    setLoading(true); setError(null);
    try { setRows(await af('/resources')); }
    catch (e: any) { setError(String(e)); }
    setLoading(false);
  };
  const loadAssignments = async (pid: string) => {
    if (!pid) { setAssignments([]); return; }
    setAssignLoading(true);
    try { setAssignments(await af(`/projects/${pid}/project-resources`)); }
    catch (e: any) { setError(String(e)); }
    setAssignLoading(false);
  };
  useEffect(() => { load(); }, []);
  useEffect(() => { loadAssignments(assignProjectId); }, [assignProjectId]);
  useEffect(() => { af('/work-schedules/').then(setSchedules).catch(() => {}); }, []);

  const assignProject = projects.find(p => p.id === assignProjectId);
  const schedName = (id?: string | null) => (id ? (schedules.find((s: any) => s.id === id)?.name || '—') : null);

  const openNew = () => {
    const blank = { resource_type: 'equipment', capacity_per_unit: '1', capacity_unit: 'hour', unit: '', country_code: '', schedule_id: '' };
    if (windowMode && onOpenResEdit) { onOpenResEdit(null); return; }
    setEditingId(null);
    setForm(blank);
    setFormOpen(true);
  };
  const openEdit = (r: Resource) => {
    if (windowMode && onOpenResEdit) { onOpenResEdit(r); return; }
    setEditingId(r.id);
    setForm({
      name: r.name, resource_type: r.resource_type,
      capacity_per_unit: String(r.capacity_per_unit ?? 1), capacity_unit: r.capacity_unit,
      unit: r.unit || '', country_code: r.country_code || '', schedule_id: r.schedule_id || '',
    });
    setFormOpen(true);
  };
  const save = async () => {
    if (!form.name?.trim()) { setError('Укажите название ресурса'); return; }
    setSaving(true); setError(null);
    const body: Record<string, any> = {
      name: form.name.trim(),
      resource_type: form.resource_type || 'equipment',
      capacity_per_unit: parseFloat(String(form.capacity_per_unit).replace(',', '.')) || 1,
      capacity_unit: form.capacity_unit || 'hour',
      unit: form.unit?.trim() || null,
      country_code: (form.country_code || '').trim().toUpperCase() || null,
      schedule_id: (form.schedule_id || '').trim() || null,
      is_active: true,
    };
    try {
      if (editingId) await af(`/resources/${editingId}`, { method: 'PUT', body: JSON.stringify(body) });
      else await af('/resources', { method: 'POST', body: JSON.stringify(body) });
      setFormOpen(false); setForm({}); setEditingId(null);
      await load();
    } catch (e: any) { setError(String(e)); }
    setSaving(false);
  };
  const del = async (r: Resource) => {
    if (!confirm(`Удалить глобальный ресурс «${r.name}»?\nОн будет отвязан от всех проектов.`)) return;
    try { await af(`/resources/${r.id}`, { method: 'DELETE' }); await load(); }
    catch (e: any) { setError(String(e)); }
  };

  const openAssign = () => {
    setAssignForm({ resource_id: '', schedule_id: '', capacity_share: '1', date_from: '', date_to: '' });
    setAssignFormOpen(true);
  };
  const saveAssign = async () => {
    if (!assignForm.resource_id) { setError('Выберите ресурс'); return; }
    setAssignSaving(true); setError(null);
    const body: Record<string, any> = {
      resource_id: assignForm.resource_id,
      schedule_id: (assignForm.schedule_id || '').trim() || null,
      capacity_share: parseFloat(String(assignForm.capacity_share).replace(',', '.')) || 1,
      date_from: (assignForm.date_from || '').trim() || null,
      date_to: (assignForm.date_to || '').trim() || null,
    };
    try {
      await af(`/projects/${assignProjectId}/project-resources`, { method: 'POST', body: JSON.stringify(body) });
      setAssignFormOpen(false); setAssignForm({});
      await loadAssignments(assignProjectId);
    } catch (e: any) { setError(String(e)); }
    setAssignSaving(false);
  };
  const unassign = async (a: Assignment) => {
    if (!confirm(`Отвязать «${a.resource_name}» от проекта «${assignProject?.name}»?`)) return;
    try { await af(`/projects/${assignProjectId}/project-resources/${a.id}`, { method: 'DELETE' }); await loadAssignments(assignProjectId); }
    catch (e: any) { setError(String(e)); }
  };

  const input = (style?: CSSProperties): CSSProperties => ({ background: '#0A1628', border: '1px solid #1E3A5F', borderRadius: 6, color: '#E2E8F0', padding: '6px 9px', fontSize: 13, ...style });
  const btn = (c: string): CSSProperties => ({ background: c, border: 'none', color: '#fff', borderRadius: 6, padding: '7px 13px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' });
  const ghost = (): CSSProperties => ({ background: 'transparent', border: '1px solid #1E3A5F', color: '#8FA3BD', borderRadius: 6, padding: '7px 13px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' });
  const th = (t: string): CSSProperties => ({ textAlign: 'left', padding: '6px 10px', color: '#60A5FA', fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', borderBottom: '1px solid #1E3252', whiteSpace: 'nowrap' });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ===== Глобальный справочник ресурсов ===== */}
      <div className="panel" style={{ background: 'linear-gradient(135deg, #0F1E36, #162844)', borderRadius: 12, border: '1px solid #1E3252', padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: '#E8EEF5' }}>🔧 Глобальный справочник ресурсов</span>
          <span style={{ fontSize: 11.5, color: '#5A7090' }}>общие для всех проектов · привязка к проекту — ниже</span>
          <div style={{ flex: 1 }} />
          <button onClick={openNew} style={btn('#3B82F6')}>＋ Добавить ресурс</button>
        </div>

        {error && <div style={{ color: '#FCA5A5', fontSize: 12.5, marginBottom: 12 }}>{error}</div>}

        {formOpen && (
          <>
            <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.6)', zIndex: 9990, backdropFilter: 'blur(4px)' }} onClick={() => { setFormOpen(false); setEditingId(null); setForm({}); }} />
            <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 640, maxWidth: '92vw', maxHeight: '86vh', overflow: 'auto', zIndex: 9991, background: 'linear-gradient(135deg, #0F1E36, #162844)', border: '1px solid #1E3252', borderRadius: 14, padding: 20, boxShadow: '0 24px 80px rgba(0,0,0,0.6)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: '#E8EEF5', flexShrink: 0 }}>{editingId ? '🔧 Редактирование ресурса' : '🔧 Новый ресурс'}</span>
                <div style={{ flex: 1 }} />
                <DebugBadge debug={debug} text="[resedit:modal]" copy={editingId ? `[resedit:modal] «Редактирование ресурса · ${editingId.slice(0, 8)}»` : '[resedit:modal] «Новый ресурс»'} />
                <button onClick={() => { setFormOpen(false); setEditingId(null); setForm({}); }} style={{ background: 'transparent', border: 'none', color: '#5A7090', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>✕</button>
              </div>
              <ResourceForm form={form} onChange={patch => setForm({ ...form, ...patch })} schedules={schedules} saving={saving} onSave={save} onCancel={() => { setFormOpen(false); setEditingId(null); setForm({}); }} />
            </div>
          </>
        )}
        {loading ? <div style={{ color: '#5A7090', fontSize: 13 }}>Загрузка…</div> : (
          rows.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#5A7090' }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>🔧</div>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6, color: '#8FA3BD' }}>Ресурсов нет</div>
              <div style={{ fontSize: 12.5 }}>Добавьте станки, бригады и сотрудников — они станут доступны всем проектам.</div>
            </div>
          ) : (
            <table className="tbl" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {['Название', 'Тип', 'Мощность', 'Ед. мощности', 'Ед. продукции', 'Страна', 'График (по умолч.)', ''].map((h, i) => (
                    <th key={i} style={th(h)}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} style={{ borderBottom: '1px solid #162844' }}>
                    <td style={{ padding: '8px 10px', color: '#E8EEF5', fontWeight: 600 }}>{r.name}</td>
                    <td style={{ padding: '8px 10px', color: '#B0C4DE' }}>{typeLabel(r.resource_type)}</td>
                    <td style={{ padding: '8px 10px', color: '#FCD34D', fontFamily: "'IBM Plex Mono',monospace" }}>{r.capacity_per_unit}</td>
                    <td style={{ padding: '8px 10px', color: '#B0C4DE' }}>{capUnitLabel(r.capacity_unit)}</td>
                    <td style={{ padding: '8px 10px', color: '#B0C4DE' }}>{r.unit || '—'}</td>
                    <td style={{ padding: '8px 10px' }}>
                      {r.country_code ? (
                        <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 10, background: 'rgba(34,211,238,.14)', color: '#22D3EE', border: '1px solid rgba(34,211,238,.35)' }}>{r.country_code}</span>
                      ) : (
                        <span style={{ fontSize: 11, color: '#5A7090' }} title="Наследует страну проекта">от проекта</span>
                      )}
                    </td>
                    <td style={{ padding: '8px 10px', color: '#B0C4DE', fontSize: 12 }}>
                      {schedName(r.schedule_id) || <span style={{ color: '#5A7090' }}>—</span>}
                    </td>
                    <td style={{ padding: '4px 6px', display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                      <button onClick={() => openEdit(r)} style={{ background: 'none', border: 'none', color: '#5A7090', cursor: 'pointer', fontSize: 13 }} title="Редактировать">✎</button>
                      <button onClick={() => del(r)} style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', opacity: 0.7, fontSize: 13 }} title="Удалить">🗑</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>

      {/* ===== Назначение ресурсов на проекты ===== */}
      <div className="panel" style={{ background: 'linear-gradient(135deg, #0F1E36, #162844)', borderRadius: 12, border: '1px solid #1E3252', padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: '#E8EEF5' }}>🔗 Назначение ресурсов на проект</span>
          <select value={assignProjectId} onChange={e => setAssignProjectId(e.target.value)} style={{ ...input(), minWidth: 220 }}>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div style={{ flex: 1 }} />
          <button onClick={openAssign} style={btn('#10B981')}>＋ Назначить ресурс</button>
        </div>

        {assignFormOpen && (
          <div style={{ background: '#0D1F3A', border: '1px solid #1E3252', borderRadius: 8, padding: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#E8EEF5', marginBottom: 10 }}>Назначить ресурс на «{assignProject?.name}»</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: 'span 2' }}>
                <span style={{ fontSize: 10.5, color: '#5A7090', textTransform: 'uppercase' }}>Ресурс</span>
                <select value={assignForm.resource_id || ''} onChange={e => setAssignForm({ ...assignForm, resource_id: e.target.value })} style={input()}>
                  <option value="">— выберите ресурс —</option>
                  {rows.map(r => <option key={r.id} value={r.id}>{r.name} ({typeLabel(r.resource_type)})</option>)}
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 10.5, color: '#5A7090', textTransform: 'uppercase' }}>График (переопределение)</span>
                <select value={assignForm.schedule_id || ''} onChange={e => setAssignForm({ ...assignForm, schedule_id: e.target.value })} style={input()}>
                  <option value="">Наследовать от ресурса</option>
                  {schedules.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 10.5, color: '#5A7090', textTransform: 'uppercase' }}>Доля мощности (0–1)</span>
                <input type="number" step="0.1" min="0" max="1" value={assignForm.capacity_share || '1'} onChange={e => setAssignForm({ ...assignForm, capacity_share: e.target.value })} style={input()} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 10.5, color: '#5A7090', textTransform: 'uppercase' }}>Период с</span>
                <input type="date" value={assignForm.date_from || ''} onChange={e => setAssignForm({ ...assignForm, date_from: e.target.value })} style={input()} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 10.5, color: '#5A7090', textTransform: 'uppercase' }}>Период по</span>
                <input type="date" value={assignForm.date_to || ''} onChange={e => setAssignForm({ ...assignForm, date_to: e.target.value })} style={input()} />
              </label>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={saveAssign} disabled={assignSaving} style={btn('#10B981')}>{assignSaving ? 'Сохранение…' : '✓ Назначить'}</button>
              <button onClick={() => { setAssignFormOpen(false); setAssignForm({}); }} style={ghost()}>Отмена</button>
            </div>
          </div>
        )}

        {assignLoading ? <div style={{ color: '#5A7090', fontSize: 13 }}>Загрузка…</div> : (
          assignments.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 30, color: '#5A7090', fontSize: 13 }}>
              Ресурсы пока не назначены на проект «{assignProject?.name}».
            </div>
          ) : (
            <table className="tbl" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {['Ресурс', 'График', 'Доля мощности', 'Период', ''].map((h, i) => (
                    <th key={i} style={th(h)}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {assignments.map(a => (
                  <tr key={a.id} style={{ borderBottom: '1px solid #162844' }}>
                    <td style={{ padding: '8px 10px', color: '#E8EEF5', fontWeight: 600 }}>{a.resource_name}</td>
                    <td style={{ padding: '8px 10px', color: '#B0C4DE', fontSize: 12 }}>
                      {a.schedule_name || <span style={{ color: '#5A7090' }}>наследует ресурс</span>}
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 10, background: 'rgba(16,185,129,.14)', color: '#34D399', border: '1px solid rgba(16,185,129,.35)' }}>{shareLabel(a.capacity_share)}</span>
                    </td>
                    <td style={{ padding: '8px 10px', color: '#B0C4DE', fontSize: 12 }}>{periodLabel(a)}</td>
                    <td style={{ padding: '4px 6px', display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                      <button onClick={() => unassign(a)} style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', opacity: 0.7, fontSize: 13 }} title="Отвязать">🗑</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>
    </div>
  );
}
