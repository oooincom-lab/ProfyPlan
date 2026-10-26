'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

type Api = (path: string, opts?: any) => Promise<any>;

const card: any = { background: '#0D1F3A', border: '1px solid #1E3252', borderRadius: 10, padding: '10px 12px' };
const inp: any = { background: '#0A1628', border: '1px solid #1E3252', borderRadius: 6, color: '#E8EEF5', padding: '6px 9px', fontSize: 12.5, fontFamily: 'inherit' };
const btn: any = { background: 'transparent', border: '1px solid #2A4060', color: '#8FA3BD', borderRadius: 7, padding: '6px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' };
const btnP: any = { ...btn, background: '#2563EB', border: 'none', color: '#fff', fontWeight: 600 };
const statusColor: any = { ok: '#4ADE80', missing: '#F87171', warning: '#FBBF24', multiple: '#F87171' };
const statusLabel: any = { ok: 'Покрыта', missing: 'Нет ресурса', warning: 'Нет primary', multiple: 'Несколько primary' };

export default function OperationResourcesModal({
  api,
  projectId,
  projectName,
  onClose,
  notify,
}: {
  api: Api;
  projectId: string;
  projectName?: string;
  onClose: () => void;
  notify: (m: string) => void;
}) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [onlyProblems, setOnlyProblems] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [resourceId, setResourceId] = useState('');
  const [role, setRole] = useState('primary');
  const [ktu, setKtu] = useState('1.0');

  const load = async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await api(`/projects/${projectId}/resource-coverage`);
      setData(r);
      setResourceId((prev: string) => prev || (r?.resources?.[0]?.id || ''));
    } catch (e: any) {
      setErr('Не удалось загрузить покрытие: ' + String(e?.message || e));
    }
    setLoading(false);
  };

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [projectId]);

  const items = useMemo(() => {
    const list = (data?.items || []).filter((x: any) => {
      if (onlyProblems && x.status === 'ok') return false;
      if (!q.trim()) return true;
      const s = `${x.name || ''} ${x.order_name || ''} ${x.department_name || ''}`.toLowerCase();
      return s.includes(q.trim().toLowerCase());
    });
    return list;
  }, [data, onlyProblems, q]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(items.map((x: any) => x.id)));
  const clear = () => setSelected(new Set());

  const assignSelected = async () => {
    if (!resourceId) { setErr('Выберите ресурс'); return; }
    const k = Number(ktu.replace(',', '.'));
    if (!Number.isFinite(k) || k < 0.1 || k > 3) { setErr('КТУ должен быть числом от 0.1 до 3.0'); return; }
    if (!selected.size) { setErr('Выберите операции'); return; }
    if (role === 'primary') {
      const blocked = items.filter((x: any) => selected.has(x.id) && x.primary_count > 0);
      if (blocked.length) {
        setErr(`Нельзя назначить второй primary: ${blocked.slice(0, 3).map((x: any) => x.name).join(', ')}${blocked.length > 3 ? '…' : ''}`);
        return;
      }
    }
    setBusy(true); setErr('');
    const errors: string[] = [];
    for (const id of Array.from(selected)) {
      try {
        await api(`/projects/${projectId}/operations/${id}/resources`, {
          method: 'POST',
          body: JSON.stringify({ resource_id: resourceId, role, capacity_demand: 1, ktu: k }),
        });
      } catch (e: any) {
        errors.push(String(e?.message || e));
      }
    }
    setBusy(false);
    if (errors.length) {
      setErr(`Назначено не всё: ${errors.length} ошибок. Первая: ${errors[0]}`);
    } else {
      notify(`Ресурс назначен: ${selected.size} операций`);
      setSelected(new Set());
    }
    await load();
  };

  const removeAssignment = async (operationId: string, assignmentId: string) => {
    if (!confirm('Снять ресурс с операции?')) return;
    setBusy(true);
    try {
      await api(`/projects/${projectId}/operations/${operationId}/resources/${assignmentId}`, { method: 'DELETE' });
      await load();
    } catch (e: any) {
      setErr(String(e?.message || e));
    }
    setBusy(false);
  };

  const close = () => { if (!busy) onClose(); };

  return createPortal(
    <div role="presentation" onClick={close}
      style={{ position: 'fixed', inset: 0, zIndex: 100000, background: 'rgba(3,10,20,.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }}>
      <div role="dialog" aria-modal="true" aria-label="Ресурсы операций"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(1100px, 96vw)', maxHeight: '90vh', overflow: 'auto', background: '#0A1628', border: '1px solid #1E3A5F', borderRadius: 12, boxShadow: '0 24px 80px rgba(0,0,0,.55)', padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Ресурсы операций</div>
            <div style={{ fontSize: 12, color: '#8FA3BD', marginTop: 2 }}>{projectName || data?.project_name || 'Проект'} · покрытие и назначение</div>
          </div>
          <button style={btn} onClick={close}>Закрыть</button>
        </div>

        {loading && <div style={{ color: '#8FA3BD', fontSize: 13, padding: 18 }}>Загрузка…</div>}
        {err && <div style={{ ...card, borderColor: 'rgba(248,113,113,.5)', color: '#F87171', fontSize: 12.5 }}>{err}</div>}

        {data && (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              {[
                ['Всего', data.summary.total, '#B0C4DE'],
                ['Покрыты', data.summary.ok, '#4ADE80'],
                ['Нет ресурса', data.summary.missing, '#F87171'],
                ['Нет primary', data.summary.warning, '#FBBF24'],
                ['Несколько primary', data.summary.multiple, '#F87171'],
              ].map(([label, value, color]: any) => (
                <div key={label} style={{ ...card, padding: '7px 10px', minWidth: 105 }}>
                  <div style={{ fontSize: 10.5, color: '#5A7090' }}>{label}</div>
                  <div style={{ fontSize: 17, fontWeight: 700, color }}>{value}</div>
                </div>
              ))}
            </div>

            <div style={{ ...card, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
              <input style={{ ...inp, minWidth: 220 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по операции, заказу, подразделению" />
              <label style={{ fontSize: 12, color: '#8FA3BD', display: 'flex', gap: 5, alignItems: 'center' }}>
                <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> только проблемные
              </label>
              <button style={btn} onClick={selectAll}>Выбрать видимые</button>
              <button style={btn} onClick={clear}>Снять выбор</button>
              <span style={{ marginLeft: 'auto', fontSize: 12, color: '#8FA3BD' }}>Выбрано: {selected.size}</span>
            </div>

            <div style={{ ...card, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 10, borderColor: 'rgba(37,99,235,.45)' }}>
              <div>
                <div style={{ fontSize: 10.5, color: '#5A7090', marginBottom: 3 }}>Ресурс</div>
                <select style={{ ...inp, minWidth: 220 }} value={resourceId} onChange={(e) => setResourceId(e.target.value)}>
                  <option value="">— выберите —</option>
                  {(data.resources || []).map((r: any) => <option key={r.id} value={r.id}>{r.name} ({r.resource_type})</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize: 10.5, color: '#5A7090', marginBottom: 3 }}>Роль</div>
                <select style={inp} value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="primary">primary</option>
                  <option value="member">member</option>
                  <option value="helper">helper</option>
                  <option value="alternative">alternative</option>
                </select>
              </div>
              <div>
                <div style={{ fontSize: 10.5, color: '#5A7090', marginBottom: 3 }}>КТУ</div>
                <input style={{ ...inp, width: 72 }} value={ktu} onChange={(e) => setKtu(e.target.value)} />
              </div>
              <button style={btnP} disabled={busy || !selected.size || !resourceId} onClick={() => void assignSelected()}>
                {busy ? 'Назначаю…' : `Назначить выбранным (${selected.size})`}
              </button>
            </div>

            {(data.resources || []).length === 0 && (
              <div style={{ ...card, color: '#FBBF24', fontSize: 12.5, marginBottom: 10 }}>
                В проекте нет доступных ресурсов. Сначала создайте ресурс в разделе «Ресурсы» или в оргструктуре.
              </div>
            )}

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ color: '#8FA3BD', textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                    <th style={{ width: 28, padding: '7px 6px' }} />
                    <th style={{ padding: '7px 6px' }}>Операция</th>
                    <th style={{ padding: '7px 6px' }}>Заказ</th>
                    <th style={{ padding: '7px 6px' }}>Подразделение</th>
                    <th style={{ padding: '7px 6px' }}>Часы</th>
                    <th style={{ padding: '7px 6px' }}>Статус</th>
                    <th style={{ padding: '7px 6px' }}>Ресурсы</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((x: any) => (
                    <tr key={x.id} style={{ borderTop: '1px solid #1E3252', verticalAlign: 'top' }}>
                      <td style={{ padding: '8px 6px' }}><input type="checkbox" checked={selected.has(x.id)} onChange={() => toggle(x.id)} /></td>
                      <td style={{ padding: '8px 6px', fontWeight: 600 }}>{x.name}</td>
                      <td style={{ padding: '8px 6px', color: '#B0C4DE' }}>{x.order_name || '—'}</td>
                      <td style={{ padding: '8px 6px', color: '#B0C4DE' }}>{x.department_name || '—'}</td>
                      <td style={{ padding: '8px 6px', color: '#B0C4DE' }}>{Number(x.duration_hours || 0).toFixed(3)}</td>
                      <td style={{ padding: '8px 6px', color: statusColor[x.status] || '#B0C4DE', whiteSpace: 'nowrap' }}>{statusLabel[x.status] || x.status}</td>
                      <td style={{ padding: '8px 6px' }}>
                        {(x.resources || []).length === 0 && <span style={{ color: '#F87171' }}>не назначены</span>}
                        {(x.resources || []).map((r: any) => (
                          <span key={r.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, margin: '1px 4px 1px 0', padding: '2px 6px', borderRadius: 5, background: r.role === 'primary' ? 'rgba(74,222,128,.12)' : 'rgba(59,130,246,.12)', color: r.role === 'primary' ? '#4ADE80' : '#93C5FD', whiteSpace: 'nowrap' }}>
                            {r.role}: {r.resource_name}{r.role !== 'primary' ? ` · КТУ ${r.ktu}` : ''}
                            <button title="Снять" disabled={busy} onClick={() => void removeAssignment(x.id, r.id)} style={{ background: 'transparent', border: 'none', color: '#FCA5A5', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>×</button>
                          </span>
                        ))}
                      </td>
                    </tr>
                  ))}
                  {!items.length && <tr><td colSpan={7} style={{ padding: 18, color: '#8FA3BD' }}>Нет операций по фильтру.</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
