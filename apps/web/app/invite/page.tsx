'use client';

/**
 * Страница присоединения по приглашению (блок 6.34.2 «Команда»).
 * Открывается по ссылке из письма: /invite?token=…
 * Новый сотрудник задаёт пароль; существующий — вводит пароль от своего аккаунта.
 */
import { useEffect, useState } from 'react';

const API_ORIGIN =
  typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:8000'
    : 'https://profyplan.ru';
const API = API_ORIGIN + '/api/v1';

const card: any = { background: 'linear-gradient(135deg, #0F1E36, #162844)', borderRadius: 12, border: '1px solid #1E3252', padding: 24, maxWidth: 420, margin: '0 auto', textAlign: 'left' };
const input: any = { background: '#0A1628', border: '1px solid #1E3252', borderRadius: 6, color: '#E8EEF5', padding: '10px 14px', fontSize: 14, width: '100%', boxSizing: 'border-box' };

export default function InvitePage() {
  const [token, setToken] = useState<string | null>(null);
  const [info, setInfo] = useState<any>(null);
  const [infoErr, setInfoErr] = useState('');
  const [form, setForm] = useState({ name: '', password: '', password2: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('token');
    if (!t) { setInfoErr('Ссылка приглашения неполная: нет токена.'); return; }
    setToken(t);
    fetch(`${API}/team/invitation/${t}`)
      .then(async r => {
        const d = await r.json().catch(() => null);
        if (!r.ok) throw new Error((d && d.detail) || ('Ошибка ' + r.status));
        setInfo(d);
      })
      .catch(e => setInfoErr(String(e.message || e)));
  }, []);

  const join = async () => {
    if (!token || busy || !info || info.status !== 'pending') return;
    if (!form.password) { setErr('Введите пароль.'); return; }
    if (form.password !== form.password2) { setErr('Пароли не совпадают.'); return; }
    setBusy(true); setErr('');
    try {
      const r = await fetch(`${API}/team/invitation/${token}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name, password: form.password }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) { setErr((d && d.detail) || ('Не удалось присоединиться (код ' + r.status + ').')); return; }
      try {
        localStorage.setItem('profyplan_token', d.access_token);
        if (d.refresh_token) localStorage.setItem('profyplan_refresh', d.refresh_token);
      } catch { /* приватный режим — войдём вручную */ }
      setDone(true);
      setTimeout(() => { window.location.href = '/workspace'; }, 1000);
    } catch {
      setErr('Нет связи с сервером — попробуйте ещё раз.');
    } finally { setBusy(false); }
  };

  const statusRu = (s: string) => ({ pending: 'ожидает', accepted: 'уже принято', revoked: 'отозвано', expired: 'истекло' } as any)[s] || s;

  return (
    <div style={{ background: '#0A1628', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#E8EEF5' }}>
      <div style={{ width: '100%', maxWidth: 460, padding: 16 }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: '#3B82F6', margin: '0 auto 14px' }} />
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 6px' }}>ProfyPlan</h1>
          <div style={{ color: '#5A7090', fontSize: 13 }}>Присоединение к организации</div>
        </div>

        {infoErr && (
          <div style={card}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Приглашение недоступно</div>
            <div style={{ fontSize: 13, color: '#FCA5A5', marginBottom: 14 }}>{infoErr}</div>
            <a href="/workspace" style={{ color: '#60A5FA', fontSize: 13 }}>← Ко входу</a>
          </div>
        )}

        {!infoErr && !info && (
          <div style={{ ...card, textAlign: 'center', color: '#5A7090', fontSize: 13 }}>Загрузка приглашения…</div>
        )}

        {info && (
          <div style={card}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Присоединиться к «{info.tenant_name}»</div>
            <div style={{ fontSize: 12.5, color: '#5A7090', marginBottom: 14 }}>
              Приглашение для {info.email} · роль: {roleRu(info.role)} · статус: {statusRu(info.status)}
            </div>

            {done ? (
              <div style={{ color: '#34D399', fontSize: 13.5 }}>Готово! Открываем рабочий стол…</div>
            ) : info.status !== 'pending' ? (
              <div>
                <div style={{ fontSize: 13, color: '#FBBF24', marginBottom: 12 }}>Приглашение {statusRu(info.status)} — попросите новое у администратора организации.</div>
                <a href="/workspace" style={{ color: '#60A5FA', fontSize: 13 }}>← Ко входу</a>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ваше имя (для нового аккаунта)" style={input} autoFocus />
                <input value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} type="password" placeholder="Пароль (не короче 8 символов)" style={input} />
                <input value={form.password2} onChange={e => setForm({ ...form, password2: e.target.value })} type="password" placeholder="Пароль ещё раз" style={input} onKeyDown={e => { if (e.key === 'Enter') join(); }} />
                <button onClick={join} disabled={busy} style={{ background: '#3B82F6', border: 'none', borderRadius: 8, color: '#fff', padding: '10px 14px', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {busy ? 'Присоединяемся…' : 'Присоединиться'}
                </button>
                {err && <div style={{ color: '#EF4444', fontSize: 12, textAlign: 'center' }}>{err}</div>}
                <div style={{ fontSize: 11.5, color: '#5A7090' }}>Если у вас уже есть аккаунт в ProfyPlan — просто введите его пароль: имя и пароль останутся прежними.</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function roleRu(r: string): string {
  return ({ owner: 'Владелец', admin: 'Администратор', planner: 'Планировщик', viewer: 'Наблюдатель' } as any)[(r || '').toLowerCase()] || r;
}
