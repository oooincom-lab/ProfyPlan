'use client';
// Готовность к расчёту: пошаговый чек-лист подготовки данных проекта.
import { useEffect, useState } from 'react';

type Api = (path: string, opts?: any) => Promise<any>;

const card: any = { background: 'var(--bg-2, #0D1F3A)', border: '1px solid var(--border, #1E3252)', borderRadius: 10, padding: '12px 14px', marginBottom: 8 };
const inp: any = { background: '#0A1628', border: '1px solid #1E3252', borderRadius: 6, color: '#E8EEF5', padding: '6px 9px', fontSize: 12.5, fontFamily: 'inherit' };
const btn: any = { background: 'transparent', border: '1px solid #2A4060', color: '#8FA3BD', borderRadius: 8, padding: '5px 12px', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' };
const btnP: any = { ...btn, background: '#2563EB', border: 'none', color: '#fff', fontWeight: 600 };
const ICON: any = { ok: '✅', warn: '⚠️', block: '⛔' };
const COL: any = { ok: '#4ADE80', warn: '#FBBF24', block: '#F87171' };
const HINTS: any = {
  orders: 'Заказы — основа расчёта. Черновики в расчёт не попадают.',
  structure: 'Маршруты и подразделения: без подразделения развёртка блокируется.',
  calendar: 'Календарь проекта задаёт рабочие дни и смены.',
  resources: 'Ресурсы нужны для загрузки и выравнивания.',
  calculation: 'Локальный расчёт проекта (CPM/каскад).',
  complex: 'Межпроектные связи — если проект в ветке с другими.',
  fixation: 'Фиксация плана — то, что уходит в 1С.',
  leveling: 'Если проекты делят ресурсы — проверьте CCM → «Выравнивание».',
};

export default function ReadinessView({ api, projects, notify, onOpenProject, onOpenCcm, onOpenComplex }: {
  api: Api; projects: any[]; notify: (m: string) => void;
  onOpenProject?: (p: any) => void; onOpenCcm?: () => void; onOpenComplex?: () => void;
}) {
  const active = (projects || []).filter((p: any) => p.status !== 'archived');
  const [pid, setPid] = useState('');
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pid && active.length) setPid(active[0].id);
    /* eslint-disable-next-line */
  }, [projects]);

  const load = async () => {
    if (!pid) return;
    setBusy(true);
    try {
      const r = await api(`/projects/${pid}/readiness`);
      setData(r);
    } catch (e: any) { notify('Ошибка проверки: ' + (e?.message || e)); }
    setBusy(false);
  };
  /* eslint-disable-next-line */
  useEffect(() => { void load(); }, [pid]);

  const open = (item: any) => {
    if (item.action === 'complex' && onOpenComplex) { onOpenComplex(); return; }
    if (item.action === 'ccm' && onOpenCcm) { onOpenCcm(); return; }
    const p = (projects || []).find((x: any) => x.id === pid);
    if (p && onOpenProject) onOpenProject(p);
  };

  const nextItem = data?.items?.find((i: any) => i.id === data.next);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 16, fontWeight: 700 }}>✅ Готовность к расчёту</span>
        <span style={{ fontSize: 11.5, color: '#5A7090' }}>порядок подготовки данных: от заказов до фиксации плана</span>
      </div>

      <div style={{ ...card, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: '#8FA3BD' }}>Проект</span>
        <select style={inp} value={pid} onChange={(e) => setPid(e.target.value)}>
          {active.map((p: any) => (<option key={p.id} value={p.id}>{p.name}</option>))}
        </select>
        <button style={btn} disabled={busy} onClick={() => void load()}>🔄 Проверить снова</button>
        {data && (
          <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 600 }}>
            Готово: <span style={{ color: data.score.ok === data.score.total ? '#4ADE80' : '#FBBF24' }}>{data.score.ok} из {data.score.total}</span>
          </span>
        )}
      </div>

      {nextItem && (
        <div style={{ ...card, borderColor: 'rgba(251,191,36,.45)', background: 'rgba(251,191,36,.06)' }}>
          <b>Что дальше:</b> {nextItem.title} — {nextItem.detail}
          <button style={{ ...btnP, marginLeft: 10 }} onClick={() => open(nextItem)}>Перейти</button>
        </div>
      )}
      {data && !nextItem && (
        <div style={{ ...card, borderColor: 'rgba(74,222,128,.45)', background: 'rgba(74,222,128,.06)' }}>
          <b>Всё готово:</b> можно фиксировать план и передавать в 1С.
        </div>
      )}

      {(data?.items || []).map((item: any) => (
        <div key={item.id} style={{ ...card, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 16, width: 22, textAlign: 'center' }}>{ICON[item.status] || '•'}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: COL[item.status] || '#E8EEF5' }}>{item.title}</div>
            <div style={{ fontSize: 12, color: '#8FA3BD' }}>{item.detail}</div>
            {HINTS[item.id] && <div style={{ fontSize: 11, color: '#5A7090', marginTop: 2 }}>{HINTS[item.id]}</div>}
          </div>
          <button style={btn} onClick={() => open(item)}>
            {item.action === 'complex' ? 'Комплекс' : item.action === 'ccm' ? 'К выравниванию' : item.id === 'fixation' ? 'К фиксации' : 'Перейти'}
          </button>
        </div>
      ))}
    </div>
  );
}
