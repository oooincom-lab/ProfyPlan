'use client';
// Форма настроек подключения интеграции — открывается в MDI-окне «Интеграция · имя».
// Сохранение — через колбэк save (PUT /v1/integration/connections/{id}), иначе — только просмотр.
import { useState } from 'react';
import { API_V1 } from '../lib/api';

const inp: any = { background: '#0A1628', border: '1px solid #1E3252', borderRadius: 6, color: '#E8EEF5', padding: '7px 10px', fontSize: 12.5, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' };
const lbl: any = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11.5, color: '#8FA3BD', marginBottom: 8 };

export default function ConnectionForm({ conn, save, onSaved, onClose }: {
  conn: any;
  save?: (id: string | null, body: any) => Promise<any>;
  onSaved?: (u: any) => void;
  onClose?: () => void;
}) {
  const [f, setF] = useState<any>(() => ({
    name: conn?.name || '',
    profile: conn?.profile || '1c_unf',
    transport: conn?.transport || 'file',
    comment: conn?.comment || '',
    is_active: conn?.is_active !== false,
    in_dir: (conn?.settings && conn.settings.in_dir) || '',
    out_dir: (conn?.settings && conn.settings.out_dir) || '',
    base_url: (conn?.settings && conn.settings.base_url) || '',
    username: (conn?.settings && conn.settings.username) || '',
    password: '',
    cloud_provider: (conn?.settings && conn.settings.cloud && conn.settings.cloud.provider) || 'yandex',
    cloud_root_name: String((conn?.settings && conn.settings.cloud && (conn.settings.cloud.root_name || conn.settings.cloud.root)) || 'ProfyPlan').replace(/^\/+/, ''),
    cloud_poll_minutes: (conn?.settings && conn.settings.cloud && conn.settings.cloud.poll_minutes) || 5,
    cloud_client_id: (conn?.settings && conn.settings.cloud && conn.settings.cloud.oauth_app && conn.settings.cloud.oauth_app.client_id) || '',
    cloud_client_secret: '',
    cloud_client_secret_set: !!(
      conn?.settings && conn.settings.cloud && conn.settings.cloud.oauth_app
      && conn.settings.cloud.oauth_app.client_secret_enc
    ),
    cloud_flow: (conn?.settings && conn.settings.cloud && conn.settings.cloud.flow) || 'code',
  }));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const hasPwd = !!((conn?.settings && conn.settings.password));
  const isNew = !(conn && conn.id);
  const [pairCode, setPairCode] = useState<any>(null);
  const [pairBusy, setPairBusy] = useState(false);
  const [pairErr, setPairErr] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string>(conn?.id ? String(conn.id) : '');
  const [cloudConnected, setCloudConnected] = useState<boolean>(() => {
    const cloud = (conn?.settings && conn.settings.cloud) || {};
    const provider = cloud.provider || 'yandex';
    const oauth = (cloud.oauth_by_provider || {})[provider]
      || (cloud.oauth && cloud.oauth.provider === provider ? cloud.oauth : null);
    return !!(oauth && oauth.refresh_token_enc);
  });
  const [oauthCode, setOauthCode] = useState('');
  const [oauthUrl, setOauthUrl] = useState('');
  const [codeBusy, setCodeBusy] = useState(false);
  const [cloudAccount, setCloudAccount] = useState<string>(() => {
    const cloud = (conn?.settings && conn.settings.cloud) || {};
    const provider = cloud.provider || 'yandex';
    const oauth = (cloud.oauth_by_provider || {})[provider]
      || (cloud.oauth && cloud.oauth.provider === provider ? cloud.oauth : null);
    return (oauth && oauth.account) || '';
  });

  const makePairCode = async () => {
    if (!conn || !conn.id) return;
    setPairBusy(true); setPairErr(null); setPairCode(null);
    try {
      const tok = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
      const r = await fetch(`${API_V1}/integration/connections/${conn.id}/agent-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
      });
      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error((data && (data.detail || data.message)) || ('HTTP ' + r.status));
      setPairCode(data);
    } catch (e: any) {
      setPairErr(String(e.message || e).slice(0, 180));
    }
    setPairBusy(false);
  };
  const installerApi = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:8000/v1'
    : 'https://profyplan.ru/api/v1';
  const installerCode = pairCode ? `${conn.id}|${pairCode.code}|${installerApi}` : '';

  const downloadSetup = async () => {
    if (!pairCode) return;
    try {
      await navigator.clipboard.writeText(installerCode);
    } catch (e) { /* clipboard может быть запрещён — код остаётся на экране */ }
    window.location.href = '/companion/ProfyPlanCompanionSetup.exe';
  };

  const upd = (patch: any) => {
    if (patch.cloud_provider && patch.cloud_provider !== f.cloud_provider) {
      setCloudConnected(false);
      setCloudAccount('');
      setOauthUrl('');
    }
    if (patch.cloud_flow && patch.cloud_flow !== f.cloud_flow) setOauthUrl('');
    setF((cur: any) => ({ ...cur, ...patch }));
    setOkMsg(null);
  };

  const saveNow = async () => {
    if (!f.name.trim()) { setMsg('Укажите название подключения'); return; }
    const cloudRoot = String(f.cloud_root_name || '').trim().replace(/^\/+/, '');
    if (f.transport === 'cloud' && f.cloud_provider === 'google' && /[\\/]/.test(cloudRoot)) {
      setMsg('Для Google Drive имя корневой папки не должно содержать слэш'); return;
    }
    if (!save) { setMsg('Сохранение недоступно'); return; }
    setBusy(true); setMsg(null);
    const wasNew = !(conn && conn.id);
    const settings: any = { ...(conn?.settings || {}) };
    const setOrDel = (k: string, v: string) => { const s = String(v || '').trim(); if (s) settings[k] = s; else delete settings[k]; };
    setOrDel('in_dir', f.in_dir);
    setOrDel('out_dir', f.out_dir);
    setOrDel('base_url', f.base_url);
    setOrDel('username', f.username);
    if (String(f.password || '')) settings.password = String(f.password);
    if (f.transport === 'cloud') {
      const cloud: any = { ...(conn?.settings?.cloud || {}) };
      cloud.provider = f.cloud_provider;
      const rootName = cloudRoot || 'ProfyPlan';
      cloud.root_name = rootName;
      const minutes = Number(f.cloud_poll_minutes);
      cloud.poll_minutes = Number.isFinite(minutes) ? Math.max(1, Math.min(60, Math.trunc(minutes))) : 5;
      cloud.flow = f.cloud_flow === 'callback' ? 'callback' : 'code';
      const oauthApp: any = { ...(conn?.settings?.cloud?.oauth_app || {}) };
      const clientId = String(f.cloud_client_id || '').trim();
      const clientSecret = String(f.cloud_client_secret || '').trim();
      if (clientId) oauthApp.client_id = clientId;
      else delete oauthApp.client_id;
      if (clientSecret) oauthApp.client_secret = clientSecret;
      if (clientId && (clientSecret || oauthApp.client_secret_enc)) cloud.oauth_app = oauthApp;
      else delete cloud.oauth_app;
      if (f.cloud_provider === 'yandex') {
        cloud.root = '/' + rootName.replace(/^\/+/, '');
      } else if ((conn?.settings?.cloud?.root_name || '') !== rootName) {
        delete cloud.root_folder_id;
      }
      settings.cloud = cloud;
    }
    const body = { name: f.name.trim(), profile: f.profile, transport: f.transport, settings, comment: f.comment || null, is_active: !!f.is_active };
    try {
      const u = save ? await save(conn && conn.id ? String(conn.id) : null, body) : null;
      if (onSaved) onSaved(u || { ...conn, ...body });
      const nextId = (u && u.id) || (conn && conn.id) || savedId;
      if (nextId) setSavedId(String(nextId));
      const nextCloud = u && u.settings && u.settings.cloud;
      if (nextCloud) {
        const nextOauth = (nextCloud.oauth_by_provider || {})[f.cloud_provider]
          || (nextCloud.oauth && nextCloud.oauth.provider === f.cloud_provider ? nextCloud.oauth : null);
        setCloudConnected(!!(nextOauth && nextOauth.refresh_token_enc));
        setCloudAccount((nextOauth && nextOauth.account) || '');
      }
      setOkMsg(wasNew ? 'Подключение создано ✅' : 'Настройки сохранены ✅');
      setF((cur: any) => ({ ...cur, password: '' }));
    } catch (e: any) {
      setMsg('Ошибка сохранения: ' + String((e && e.message) || e).slice(0, 160));
    }
    setBusy(false);
  };

  const connectCloud = async () => {
    const id = savedId || (conn && conn.id ? String(conn.id) : '');
    if (!id) { setMsg('Сначала сохраните подключение, затем подключите облако'); return; }
    const codeMode = f.cloud_provider === 'yandex' && f.cloud_flow === 'code';
    setBusy(true); setMsg(null);
    try {
      const tok = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
      const mode = codeMode ? 'code' : 'callback';
      const r = await fetch(`${API_V1}/integration/connections/${id}/cloud/oauth/start?provider=${encodeURIComponent(f.cloud_provider)}&mode=${mode}`, {
        headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      });
      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error((data && (data.detail || data.message)) || ('HTTP ' + r.status));
      if (!data?.authorize_url) throw new Error('Сервер не вернул ссылку авторизации');
      if (mode === 'code') {
        setOauthUrl(data.authorize_url);
        setMsg('Ссылка готова. Нажмите «Открыть страницу Яндекса», подтвердите доступ и вставьте код ниже.');
      } else {
        window.location.assign(data.authorize_url);
      }
      setBusy(false);
    } catch (e: any) {
      setMsg('OAuth: ' + String((e && e.message) || e).slice(0, 200));
      setBusy(false);
    }
  };

  const exchangeCloudCode = async () => {
    const id = savedId || (conn && conn.id ? String(conn.id) : '');
    if (!id) { setMsg('Сначала сохраните подключение'); return; }
    const code = oauthCode.trim();
    if (!code) { setMsg('Вставьте код подтверждения из Яндекса'); return; }
    setCodeBusy(true); setMsg(null); setOkMsg(null);
    try {
      const tok = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
      const r = await fetch(`${API_V1}/integration/connections/${id}/cloud/oauth/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
        body: JSON.stringify({ code }),
      });
      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error((data && (data.detail || data.message)) || ('HTTP ' + r.status));
      setCloudConnected(true);
      setOauthCode('');
      setOkMsg('Доступ к облаку подтверждён' + (data?.root ? ': ' + data.root : '') + ' ✅');
    } catch (e: any) {
      setMsg('Код: ' + String((e && e.message) || e).slice(0, 220));
    }
    setCodeBusy(false);
  };

  const checkCloud = async () => {
    const id = savedId || (conn && conn.id ? String(conn.id) : '');
    if (!id) { setMsg('Сначала сохраните подключение, затем проверьте доступ'); return; }
    setBusy(true); setMsg(null); setOkMsg(null);
    try {
      const tok = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
      const r = await fetch(`${API_V1}/integration/connections/${id}/cloud/check`, {
        method: 'POST',
        headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      });
      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error((data && (data.detail || data.message)) || ('HTTP ' + r.status));
      setOkMsg('Доступ к облаку подтверждён' + (data?.root ? ': ' + data.root : '') + ' ✅');
    } catch (e: any) {
      setMsg('Проверка доступа: ' + String((e && e.message) || e).slice(0, 200));
    }
    setBusy(false);
  };

  const row = (label: string, node: any) => (
    <label style={lbl}><span>{label}</span>{node}</label>
  );

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#B0C4DE', marginBottom: 10 }}>{isNew ? '🔌 Новое подключение' : '🔌 Настройки подключения'}</div>
      {row('Название', <input style={inp} value={f.name} placeholder="Например: УНФ ТОПЕКС" onChange={(e) => upd({ name: e.target.value })} />)}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {row('Система', (
          <select style={inp} value={f.profile} onChange={(e) => upd({ profile: e.target.value })}>
            <option value="1c_unf">1С:УНФ</option>
            <option value="1c_ka">1С:КА</option>
            <option value="1c_erp">1С:ERP</option>
            <option value="custom">Другая система</option>
          </select>
        ))}
        {row('Транспорт', (
          <select style={inp} value={f.transport} onChange={(e) => upd({ transport: e.target.value })}>
            <option value="file">Файловый обмен</option>
            <option value="cloud">Облачный обмен</option>
            <option value="http">Прямое подключение</option>
            <option value="odata">OData</option>
          </select>
        ))}
      </div>
      {f.transport === 'file' ? (
        <div style={{ border: '1px dashed #1E3252', borderRadius: 8, padding: '8px 10px', marginBottom: 8 }}>
          <div style={{ fontSize: 11.5, color: '#5A7090', marginBottom: 6 }}>Файловый обмен — каталоги на сервере (пусто = по умолчанию /app/exchange/in|out):</div>
          {row('Каталог входящих (in_dir)', <input style={inp} value={f.in_dir} placeholder="/app/exchange/in" onChange={(e) => upd({ in_dir: e.target.value })} />)}
          {row('Каталог исходящих (out_dir)', <input style={inp} value={f.out_dir} placeholder="/app/exchange/out" onChange={(e) => upd({ out_dir: e.target.value })} />)}
        </div>
      ) : f.transport === 'cloud' ? (
        <div style={{ border: '1px dashed #1E3252', borderRadius: 8, padding: '8px 10px', marginBottom: 8 }}>
          <div style={{ fontSize: 11.5, color: '#5A7090', marginBottom: 6 }}>Один раз подтвердите доступ к облаку. ProfyPlan сам получит и будет обновлять токен, создаст папки обмена и включит планировщик.</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {row('Провайдер', (
              <select style={inp} value={f.cloud_provider} onChange={(e) => upd({ cloud_provider: e.target.value })}>
                <option value="yandex">Яндекс Диск</option>
                <option value="google">Google Drive</option>
              </select>
            ))}
            {row('Интервал опроса, мин', <input style={inp} type="number" min={1} max={60} value={f.cloud_poll_minutes} onChange={(e) => upd({ cloud_poll_minutes: e.target.value })} />)}
          </div>
          {f.cloud_provider === 'yandex' && (
            row('Способ подключения', (
              <select style={inp} value={f.cloud_flow} onChange={(e) => upd({ cloud_flow: e.target.value })}>
                <option value="code">Код подтверждения (как в 1С)</option>
                <option value="callback">Redirect callback</option>
              </select>
            ))
          )}
          {row('Корневая папка', <input style={inp} value={f.cloud_root_name} placeholder="ProfyPlan" onChange={(e) => upd({ cloud_root_name: e.target.value })} />)}
          <div style={{ fontSize: 11, color: '#5A7090', marginTop: -2, marginBottom: 6 }}>
            Если папки с таким названием нет, ProfyPlan создаст её и канонические папки обмена. Если корень создаёт 1С, расшарьте его ProfyPlan с правом «Редактор».
          </div>
          <div style={{ borderTop: '1px dashed #1E3252', paddingTop: 8, marginTop: 2 }}>
            <div style={{ fontSize: 11.5, color: '#8FA3BD', marginBottom: 6 }}>
              OAuth-приложение Яндекса. Можно оставить пустым, если оно уже задано на сервере.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {row('Client ID', <input style={inp} value={f.cloud_client_id} placeholder="Из OAuth-приложения" onChange={(e) => upd({ cloud_client_id: e.target.value })} />)}
              {row('Client secret', <input style={inp} type="password" value={f.cloud_client_secret} placeholder={f.cloud_client_secret_set ? '•••••• сохранён' : 'Секрет приложения'} onChange={(e) => upd({ cloud_client_secret: e.target.value })} />)}
            </div>
            <div style={{ fontSize: 11, color: '#5A7090', marginTop: -2, marginBottom: 6 }}>
              Callback URL: {typeof window !== 'undefined' ? window.location.origin : ''}/api/v1/integration/cloud/oauth/callback
            </div>
          </div>
          {f.cloud_provider === 'yandex' && f.cloud_flow === 'code' && (
            <div style={{ border: '1px solid rgba(34,211,238,.25)', borderRadius: 8, padding: '8px 10px', marginBottom: 8 }}>
              <div style={{ fontSize: 11.5, color: '#8FA3BD', marginBottom: 6 }}>
                Откройте страницу Яндекса, подтвердите доступ и вставьте код подтверждения из браузера.
              </div>
              {oauthUrl && (
                <div style={{ marginBottom: 7 }}>
                  <a href={oauthUrl} target="_blank" rel="noreferrer"
                    style={{ display: 'inline-block', background: 'rgba(34,211,238,.14)', border: '1px solid rgba(34,211,238,.45)', color: '#A5F3FC', borderRadius: 6, padding: '6px 10px', fontSize: 12, textDecoration: 'none' }}>
                    Открыть страницу Яндекса
                  </a>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input style={{ ...inp, flex: '1 1 220px' }} value={oauthCode} onChange={(e) => setOauthCode(e.target.value)} placeholder="Код подтверждения" />
                <button type="button" disabled={codeBusy} onClick={() => void exchangeCloudCode()}
                  style={{ background: 'rgba(34,211,238,.14)', border: '1px solid rgba(34,211,238,.45)', color: '#A5F3FC', borderRadius: 6, padding: '7px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {codeBusy ? 'Проверка…' : 'Получить токены'}
                </button>
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
            <button type="button" disabled={busy} onClick={() => void connectCloud()}
              style={{ background: 'rgba(34,211,238,.14)', border: '1px solid rgba(34,211,238,.45)', color: '#A5F3FC', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
              {cloudConnected ? 'Переподключить облако' : 'Подключить ' + (f.cloud_provider === 'google' ? 'Google Drive' : 'Яндекс Диск')}
            </button>
            <button type="button" disabled={busy} onClick={() => void checkCloud()}
              style={{ background: 'transparent', border: '1px solid #1E3252', color: '#B0C4DE', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
              Проверить доступ
            </button>
            <span style={{ fontSize: 11.5, color: cloudConnected ? '#4ADE80' : '#FBBF24' }}>
              {cloudConnected ? 'Доступ подтверждён' + (cloudAccount ? ': ' + cloudAccount : '') : 'Доступ ещё не подтверждён'}
            </span>
          </div>
          <div style={{ fontSize: 11, color: '#5A7090', marginTop: 6 }}>
            Откроется страница провайдера для входа и согласия. Папки создаются автоматически; после возврата в ProfyPlan проверьте статус на странице «Интеграция».{!savedId && !conn?.id ? ' Сохраните подключение перед подключением облака.' : ''}
          </div>
        </div>
      ) : (
        <div style={{ border: '1px dashed #1E3252', borderRadius: 8, padding: '8px 10px', marginBottom: 8 }}>
          <div style={{ fontSize: 11.5, color: '#5A7090', marginBottom: 6 }}>Сетевое подключение к 1С (публикация OData/HTTP-сервисов):</div>
          {row('Адрес 1С (base_url)', <input style={inp} value={f.base_url} placeholder="http://1c-server/unf/odata/standard.odata" onChange={(e) => upd({ base_url: e.target.value })} />)}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {row('Пользователь', <input style={inp} value={f.username} onChange={(e) => upd({ username: e.target.value })} />)}
            {row('Пароль', <input style={inp} type="password" value={f.password} placeholder={hasPwd ? '•••••• (не менять)' : ''} onChange={(e) => upd({ password: e.target.value })} />)}
          </div>
        </div>
      )}
      {f.transport === 'file' && (
        <div style={{ border: '1px solid rgba(59,130,246,.35)', background: 'rgba(59,130,246,.06)', borderRadius: 8, padding: '9px 11px', marginBottom: 10 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: '#B0C4DE', marginBottom: 3 }}>Обмен на этом компьютере</div>
          <div style={{ fontSize: 11.5, color: '#5A7090', marginBottom: 7 }}>
            Chrome, Edge, Opera, Яндекс Браузер: установите помощник — он увидит папку на этой машине. Для Firefox и Safari нужен companion-агент.
          </div>
          <a href="/extension/index.html" target="_blank" rel="noreferrer"
            style={{ display: 'inline-block', background: 'rgba(59,130,246,.18)', border: '1px solid rgba(59,130,246,.5)', color: '#93C5FD', borderRadius: 6, padding: '5px 10px', fontSize: 12, textDecoration: 'none' }}>
            Установить расширение
          </a>
        </div>
      )}
      {!isNew && f.transport === 'file' && (
        <div style={{ border: '1px dashed #1E3252', borderRadius: 8, padding: '9px 11px', marginBottom: 10 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: '#B0C4DE', marginBottom: 3 }}>Привязка companion</div>
          <div style={{ fontSize: 11.5, color: '#5A7090', marginBottom: 7 }}>
            Одноразовый код для помощника на компьютере. Код действует 10 минут, пароль вводить не нужно.
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" onClick={() => void makePairCode()} disabled={pairBusy}
              style={{ background: 'rgba(34,211,238,.15)', border: '1px solid rgba(34,211,238,.45)', color: '#A5F3FC', borderRadius: 6, padding: '5px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
              {pairBusy ? '…' : 'Создать код привязки'}
            </button>
            {pairCode && <span style={{ fontSize: 13, color: '#86EFAC' }}>Код: <b style={{ letterSpacing: 2 }}>{pairCode.code}</b> · 10 минут</span>}
            {pairCode && (
              <span style={{ fontSize: 11.5, color: '#5A7090', width: '100%' }}>
                ID: <code>{conn.id}</code> · код: <code>{pairCode.code}</code> · <code>{installerCode}</code>
                <button type="button" onClick={() => void downloadSetup()}
                  style={{ marginLeft: 6, background: 'rgba(34,211,238,.18)', border: '1px solid rgba(34,211,238,.5)', color: '#A5F3FC', borderRadius: 6, padding: '5px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Скачать установщик
                </button>
              </span>
            )}
          </div>
          {pairErr && <div style={{ fontSize: 11.5, color: '#F87171', marginTop: 6 }}>{pairErr}</div>}
        </div>
      )}
      {row('Комментарий', <input style={inp} value={f.comment} onChange={(e) => upd({ comment: e.target.value })} />)}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#8FA3BD', marginBottom: 10 }}>
        <input type="checkbox" checked={!!f.is_active} onChange={(e) => upd({ is_active: e.target.checked })} />
        Подключение включено (участвует в обмене)
      </label>
      {msg && <div style={{ padding: '7px 10px', border: '1px dashed rgba(248,113,113,.5)', borderRadius: 8, color: '#F87171', fontSize: 12, marginBottom: 8 }}>{msg}</div>}
      {okMsg && <div style={{ padding: '7px 10px', border: '1px dashed rgba(74,222,128,.5)', borderRadius: 8, color: '#4ADE80', fontSize: 12, marginBottom: 8 }}>{okMsg}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 10, borderTop: '1px solid #1E3252' }}>
        <button onClick={() => { if (onClose) onClose(); }} style={{ background: 'transparent', border: '1px solid #1E3A5F', color: '#8FA3BD', borderRadius: 8, padding: '7px 16px', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>Отмена</button>
        <button onClick={() => void saveNow()} disabled={busy} style={{ background: '#0891B2', border: 'none', color: '#fff', borderRadius: 8, padding: '7px 16px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: busy ? 0.6 : 1 }}>{busy ? 'Сохранение…' : (isNew ? '➕ Создать' : '💾 Сохранить')}</button>
      </div>
    </div>
  );
}
