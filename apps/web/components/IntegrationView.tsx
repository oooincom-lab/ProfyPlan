'use client';
// Страница «Интеграция»: подключения, обмен (экспорт фиксации, скан каталога, очередь), журнал.
// Каркас 1С (срезы 1–2), 14.10.2026.
import { useEffect, useState } from 'react';

type Api = (path: string, opts?: any) => Promise<any>;

const card: any = { background: 'var(--bg-2, #0D1F3A)', border: '1px solid var(--border, #1E3252)', borderRadius: 10, padding: '14px 16px', marginBottom: 12 };
const th: any = { textAlign: 'left', color: '#5A7090', fontWeight: 600, padding: '4px 8px', borderBottom: '1px solid #16294A', fontSize: 11.5 };
const td: any = { padding: '5px 8px', borderBottom: '1px solid #16294A', fontSize: 12, color: '#E8EEF5' };
const btn = (kind?: string): any => ({
  background: kind === 'primary' ? 'rgba(34,211,238,.08)' : 'transparent',
  border: kind === 'primary' ? '1px solid rgba(34,211,238,.45)' : '1px solid #2A4060',
  color: kind === 'primary' ? '#22D3EE' : '#8FA3BD',
  borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
});
const inp: any = { background: '#0A1628', border: '1px solid #1E3252', borderRadius: 6, color: '#E8EEF5', padding: '6px 10px', fontSize: 12.5, fontFamily: 'inherit' };

const PROFILE_LABEL: any = { '1c_unf': '1С:УНФ', '1c_ka': '1С:КА', '1c_erp': '1С:ERP', 'custom': 'Другая' };
const TRANSPORT_LABEL: any = { file: 'файловый', http: 'прямое', odata: 'OData' };
const DIR_ICON: any = { out: '📤', 'in': '📥' };
const STATUS_COLOR: any = { ok: '#4ADE80', partial: '#FBBF24', error: '#F87171', applied: '#4ADE80', skipped: '#8FA3BD', pending: '#93C5FD' };

export default function IntegrationView({ api, notify }: { api: Api; notify: (m: string) => void }) {
  const [conns, setConns] = useState<any[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [log, setLog] = useState<any[]>([]);
  const [inbox, setInbox] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [pid, setPid] = useState<string>('');
  const [snaps, setSnaps] = useState<any[]>([]);
  const [sid, setSid] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<any>({ name: '', profile: '1c_unf', transport: 'file', comment: '' });

  const sel = conns.find((x) => x.id === selId) || null;

  const loadConns = async () => {
    try { const r = await api('/integration/connections'); setConns(r.items || []); }
    catch (e: any) { notify('Не удалось загрузить подключения: ' + (e?.message || e)); }
  };
  const loadLog = async (cid?: string | null) => {
    try { const r = await api('/integration/log?limit=40' + (cid ? '&connection_id=' + cid : '')); setLog(r.items || []); } catch { /* тихо */ }
  };
  const loadInbox = async (cid?: string | null) => {
    try { const r = await api('/integration/inbox?limit=200' + (cid ? '&connection_id=' + cid : '')); setInbox(r.items || []); } catch { /* тихо */ }
  };
  const loadProjects = async () => {
    try { const r = await api('/projects'); setProjects(r.items || []); } catch { /* тихо */ }
  };

  useEffect(() => { void loadConns(); void loadProjects(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { void loadLog(selId); void loadInbox(selId); /* eslint-disable-next-line */ }, [selId]);

  const loadSnaps = async (projectId: string) => {
    setPid(projectId); setSnaps([]); setSid('');
    if (!projectId) return;
    try { const r = await api('/projects/' + projectId + '/plan-snapshots'); setSnaps(r.items || []); } catch { /* тихо */ }
  };

  const createConn = async () => {
    if (!form.name.trim()) { notify('Укажите имя подключения'); return; }
    try {
      await api('/integration/connections', { method: 'POST', body: JSON.stringify({ ...form }) });
      notify('Подключение создано');
      setForm({ name: '', profile: '1c_unf', transport: 'file', comment: '' });
      void loadConns();
    } catch (e: any) { notify('Ошибка: ' + (e?.message || e)); }
  };
  const deleteConn = async (c: any) => {
    try {
      await api('/integration/connections/' + c.id, { method: 'DELETE' });
      notify('Подключение удалено');
      if (selId === c.id) setSelId(null);
      void loadConns();
    } catch (e: any) { notify('Ошибка: ' + (e?.message || e)); }
  };

  const doExport = async () => {
    if (!sel || !sid) { notify('Выберите подключение и фиксацию плана'); return; }
    setBusy(true);
    try {
      const r = await api('/integration/connections/' + sel.id + '/export/plan-snapshot', { method: 'POST', body: JSON.stringify({ snapshot_id: sid }) });
      notify('Пакет сформирован: ' + r.file + ' (строк: ' + r.entities + ')');
      void loadLog(selId); void loadInbox(selId);
    } catch (e: any) { notify('Ошибка экспорта: ' + (e?.message || e)); }
    setBusy(false);
  };
  const doScan = async () => {
    if (!sel) { notify('Выберите подключение'); return; }
    setBusy(true);
    try {
      const r = await api('/integration/connections/' + sel.id + '/scan', { method: 'POST' });
      notify('Каталог обработан: файлов — ' + (r.processed ?? 0));
      void loadLog(selId); void loadInbox(selId);
    } catch (e: any) { notify('Ошибка скана: ' + (e?.message || e)); }
    setBusy(false);
  };
  const doApply = async () => {
    if (!sel) { notify('Выберите подключение'); return; }
    setBusy(true);
    try {
      const r = await api('/integration/inbox/apply', { method: 'POST', body: JSON.stringify({ connection_id: sel.id }) });
      notify('Очередь обработана: применено ' + r.applied + ', пропущено ' + r.skipped + ', ошибок ' + r.errors);
      void loadInbox(selId); void loadLog(selId);
    } catch (e: any) { notify('Ошибка: ' + (e?.message || e)); }
    setBusy(false);
  };

  const cnt = (s: string) => inbox.filter((x) => x.status === s).length;

  return (
    <div style={{ padding: '16px 18px', overflow: 'auto', flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: '#E8EEF5' }}>🔌 Интеграция с внешними системами</span>
        <span style={{ fontSize: 12, color: '#5A7090' }}>1С:УНФ · 1С:КА · 1С:ERP — файловый обмен, прямое подключение, OData</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 12 }}>
        <div>
          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#B0C4DE', marginBottom: 8 }}>Подключения</div>
            {conns.length === 0 && <div style={{ fontSize: 12, color: '#5A7090' }}>Пока нет подключений — создайте первое ниже.</div>}
            {conns.map((c) => (
              <div key={c.id} onClick={() => setSelId(c.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', borderRadius: 8, cursor: 'pointer', border: selId === c.id ? '1px solid rgba(34,211,238,.5)' : '1px solid #1E3252', background: selId === c.id ? 'rgba(34,211,238,.06)' : '#0A1628', marginBottom: 6 }}>
                <span style={{ color: '#E8EEF5', fontSize: 12.5 }}>{c.name}</span>
                <span style={{ fontSize: 11, color: '#5A7090' }}>{PROFILE_LABEL[c.profile] || c.profile} · {TRANSPORT_LABEL[c.transport] || c.transport}</span>
                {!c.is_active && <span style={{ fontSize: 10.5, color: '#FBBF24' }}>выкл</span>}
                <span style={{ marginLeft: 'auto' }}>
                  <button style={{ ...btn(), padding: '2px 7px' }} onClick={(e) => { e.stopPropagation(); void deleteConn(c); }} title="Удалить подключение">✕</button>
                </span>
              </div>
            ))}
            <div style={{ borderTop: '1px dashed #1E3252', marginTop: 8, paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 12, color: '#8FA3BD' }}>Новое подключение:</div>
              <input style={inp} placeholder="Название (например: УНФ ТОПЕКС)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <div style={{ display: 'flex', gap: 6 }}>
                <select style={{ ...inp, flex: 1 }} value={form.profile} onChange={(e) => setForm({ ...form, profile: e.target.value })}>
                  <option value="1c_unf">1С:УНФ</option>
                  <option value="1c_ka">1С:КА</option>
                  <option value="1c_erp">1С:ERP</option>
                  <option value="custom">Другая система</option>
                </select>
                <select style={{ ...inp, flex: 1 }} value={form.transport} onChange={(e) => setForm({ ...form, transport: e.target.value })}>
                  <option value="file">Файловый обмен</option>
                  <option value="http">Прямое подключение</option>
                  <option value="odata">OData</option>
                </select>
              </div>
              <button style={btn('primary')} onClick={() => void createConn()}>➕ Создать подключение</button>
            </div>
          </div>

          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#B0C4DE', marginBottom: 8 }}>Очередь принятого</div>
            <div style={{ display: 'flex', gap: 10, fontSize: 12 }}>
              <span style={{ color: '#93C5FD' }}>в ожидании: {cnt('pending')}</span>
              <span style={{ color: '#4ADE80' }}>применено: {cnt('applied')}</span>
              <span style={{ color: '#8FA3BD' }}>пропущено: {cnt('skipped')}</span>
              <span style={{ color: '#F87171' }}>ошибки: {cnt('error')}</span>
            </div>
          </div>
        </div>

        <div>
          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#B0C4DE', marginBottom: 8 }}>Действия {sel ? '· ' + sel.name : '(выберите подключение)'}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select style={{ ...inp, minWidth: 180 }} value={pid} onChange={(e) => void loadSnaps(e.target.value)}>
                <option value="">Проект…</option>
                {projects.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
              </select>
              <select style={{ ...inp, minWidth: 220 }} value={sid} onChange={(e) => setSid(e.target.value)} disabled={!snaps.length}>
                <option value="">{snaps.length ? 'Фиксация плана…' : 'фиксаций нет'}</option>
                {snaps.map((s) => (<option key={s.id} value={s.id}>{s.name} · {s.rows_count} стр.</option>))}
              </select>
              <button style={btn('primary')} disabled={busy || !sel || !sid} onClick={() => void doExport()}>📤 Экспорт фиксации</button>
              <button style={btn()} disabled={busy || !sel} onClick={() => void doScan()}>🔄 Скан каталога</button>
              <button style={btn()} disabled={busy || !sel} onClick={() => void doApply()}>✅ Применить очередь</button>
            </div>
            <div style={{ fontSize: 11, color: '#5A7090', marginTop: 8 }}>
              Экспорт формирует пакет плана в исходящий каталог подключения; скан обрабатывает входящие пакеты из каталога; «Применить очередь» переносит принятые данные в справочники.
            </div>
          </div>

          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#B0C4DE' }}>Журнал обмена</span>
              <button style={{ ...btn(), marginLeft: 'auto' }} onClick={() => { void loadLog(selId); void loadInbox(selId); }}>🔄 Обновить</button>
            </div>
            <div style={{ maxHeight: 340, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}></th><th style={th}>Вид</th><th style={th}>Статус</th><th style={th}>Элементов</th><th style={th}>Файл</th><th style={th}>Сообщение</th><th style={th}>Когда</th></tr></thead>
                <tbody>
                  {log.map((x) => (
                    <tr key={x.id}>
                      <td style={td}>{DIR_ICON[x.direction] || '•'}</td>
                      <td style={td}>{x.kind}</td>
                      <td style={{ ...td, color: STATUS_COLOR[x.status] || '#E8EEF5', fontWeight: 600 }}>{x.status}</td>
                      <td style={td}>{x.entities_count}</td>
                      <td style={{ ...td, color: '#93C5FD', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.file_name || '—'}</td>
                      <td style={{ ...td, color: '#8FA3BD', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.message || ''}</td>
                      <td style={{ ...td, color: '#5A7090', whiteSpace: 'nowrap' }}>{String(x.created_at || '').slice(0, 16).replace('T', ' ')}</td>
                    </tr>
                  ))}
                  {log.length === 0 && <tr><td style={{ ...td, color: '#5A7090' }} colSpan={7}>Обменов пока не было</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
