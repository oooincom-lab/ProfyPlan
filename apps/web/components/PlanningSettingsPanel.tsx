'use client';

import { useCallback, useEffect, useState } from 'react';

function resolveApiBase(): string {
  const env = process.env.NEXT_PUBLIC_API_URL;
  if (typeof window !== 'undefined') {
    const h = window.location.hostname;
    if (h === 'localhost' || h === '127.0.0.1') return 'http://localhost:8000';
  }
  return env || 'https://profyplan.ru/api';
}
const API = resolveApiBase() + '/v1';

const SOURCE_LABEL: Record<string, string> = {
  system: 'по умолчанию (система)',
  workspace: 'рабочий стол',
  project: 'проект',
  group: 'группа',
  pool: 'кластер',
};
const SOURCE_COLOR: Record<string, string> = {
  system: '#5A7090',
  workspace: '#93C5FD',
  project: '#86EFAC',
  group: '#C4B5FD',
  pool: '#F0ABFC',
};

type Param = { key: string; group: string; type: string; default: any; title: string; hint?: string; options?: string[] };

/** Настройки планирования с наследованием: система → рабочий стол → проект → группа. */
export default function PlanningSettingsPanel({
  projectId,
  groupId,
}: {
  projectId?: string | null;
  groupId?: string | null;
}) {
  const [params, setParams] = useState<Param[]>([]);
  const [values, setValues] = useState<Record<string, { value: any; source: string }>>({});
  // Если панель открыта из проекта — сразу уровень «Проект» (политика плана живёт в проекте).
  const [scope, setScope] = useState<'workspace' | 'project' | 'group' | 'pool'>(projectId ? 'project' : 'workspace');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [projects, setProjects] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [curProject, setCurProject] = useState<string>(projectId || '');
  const [curGroup, setCurGroup] = useState<string>(groupId || '');
  const [pools, setPools] = useState<any[]>([]);
  const [curPool, setCurPool] = useState<string>('');

  const scopeId = scope === 'project' ? (curProject || null) : scope === 'group' ? (curGroup || null) : scope === 'pool' ? (curPool || null) : null;

  useEffect(() => {
    (async () => {
      try {
        const r = await af('/projects');
        setProjects(r.items || r || []);
      } catch { /* ignore */ }
    })();
    // eslint-disable-next-line
  }, []);

  useEffect(() => {
    if (!curProject) { setPools([]); return; }
    (async () => {
      try {
        const r = await af(`/projects/${curProject}/pools`);
        setPools(r.items || r || []);
      } catch { setPools([]); }
    })();
    // eslint-disable-next-line
  }, [curProject]);

  useEffect(() => {
    if (!curProject) { setGroups([]); return; }
    (async () => {
      try {
        const r = await af(`/projects/${curProject}/groups`);
        setGroups(r.items || r || []);
      } catch { setGroups([]); }
    })();
    // eslint-disable-next-line
  }, [curProject]);

  const af = async (path: string, opts?: RequestInit) => {
    const tok = typeof window !== 'undefined' ? localStorage.getItem('profyplan_token') : null;
    const h: Record<string, string> = { 'Content-Type': 'application/json', ...((opts?.headers as any) || {}) };
    if (tok) h['Authorization'] = 'Bea' + 'rer ' + tok;
    const r = await fetch(`${API}${path}`, { ...opts, headers: h });
    if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
    if (r.status === 204) return undefined as any;
    return r.json();
  };

  const load = useCallback(async () => {
    try {
      const q = [] as string[];
      const pid = projectId || curProject;
      if (pid) q.push('project_id=' + pid);
      const gid = groupId || curGroup;
      if (gid) q.push('group_id=' + gid);
      // Кластер — расчётный уровень: без него значения уровня «Кластер»
      // не подхватывались при чтении (запись уходила, а чтение брало проект/систему).
      if (scope === 'pool' && curPool) q.push('pool_id=' + curPool);
      const r = await af('/planning-settings' + (q.length ? '?' + q.join('&') : ''));
      setParams(r.params || []);
      setValues(r.values || {});
      setMsg(null);
    } catch (e: any) { setMsg(String(e.message || e)); }
  }, [projectId, groupId, curProject, curGroup, scope, curPool]);

  useEffect(() => { load(); }, [load]);

  const save = async (patch: Record<string, any>) => {
    if (scope !== 'workspace' && !scopeId) { setMsg('Для этого уровня нужен выбранный проект, группа или кластер'); return; }
    setBusy(true);
    try {
      await af('/planning-settings', {
        method: 'PUT',
        body: JSON.stringify({ scope, scope_id: scopeId, settings: patch }),
      });
      await load();
      setMsg('Сохранено');
    } catch (e: any) { setMsg(String(e.message || e)); }
    setBusy(false);
  };

  const promote = async () => {
    if (!scopeId) { setMsg('Выберите проект, группу или кластер'); return; }
    setBusy(true);
    try {
      const r = await af('/planning-settings', {
        method: 'PUT',
        body: JSON.stringify({ scope, scope_id: scopeId, settings: { __promote_to_workspace__: true } }),
      });
      await load();
      setMsg('Значения перенесены на рабочий стол: ' + (r.promoted ?? 0));
    } catch (e: any) { setMsg(String(e.message || e)); }
    setBusy(false);
  };

  const resetScope = async () => {
    setBusy(true);
    try {
      const q = ['scope=' + scope];
      if (scopeId) q.push('scope_id=' + scopeId);
      await af('/planning-settings?' + q.join('&'), { method: 'DELETE' });
      await load();
      setMsg('Уровень сброшен к наследованию');
    } catch (e: any) { setMsg(String(e.message || e)); }
    setBusy(false);
  };

  // Полный сброс: снимает переопределения всех уровней — настройки возвращаются к заводским.
  const resetDefaults = async () => {
    if (typeof window !== 'undefined' && !window.confirm(
      'Сбросить все настройки планирования к значениям по умолчанию?\n\nБудут сняты переопределения всех уровней: рабочий стол, проекты и группы.')) return;
    setBusy(true);
    try {
      const r = await af('/planning-settings/reset-defaults', { method: 'POST' });
      await load();
      setMsg('Настройки сброшены к значениям по умолчанию — снято переопределений: ' + (r.removed ?? 0));
    } catch (e: any) { setMsg(String(e.message || e)); }
    setBusy(false);
  };

  const paramGroups = Array.from(new Set(params.map(p => p.group)));
  const isOverride = (key: string) => values[key]?.source === scope;

  const control = (p: Param) => {
    const v = values[p.key]?.value;
    const common = { background: '#0A1628', border: '1px solid #1E3252', color: '#E8EEF5', borderRadius: 6, padding: '4px 8px', fontSize: 12.5, fontFamily: 'inherit' } as const;
    if (p.type === 'bool') {
      return <input type="checkbox" checked={!!v} disabled={busy} onChange={(e) => save({ [p.key]: e.target.checked })} style={{ accentColor: '#3B82F6' }} />;
    }
    if (p.type === 'enum') {
      return (
        <select value={v ?? ''} disabled={busy} onChange={(e) => save({ [p.key]: e.target.value })} style={common as any}>
          {(p.options || []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }
    return (
      <input type="number" value={v ?? ''} disabled={busy} onChange={(e) => save({ [p.key]: e.target.value === '' ? null : Number(e.target.value) })} style={{ ...(common as any), width: 110 }} />
    );
  };

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="panel-hdr"><span className="panel-title">⚙️ Планирование и расчёт</span></div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: '#8FA3BD' }}>Уровень настроек:</span>
        {([['workspace', 'Рабочий стол'], ['project', 'Проект'], ['group', 'Группа'], ['pool', 'Кластер']] as const).map(([k, label]) => (
          <button key={k} type="button" disabled={busy}
            onClick={() => setScope(k as any)}
            title={k === 'workspace' ? 'Значения по умолчанию для всех проектов' : k === 'project' ? 'Переопределения для выбранного проекта' : k === 'group' ? 'Переопределения для выбранной группы' : 'Правила конкуренции за ресурс для выбранного кластера'}
            style={{
              border: '1px solid ' + (scope === k ? 'rgba(59,130,246,.6)' : '#1E3252'),
              background: scope === k ? 'rgba(59,130,246,.14)' : '#0A1628',
              color: scope === k ? '#fff' : '#8FA3BD', borderRadius: 8, padding: '5px 12px', fontSize: 12.5, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
            }}>{label}</button>
        ))}
        {scope !== 'workspace' && (
          <select value={curProject} disabled={busy || !!projectId} onChange={(e) => { setCurProject(e.target.value); setCurGroup(''); }}
            title="Проект, для которого задаются переопределения"
            style={{ background: '#0A1628', border: '1px solid #1E3252', color: '#E8EEF5', borderRadius: 6, padding: '5px 8px', fontSize: 12.5, fontFamily: 'inherit' }}>
            <option value="">— выберите проект —</option>
            {projects.map(pr => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
          </select>
        )}
        {scope === 'group' && curProject && (
          <select value={curGroup} disabled={busy || !!groupId} onChange={(e) => setCurGroup(e.target.value)}
            title="Группа заказов, для которой задаются переопределения"
            style={{ background: '#0A1628', border: '1px solid #1E3252', color: '#E8EEF5', borderRadius: 6, padding: '5px 8px', fontSize: 12.5, fontFamily: 'inherit' }}>
            <option value="">— выберите группу —</option>
            {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        )}
        {scope === 'pool' && (
          <select value={curPool} disabled={busy} onChange={(e) => setCurPool(e.target.value)}
            title="Кластер (расчётное объединение заказов), для которого задаются правила конкуренции за ресурс"
            style={{ background: '#0A1628', border: '1px solid #1E3252', color: '#E8EEF5', borderRadius: 6, padding: '5px 8px', fontSize: 12.5, fontFamily: 'inherit' }}>
            <option value="">— выберите кластер —</option>
            {pools.map(pl => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
          </select>
        )}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button type="button" onClick={promote} disabled={busy || scope === 'workspace'}
            title="Перенести значения текущего уровня в настройки рабочего стола"
            style={{ background: 'rgba(34,197,94,.12)', border: '1px solid rgba(34,197,94,.4)', color: '#86EFAC', borderRadius: 8, padding: '5px 12px', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit', opacity: scope === 'workspace' ? .45 : 1 }}>
            Сделать значениями по умолчанию
          </button>
          <button type="button" onClick={resetScope} disabled={busy}
            title="Убрать все переопределения этого уровня"
            style={{ background: 'transparent', border: '1px solid #1E3A5F', color: '#8FA3BD', borderRadius: 8, padding: '5px 12px', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>
            Сбросить уровень
          </button>
          <button type="button" onClick={resetDefaults} disabled={busy}
            title="Вернуть все настройки планирования к заводским значениям: снимает переопределения рабочего стола, проектов, групп и кластеров"
            style={{ background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.35)', color: '#FCA5A5', borderRadius: 8, padding: '5px 12px', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>
            ↺ Настройки по умолчанию
          </button>
        </span>
      </div>
      <div style={{ fontSize: 12, color: '#5A7090', lineHeight: 1.5, marginBottom: 12 }}>
        Значения наследуются: <b>система → рабочий стол → проект → группа → кластер</b>. Изменение параметра создаёт переопределение на выбранном уровне; кнопка «вернуть» снимает его. В скобках указано, откуда взято текущее значение. Политику плана задают на уровне «Проект», правила конкуренции за ресурс — на уровне «Кластер».
      </div>
      {msg && <div style={{ fontSize: 12, color: msg === 'Сохранено' ? '#86EFAC' : '#FCD34D', marginBottom: 8 }}>{msg}</div>}

      {paramGroups.map(g => (
        <div key={g} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: '#93C5FD', marginBottom: 6 }}>{g}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {params.filter(p => p.group === g).map(p => {
              const cur = values[p.key] || { value: p.default, source: 'system' };
              return (
                <div key={p.key} style={{ display: 'flex', gap: 10, alignItems: 'center', background: '#0A1628', border: '1px solid #1E3252', borderRadius: 8, padding: '7px 10px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, color: '#E8EEF5' }} title={p.hint || p.title}>{p.title}</div>
                    <div style={{ fontSize: 11, color: SOURCE_COLOR[cur.source] || '#5A7090' }}>
                      {isOverride(p.key) ? 'своё для ' + SOURCE_LABEL[scope] : 'унаследовано: ' + (SOURCE_LABEL[cur.source] || cur.source)}
                    </div>
                  </div>
                  {control(p)}
                  <button type="button" disabled={busy || !isOverride(p.key)} onClick={() => save({ [p.key]: null })}
                    title="Вернуть к наследованию"
                    style={{ background: 'transparent', border: '1px solid #1E3A5F', color: isOverride(p.key) ? '#8FA3BD' : '#2E4A6B', borderRadius: 6, width: 26, height: 26, cursor: isOverride(p.key) ? 'pointer' : 'default', fontFamily: 'inherit', opacity: isOverride(p.key) ? 1 : .4 }}>
                    ↺
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
