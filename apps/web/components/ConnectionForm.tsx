'use client';
// Форма настроек подключения интеграции — открывается в MDI-окне «Интеграция · имя».
// Сохранение — через колбэк save (PUT /v1/integration/connections/{id}), иначе — только просмотр.
import { useState } from 'react';

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
  }));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const hasPwd = !!((conn?.settings && conn.settings.password));
  const isNew = !(conn && conn.id);

  const upd = (patch: any) => { setF((cur: any) => ({ ...cur, ...patch })); setOkMsg(null); };

  const saveNow = async () => {
    if (!f.name.trim()) { setMsg('Укажите название подключения'); return; }
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
    const body = { name: f.name.trim(), profile: f.profile, transport: f.transport, settings, comment: f.comment || null, is_active: !!f.is_active };
    try {
      const u = save ? await save(conn && conn.id ? String(conn.id) : null, body) : null;
      if (onSaved) onSaved(u || { ...conn, ...body });
      setOkMsg(wasNew ? 'Подключение создано ✅' : 'Настройки сохранены ✅');
      setF((cur: any) => ({ ...cur, password: '' }));
    } catch (e: any) {
      setMsg('Ошибка сохранения: ' + String((e && e.message) || e).slice(0, 160));
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
