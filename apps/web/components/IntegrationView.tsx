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

export default function IntegrationView({ api, notify, openXlog, openXconn }: { api: Api; notify: (m: string) => void; openXlog?: (e: any, items?: any[]) => void; openXconn?: (c: any, save?: (id: string | null, body: any) => Promise<any>) => void }) {
  const [conns, setConns] = useState<any[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [log, setLog] = useState<any[]>([]);
  const [inbox, setInbox] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [pid, setPid] = useState<string>('');
  const [snaps, setSnaps] = useState<any[]>([]);
  const [sid, setSid] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [resp, setResp] = useState<string>('');
  const [selLogId, setSelLogId] = useState<string | null>(null);
  const [connClicked, setConnClicked] = useState<string | null>(null);
  const say = (m: string) => { setResp(m); notify(m); };

  const sel = conns.find((x) => x.id === selId) || null;

  const loadConns = async () => {
    try {
      const r = await api('/integration/connections');
      const items = r.items || [];
      setConns(items);
      setSelId((cur: string | null) => cur || (items[0]?.id ?? null));
    }
    catch (e: any) { say('Не удалось загрузить подключения: ' + (e?.message || e)); }
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
  /* eslint-disable-next-line */
  useEffect(() => {
    const h = () => { void loadConns(); };
    window.addEventListener('profyplan:integration-changed', h);
    return () => window.removeEventListener('profyplan:integration-changed', h);
  }, []);

  const loadSnaps = async (projectId: string) => {
    setPid(projectId); setSnaps([]); setSid('');
    if (!projectId) return;
    try { const r = await api('/projects/' + projectId + '/plan-snapshots'); setSnaps(r.items || []); } catch { /* тихо */ }
  };

  const saveConn = (id: string | null, body: any) =>
    api('/integration/connections' + (id ? '/' + id : ''), { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) });
  const openConn = (c: any) => { if (openXconn) openXconn(c, saveConn); };
  const openNewConn = () => {
    if (!openXconn) return;
    openXconn(null, async (id: string | null, body: any) => {
      const r = await saveConn(id, body);
      if (!id) {
        say('Подключение создано: ' + ((r && r.name) || body.name || ''));
        if (r && r.id) setSelId(r.id);
      } else {
        say('Подключение сохранено: ' + ((r && r.name) || body.name || ''));
      }
      void loadConns();
      return r;
    });
  };
  const deleteConn = async (c: any) => {
    try {
      await api('/integration/connections/' + c.id, { method: 'DELETE' });
      say('Подключение удалено');
      if (selId === c.id) setSelId(null);
      void loadConns();
    } catch (e: any) { say('Ошибка: ' + (e?.message || e)); }
  };

  const doExport = async () => {
    if (!sel || !sid) { say('Выберите подключение и фиксацию плана'); return; }
    setBusy(true);
    try {
      const r = await api('/integration/connections/' + sel.id + '/export/plan-snapshot', { method: 'POST', body: JSON.stringify({ snapshot_id: sid }) });
      say('Пакет сформирован: ' + r.file + ' (строк: ' + r.entities + ')');
      void loadLog(selId); void loadInbox(selId);
    } catch (e: any) { say('Ошибка экспорта: ' + (e?.message || e)); }
    setBusy(false);
  };
  const doScan = async () => {
    if (!sel) { say('Выберите подключение'); return; }
    setBusy(true);
    try {
      const r = await api('/integration/connections/' + sel.id + '/scan', { method: 'POST' });
      say('Каталог обработан: файлов — ' + (r.processed ?? 0));
      void loadLog(selId); void loadInbox(selId);
    } catch (e: any) { say('Ошибка скана: ' + (e?.message || e)); }
    setBusy(false);
  };
  const doApply = async () => {
    if (!sel) { say('Выберите подключение'); return; }
    setBusy(true);
    try {
      const r = await api('/integration/inbox/apply', { method: 'POST', body: JSON.stringify({ connection_id: sel.id }) });
      say('Очередь обработана: применено ' + r.applied + ', пропущено ' + r.skipped + ', ошибок ' + r.errors);
      void loadInbox(selId); void loadLog(selId);
    } catch (e: any) { say('Ошибка: ' + (e?.message || e)); }
    setBusy(false);
  };

  const openLogDetails = async (x: any) => {
    try {
      const r = await api('/integration/inbox?limit=500');
      const items = ((r && r.items) || []).filter((it: any) => it.log_id === x.id);
      if (openXlog) openXlog(x, items);
    } catch {
      if (openXlog) openXlog(x, []);
    }
  };

  const cnt = (s: string) => inbox.filter((x) => x.status === s).length;

  const doOdataTest = async () => {
    if (!sel) { say('Выберите подключение'); return; }
    setBusy(true);
    try {
      const r = await api('/integration/connections/' + sel.id + '/odata/test', { method: 'POST', body: JSON.stringify({}) });
      say('OData: соединение в порядке' + (r.probe ? ' (' + r.probe.entity + ': ' + r.probe.rows + ')' : ''));
      void loadLog(selId);
    } catch (e: any) { say('OData: ' + (e?.message || e)); void loadLog(selId); }
    setBusy(false);
  };
  const doOdataPull = async () => {
    if (!sel) { say('Выберите подключение'); return; }
    setBusy(true);
    try {
      const r = await api('/integration/connections/' + sel.id + '/odata/pull', { method: 'POST', body: JSON.stringify({}) });
      say('OData: притянуто элементов — ' + (r.pulled ?? 0) + (r.skipped && r.skipped.length ? ' (сущностей пропущено: ' + r.skipped.length + ')' : '') + '. Нажмите «Применить очередь».');
      void loadInbox(selId); void loadLog(selId);
    } catch (e: any) { say('OData: ' + (e?.message || e)); void loadLog(selId); }
    setBusy(false);
  };

  return (
    <div style={{ padding: '16px 18px', overflow: 'auto', flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: '#E8EEF5' }}>🔌 Интеграция с внешними системами</span>
        <span style={{ fontSize: 12, color: '#5A7090' }}>1С:УНФ · 1С:КА · 1С:ERP — файловый обмен, прямое подключение, OData</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 12 }}>
        <div>
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}><span style={{ fontSize: 13, fontWeight: 600, color: '#B0C4DE' }}>Подключения</span><span style={{ fontSize: 11, color: '#5A7090' }}>двойной клик по подключению — настройки</span></div>
            {conns.length === 0 && <div style={{ fontSize: 12, color: '#5A7090' }}>Пока нет подключений — создайте первое ниже.</div>}
            {conns.map((c) => (
              <div key={c.id} onClick={() => { if (connClicked === c.id) { openConn(c); } else { setSelId(c.id); setConnClicked(c.id); } }} onDoubleClick={() => openConn(c)}
                title="Двойной клик — настройки подключения"
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', borderRadius: 8, cursor: 'pointer', border: selId === c.id ? '1px solid rgba(34,211,238,.5)' : '1px solid #1E3252', background: selId === c.id ? 'rgba(34,211,238,.06)' : '#0A1628', marginBottom: 6 }}>
                <span style={{ color: '#E8EEF5', fontSize: 12.5 }}>{c.name}</span>
                <span style={{ fontSize: 11, color: '#5A7090' }}>{PROFILE_LABEL[c.profile] || c.profile} · {TRANSPORT_LABEL[c.transport] || c.transport}</span>
                {!c.is_active && <span style={{ fontSize: 10.5, color: '#FBBF24' }}>выкл</span>}
                <span style={{ marginLeft: 'auto' }}>
                  <button style={{ ...btn(), padding: '2px 7px' }} onClick={(e) => { e.stopPropagation(); void deleteConn(c); }} title="Удалить подключение">✕</button>
                </span>
              </div>
            ))}
            <div style={{ borderTop: '1px dashed #1E3252', marginTop: 8, paddingTop: 8 }}>
              <button style={{ ...btn('primary'), width: '100%' }} onClick={() => openNewConn()}>➕ Создать подключение</button>
              <div style={{ fontSize: 11, color: '#5A7090', marginTop: 6 }}>Откроется окно: название, система, транспорт и параметры обмена — сохранение создаёт подключение.</div>
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
              <button style={btn()} disabled={busy || !sel} onClick={() => void doOdataTest()}>🔌 OData: тест соединения</button>
              <button style={btn()} disabled={busy || !sel} onClick={() => void doOdataPull()}>📥 Тянуть справочники (OData)</button>
            </div>
            <div style={{ fontSize: 11, color: '#5A7090', marginTop: 8 }}>
              Экспорт формирует пакет плана в исходящий каталог подключения; скан обрабатывает входящие пакеты из каталога; «Применить очередь» переносит принятые данные в справочники.
              OData-кнопки работают для подключений с адресом 1С (нужна публикация OData на стороне 1С): тест проверяет соединение, загрузка тянет справочники напрямую.
              {resp && (<div style={{ marginTop: 8, padding: '7px 10px', border: '1px dashed rgba(34,211,238,.4)', borderRadius: 8, color: '#93C5FD', fontSize: 12 }}>Ответ: {resp}</div>)}
            </div>
          </div>

          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#B0C4DE' }}>Журнал обмена</span>
              <span style={{ fontSize: 11, color: '#5A7090' }}>двойной клик по записи — подробнее</span>
              <button style={{ ...btn(), marginLeft: 'auto' }} onClick={() => { void loadLog(selId); void loadInbox(selId); }}>🔄 Обновить</button>
            </div>
            <div style={{ maxHeight: 340, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}></th><th style={th}>Вид</th><th style={th}>Статус</th><th style={th}>Элементов</th><th style={th}>Файл</th><th style={th}>Сообщение</th><th style={th}>Когда</th></tr></thead>
                <tbody>
                  {log.map((x) => (
                    <tr key={x.id} onClick={() => { if (selLogId === x.id) { void openLogDetails(x); } else { setSelLogId(x.id); } }} onDoubleClick={() => void openLogDetails(x)}
                      title="Двойной клик — подробнее"
                      style={{ cursor: 'pointer', background: selLogId === x.id ? 'rgba(34,211,238,.06)' : 'transparent' }}>
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
