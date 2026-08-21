'use client';

import { useState, useEffect, type CSSProperties } from 'react';

const API = 'https://profyplan.ru/api/v1';

type Resource = {
  id: string;
  project_id: string;
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

type Project = { id: string; name: string; country_code?: string };

const RES_TYPES: { v: string; l: string }[] = [
  { v: 'equipment', l: 'Оборудование' },
  { v: 'employee', l: 'Сотрудник' },
  { v: 'team', l: 'Бригада' },
  { v: 'line', l: 'Линия' },
  { v: 'area', l: 'Участок' },
];
const CAP_UNITS = ['hour', 'day', 'shift'];
const COUNTRIES = ['RU', 'BY', 'KZ'];

const typeLabel = (v: string) => RES_TYPES.find(t => t.v === v)?.l || v;
const capUnitLabel = (v: string) => (v === 'hour' ? 'час' : v === 'day' ? 'день' : v === 'shift' ? 'смена' : v);

export default function ResourceManager({ projects }: { projects: Project[] }) {
  const [projectId, setProjectId] = useState<string>('');
  const [rows, setRows] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [schedules, setSchedules] = useState<any[]>([]);

  useEffect(() => {
    if (!projectId && projects.length) setProjectId(projects[0].id);
  }, [projects, projectId]);

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

  const load = async (pid: string) => {
    if (!pid) { setRows([]); return; }
    setLoading(true); setError(null);
    try { setRows(await af(`/projects/${pid}/resources`)); }
    catch (e: any) { setError(String(e)); }
    setLoading(false);
  };
  useEffect(() => { load(projectId); }, [projectId]);
  useEffect(() => { af('/work-schedules/').then(setSchedules).catch(() => {}); }, []);

  const project = projects.find(p => p.id === projectId);
  const resolvedCountry = (r?: Partial<Resource>) => {
    const cc = (r?.country_code || '').trim();
    if (cc) return cc.toUpperCase();
    return (project?.country_code || '').toUpperCase() || '—';
  };

  const openNew = () => {
    setEditingId(null);
    setForm({ resource_type: 'equipment', capacity_per_unit: '1', capacity_unit: 'hour', unit: '', country_code: '', schedule_id: '' });
    setFormOpen(true);
  };
  const openEdit = (r: Resource) => {
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
      if (editingId) await af(`/projects/${projectId}/resources/${editingId}`, { method: 'PUT', body: JSON.stringify(body) });
      else await af(`/projects/${projectId}/resources`, { method: 'POST', body: JSON.stringify(body) });
      setFormOpen(false); setForm({}); setEditingId(null);
      await load(projectId);
    } catch (e: any) { setError(String(e)); }
    setSaving(false);
  };

  const del = async (r: Resource) => {
    if (!confirm(`Удалить ресурс «${r.name}»?`)) return;
    try { await af(`/projects/${projectId}/resources/${r.id}`, { method: 'DELETE' }); await load(projectId); }
    catch (e: any) { setError(String(e)); }
  };

  const input = (style?: CSSProperties): CSSProperties => ({ background: '#0A1628', border: '1px solid #1E3A5F', borderRadius: 6, color: '#E2E8F0', padding: '6px 9px', fontSize: 13, ...style });
  const btn = (c: string): CSSProperties => ({ background: c, border: 'none', color: '#fff', borderRadius: 6, padding: '7px 13px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' });
  const ghost = (): CSSProperties => ({ background: 'transparent', border: '1px solid #1E3A5F', color: '#8FA3BD', borderRadius: 6, padding: '7px 13px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' });

  return (
    <div className="panel" style={{ background: 'linear-gradient(135deg, #0F1E36, #162844)', borderRadius: 12, border: '1px solid #1E3252', padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 16, fontWeight: 600, color: '#E8EEF5' }}>🔧 Ресурсы</span>
        <select value={projectId} onChange={e => setProjectId(e.target.value)} style={{ ...input(), minWidth: 220 }}>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <button onClick={openNew} style={btn('#3B82F6')}>＋ Добавить ресурс</button>
      </div>

      {error && <div style={{ color: '#FCA5A5', fontSize: 12.5, marginBottom: 12 }}>{error}</div>}

      {formOpen && (
        <div style={{ background: '#0D1F3A', border: '1px solid #1E3252', borderRadius: 8, padding: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#E8EEF5', marginBottom: 10 }}>{editingId ? 'Редактирование ресурса' : 'Новый ресурс'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: 'span 2' }}>
              <span style={{ fontSize: 10.5, color: '#5A7090', textTransform: 'uppercase' }}>Название</span>
              <input value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} style={input()} placeholder="Станок / Бригада" />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 10.5, color: '#5A7090', textTransform: 'uppercase' }}>Тип</span>
              <select value={form.resource_type || 'equipment'} onChange={e => setForm({ ...form, resource_type: e.target.value })} style={input()}>
                {RES_TYPES.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 10.5, color: '#5A7090', textTransform: 'uppercase' }}>Мощность</span>
              <input type="number" step="0.1" min="0" value={form.capacity_per_unit || ''} onChange={e => setForm({ ...form, capacity_per_unit: e.target.value })} style={input()} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 10.5, color: '#5A7090', textTransform: 'uppercase' }}>Ед. мощности</span>
              <select value={form.capacity_unit || 'hour'} onChange={e => setForm({ ...form, capacity_unit: e.target.value })} style={input()}>
                {CAP_UNITS.map(u => <option key={u} value={u}>{capUnitLabel(u)}</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 10.5, color: '#5A7090', textTransform: 'uppercase' }}>Ед. продукции</span>
              <input value={form.unit || ''} onChange={e => setForm({ ...form, unit: e.target.value })} style={input()} placeholder="шт / кг" />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 10.5, color: '#5A7090', textTransform: 'uppercase' }}>Страна (календарь)</span>
              <select value={form.country_code || ''} onChange={e => setForm({ ...form, country_code: e.target.value })} style={input()}>
                <option value="">Наследовать ({project?.country_code || '—'})</option>
                {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 10.5, color: '#5A7090', textTransform: 'uppercase' }}>График работы</span>
              <select value={form.schedule_id || ''} onChange={e => setForm({ ...form, schedule_id: e.target.value })} style={input()}>
                <option value="">— не задан —</option>
                {schedules.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={save} disabled={saving} style={btn('#3B82F6')}>{saving ? 'Сохранение…' : '✓ Сохранить'}</button>
            <button onClick={() => { setFormOpen(false); setEditingId(null); setForm({}); }} style={ghost()}>Отмена</button>
          </div>
        </div>
      )}

      {loading ? <div style={{ color: '#5A7090', fontSize: 13 }}>Загрузка…</div> : (
        rows.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#5A7090' }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>🔧</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6, color: '#8FA3BD' }}>Ресурсов нет</div>
            <div style={{ fontSize: 12.5 }}>Добавьте станки, бригады и сотрудников для проекта «{project?.name}».</div>
          </div>
        ) : (
          <table className="tbl" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {['Название', 'Тип', 'Мощность', 'Ед. мощности', 'Ед. продукции', 'Страна', 'График', ''].map((h, i) => (
                  <th key={i} style={{ textAlign: 'left', padding: '6px 10px', color: '#60A5FA', fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', borderBottom: '1px solid #1E3252' }}>{h}</th>
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
                      <span style={{ fontSize: 11, color: '#5A7090' }} title="Наследует страну проекта">{project?.country_code || '—'}</span>
                    )}
                  </td>
                  <td style={{ padding: '8px 10px', color: '#B0C4DE', fontSize: 12 }}>
                    {r.schedule_id ? (schedules.find((s: any) => s.id === r.schedule_id)?.name || '—') : <span style={{ color: '#5A7090' }}>—</span>}
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
  );
}
