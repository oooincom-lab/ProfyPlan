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
const TRANSPORT_LABEL: any = { file: 'файловый', cloud: 'облако', http: 'прямое', odata: 'OData' };
const DIR_ICON: any = { out: '📤', 'in': '📥' };
const STATUS_COLOR: any = { ok: '#4ADE80', partial: '#FBBF24', error: '#F87171', applied: '#4ADE80', skipped: '#8FA3BD', pending: '#93C5FD' };

export default function IntegrationView({ api, notify, openXlog, openXconn, openXjournal }: { api: Api; notify: (m: string) => void; openXlog?: (e: any, items?: any[]) => void; openXconn?: (c: any, save?: (id: string | null, body: any) => Promise<any>) => void; openXjournal?: () => void }) {
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
  const [cloud, setCloud] = useState<any>(null);
  const [nameChanges, setNameChanges] = useState<any[]>([]);
  const [editPolicy, setEditPolicy] = useState<string>('planning');
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
  const loadNameChanges = async () => {
    try { const r = await api('/integration/name-changes'); setNameChanges(r.items || []); } catch { /* тихо */ }
  };
  const loadEditPolicy = async () => {
    try { const r = await api('/integration/edit-policy'); setEditPolicy(r.policy || 'planning'); } catch { /* тихо */ }
  };
  const loadCloud = async (cid?: string | null) => {
    const conn = conns.find((x) => x.id === cid);
    if (!cid || !conn || conn.transport !== 'cloud') { setCloud(null); return; }
    try { const r = await api('/integration/connections/' + cid + '/cloud/status'); setCloud(r); }
    catch { setCloud(null); }
  };

  useEffect(() => { void loadConns(); void loadProjects(); void loadNameChanges(); void loadEditPolicy(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { void loadLog(selId); void loadInbox(selId); /* eslint-disable-next-line */ }, [selId]);
  useEffect(() => { void loadCloud(selId); /* eslint-disable-next-line */ }, [selId, conns]);
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
  const doCloudCheck = async () => {
    if (!sel) { say('Выберите подключение'); return; }
    setBusy(true);
    try {
      const r = await api('/integration/connections/' + sel.id + '/cloud/check', { method: 'POST' });
      say('Облако: доступно — ' + (r.root || r.provider || 'провайдер'));
      await loadCloud(selId); void loadLog(selId);
    } catch (e: any) { say('Облако: ' + (e?.message || e)); void loadLog(selId); }
    setBusy(false);
  };
  const doCloudPoll = async () => {
    if (!sel) { say('Выберите подключение'); return; }
    setBusy(true);
    try {
      const r = await api('/integration/connections/' + sel.id + '/cloud/poll', { method: 'POST' });
      const incoming = r.incoming?.processed ?? 0;
      const outgoing = r.outgoing?.uploaded?.length ?? 0;
      say('Облако: принято ' + incoming + ', отправлено ' + outgoing + '. Проверьте очередь и журнал.');
      await loadCloud(selId); void loadInbox(selId); void loadLog(selId);
    } catch (e: any) { say('Облако: ' + (e?.message || e)); void loadLog(selId); }
    setBusy(false);
  };
  const decideName = async (item: any, accept: boolean) => {
    setBusy(true);
    try {
      await api('/integration/name-changes/' + item.entity_type + '/' + item.id + '/' + (accept ? 'accept' : 'keep'), { method: 'POST' });
      say(accept ? 'Имя принято из 1С' : 'Оставлено локальное имя');
      void loadNameChanges();
    } catch (e: any) { say('Имя: ' + (e?.message || e)); }
    setBusy(false);
  };
  const changeEditPolicy = async (policy: string) => {
    setBusy(true);
    try {
      await api('/integration/edit-policy', { method: 'PUT', body: JSON.stringify({ policy }) });
      setEditPolicy(policy);
      say(policy === 'strict_1c' ? 'Включён строгий режим 1С' : 'Включён режим планирования');
    } catch (e: any) { say('Политика: ' + (e?.message || e)); }
    setBusy(false);
  };

  return (
    <div style={{ padding: '16px 18px', overflow: 'auto', flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: '#E8EEF5' }}>🔌 Интеграция с внешними системами</span>
        <span style={{ fontSize: 12, color: '#5A7090' }}>1С:УНФ · 1С:КА · 1С:ERP — файловый обмен, прямое подключение, OData</span>
      </div>

      <div style={{ ...card, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: '#B0C4DE' }}>Политика редактирования</span>
        <select style={{ ...inp, width: 240 }} value={editPolicy} disabled={busy} onChange={(e) => void changeEditPolicy(e.target.value)}>
          <option value="planning">1С — планирование</option>
          <option value="strict_1c">1С — строгий</option>
        </select>
        <span style={{ fontSize: 11, color: '#5A7090' }}>
          {editPolicy === 'strict_1c'
            ? 'Импортированные проекты, заказы и операции нельзя менять в ProfyPlan — только в 1С.'
            : 'Мастер-данные из 1С можно править локально; факты остаются read-only.'}
        </span>
      </div>

      {nameChanges.length > 0 && (
        <div style={{ ...card, marginBottom: 12, borderColor: 'rgba(245,158,11,.35)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 7 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#FBBF24' }}>Изменения из 1С</span>
            <span style={{ fontSize: 11, color: '#5A7090' }}>наименования, которые изменились после вашего переименования</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: '#FBBF24' }}>{nameChanges.length}</span>
          </div>
          <div style={{ display: 'grid', gap: 5 }}>
            {nameChanges.slice(0, 8).map((n) => (
              <div key={n.entity_type + n.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '6px 8px', background: '#0A1628', border: '1px solid #1E3252', borderRadius: 7 }}>
                <span style={{ fontSize: 11, color: '#8FA3BD', minWidth: 100 }}>{n.entity_label}</span>
                <span style={{ fontSize: 12, color: '#E8EEF5' }}>{n.name}</span>
                <span style={{ fontSize: 11, color: '#5A7090' }}>→</span>
                <span style={{ fontSize: 12, color: '#93C5FD' }}>{n.external_name}</span>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <button style={{ ...btn('primary'), padding: '3px 8px', fontSize: 11 }} disabled={busy} onClick={() => void decideName(n, true)}>Принять имя из 1С</button>
                  <button style={{ ...btn(), padding: '3px 8px', fontSize: 11 }} disabled={busy} onClick={() => void decideName(n, false)}>Оставить локальное</button>
                </span>
              </div>
            ))}
          </div>
          {nameChanges.length > 8 && <div style={{ fontSize: 11, color: '#5A7090', marginTop: 5 }}>Показаны первые 8 из {nameChanges.length}.</div>}
        </div>
      )}

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
              {sel?.transport !== 'cloud' && (
                <>
                  <button style={btn()} disabled={busy || !sel} onClick={() => void doOdataTest()}>🔌 OData: тест соединения</button>
                  <button style={btn()} disabled={busy || !sel} onClick={() => void doOdataPull()}>📥 Тянуть справочники (OData)</button>
                </>
              )}
            </div>
            {sel?.transport === 'cloud' && (
              <div style={{ marginTop: 10, padding: '9px 11px', border: '1px dashed rgba(34,211,238,.35)', borderRadius: 8, background: 'rgba(34,211,238,.035)' }}>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', fontSize: 12 }}>
                  <b style={{ color: '#B0C4DE' }}>Облачный обмен</b>
                  <span style={{ color: '#93C5FD' }}>{cloud?.provider === 'google' ? 'Google Drive' : 'Яндекс Диск'}</span>
                  <span style={{ color: '#5A7090' }}>{cloud?.root || 'папка не настроена'}</span>
                  <span style={{ color: cloud?.configured ? '#4ADE80' : '#FBBF24' }}>
                    {cloud?.configured ? 'доступ настроен' : 'нет токена или папок на сервере'}
                  </span>
                  {cloud?.oauth_connected && <span style={{ color: '#4ADE80' }}>аккаунт подтверждён{cloud?.account ? ': ' + cloud.account : ''}</span>}
                  <span style={{ color: '#5A7090' }}>опрос каждые {cloud?.poll_minutes || 5} мин</span>
                  {cloud?.last_poll_at && <span style={{ color: '#5A7090' }}>последний: {String(cloud.last_poll_at).slice(0, 16).replace('T', ' ')}</span>}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 7 }}>
                  <button style={btn()} disabled={busy || !sel} onClick={() => { if (sel) openConn(sel); }}>
                    ⚙️ Настройки облака
                  </button>
                  <button style={btn()} disabled={busy} onClick={() => void doCloudCheck()}>🔎 Проверить доступ</button>
                  <button style={btn('primary')} disabled={busy} onClick={() => void doCloudPoll()}>🔄 Опросить облако сейчас</button>
                </div>
                <div style={{ fontSize: 11, color: '#5A7090', marginTop: 6 }}>
                  Подключение и OAuth — в окне настроек подключения. Здесь оставлены проверка и опрос уже настроенного канала.
                </div>
                {cloud && cloud.scheduler_enabled === false && <div style={{ fontSize: 11, color: '#FBBF24', marginTop: 5 }}>Автоматический опрос выключен на сервере.</div>}
              </div>
            )}
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
              <button style={{ ...btn(), marginLeft: 'auto' }} onClick={() => { if (openXjournal) openXjournal(); }}>🔎 Показать подробнее</button>
              <button style={{ ...btn() }} onClick={() => { void loadLog(selId); void loadInbox(selId); }}>🔄 Обновить</button>
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
