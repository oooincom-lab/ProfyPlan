'use client';
// Комплекс (C v1.1): межпроектные связи и сквозной CPM по ВСЕЙ ветке (поддереву проектов).
import { useEffect, useMemo, useState } from 'react';

type Api = (path: string, opts?: any) => Promise<any>;

const card: any = { background: 'var(--bg-2, #0D1F3A)', border: '1px solid var(--border, #1E3252)', borderRadius: 10, padding: '12px 14px', marginBottom: 10 };
const inp: any = { background: '#0A1628', border: '1px solid #1E3252', borderRadius: 6, color: '#E8EEF5', padding: '6px 9px', fontSize: 12.5, fontFamily: 'inherit' };
const btn: any = { background: 'transparent', border: '1px solid #2A4060', color: '#8FA3BD', borderRadius: 8, padding: '6px 12px', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' };
const btnP: any = { ...btn, background: '#2563EB', border: 'none', color: '#fff', fontWeight: 600 };
const th: any = { textAlign: 'left', color: '#5A7090', fontWeight: 600, padding: '4px 8px', borderBottom: '1px solid #16294A', fontSize: 11.5 };
const td: any = { padding: '5px 8px', borderBottom: '1px solid #16294A', fontSize: 12, color: '#E8EEF5' };
const H = 3600000;

export default function ComplexView({ api, projects, notify }: { api: Api; projects: any[]; notify: (m: string) => void }) {
  const active = (projects || []).filter((p: any) => p.status !== 'archived');
  const byId = useMemo(() => new Map((projects || []).map((p: any) => [p.id, p])), [projects]);
  const children = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const p of (projects || []) as any[]) {
      if (p.parent_id) (m[p.parent_id] || (m[p.parent_id] = [])).push(p.id);
    }
    return m;
  }, [projects]);

  const subtree = (rootId: string): string[] => {
    const out: string[] = [];
    const stack = [rootId];
    const seen = new Set<string>();
    while (stack.length) {
      const cur = stack.pop() as string;
      if (seen.has(cur)) continue;
      seen.add(cur);
      out.push(cur);
      for (const ch of (children[cur] || [])) stack.push(ch);
    }
    return out;
  };

  const [scopeId, setScopeId] = useState('');
  useEffect(() => {
    if (!scopeId && active.length) {
      const withKids = active.find((p: any) => (children[p.id] || []).length > 0);
      setScopeId((withKids || active[0]).id);
    }
    /* eslint-disable-next-line */
  }, [projects]);

  const scopeProjects = useMemo(() => {
    if (!scopeId) return [];
    return subtree(scopeId).map((id) => byId.get(id)).filter(Boolean) as any[];
    /* eslint-disable-next-line */
  }, [scopeId, projects, children]);
  const scopeIds = scopeProjects.map((p: any) => p.id);

  // ручная пара для создания связи
  const [aId, setAId] = useState('');
  const [bId, setBId] = useState('');
  useEffect(() => {
    if (!scopeIds.length) return;
    if (!aId || !scopeIds.includes(aId)) setAId(scopeIds[0]);
    if (!bId || !scopeIds.includes(bId)) setBId(scopeIds[1] || scopeIds[0]);
    /* eslint-disable-next-line */
  }, [scopeId, projects]);

  const [opsA, setOpsA] = useState<any[]>([]);
  const [opsB, setOpsB] = useState<any[]>([]);
  const [links, setLinks] = useState<any[]>([]);
  const [src, setSrc] = useState('');
  const [tgt, setTgt] = useState('');
  const [dtype, setDtype] = useState('FS');
  const [lag, setLag] = useState('0');
  const [res, setRes] = useState<any>(null);
  const [sugg, setSugg] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!aId) return;
    api(`/projects/${aId}/operations`).then((r: any) => setOpsA(Array.isArray(r) ? r : (r?.items || []))).catch(() => setOpsA([]));
    /* eslint-disable-next-line */
  }, [aId]);
  useEffect(() => {
    if (!bId) return;
    api(`/projects/${bId}/operations`).then((r: any) => setOpsB(Array.isArray(r) ? r : (r?.items || []))).catch(() => setOpsB([]));
    /* eslint-disable-next-line */
  }, [bId]);

  const loadLinks = async () => {
    if (!scopeId) return;
    try {
      const r = await api(`/ccm/inter-deps?root_id=${scopeId}`);
      setLinks(r?.items || []);
    } catch { setLinks([]); }
  };
  /* eslint-disable-next-line */
  useEffect(() => { void loadLinks(); }, [scopeId]);

  const pname = (id: string) => (byId.get(id)?.name || '—');

  const calc = async () => {
    if (scopeIds.length < 2) { notify('В ветке должен быть хотя бы один проект с операциями'); return; }
    setBusy(true);
    try {
      const r = await api('/ccm/merge', { method: 'POST', body: JSON.stringify(scopeIds) });
      setRes(r);
      notify(`Расчёт комплекса: ${r.total_duration} ч, операций ${r.node_count}, критических ${r.critical_count}`);
    } catch (e: any) { notify('Ошибка расчёта: ' + (e?.message || e)); }
    setBusy(false);
  };

  const suggest = async () => {
    if (!scopeIds.length) { notify('Выберите ветку'); return; }
    setBusy(true); setSugg(null);
    try {
      const packs = await Promise.all(scopeIds.map(async (pid: string) => {
        const [sch, resm] = await Promise.all([
          api(`/projects/${pid}/calculate/schedule`, { method: 'POST', body: JSON.stringify({}) }).catch(() => null),
          api(`/projects/${pid}/operations/resources-map`).catch(() => []),
        ]);
        return { pid, sch, resm };
      }));
      const nodes: any[] = [];
      for (const pack of packs) {
        const resMap = new Map<string, any[]>();
        for (const r of (Array.isArray(pack.resm) ? pack.resm : (pack.resm?.items || []))) {
          if (!r.resource_id) continue;
          const arr = resMap.get(r.operation_id) || [];
          if (!arr.some((x: any) => x.id === r.resource_id)) arr.push({ id: r.resource_id, name: r.resource_name || 'ресурс' });
          resMap.set(r.operation_id, arr);
        }
        for (const n of (pack.sch?.nodes || [])) {
          if (!n.start_datetime || !n.finish_datetime) continue;
          nodes.push({ ...n, projectId: pack.pid, resources: resMap.get(n.id) || [] });
        }
      }
      const out: any[] = [];
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const na = nodes[i], nb = nodes[j];
          if (na.projectId === nb.projectId) continue;
          const common = (na.resources || []).filter((x: any) => (nb.resources || []).some((y: any) => y.id === x.id));
          if (!common.length) continue;
          const A0 = Date.parse(na.start_datetime), A1 = Date.parse(na.finish_datetime);
          const B0 = Date.parse(nb.start_datetime), B1 = Date.parse(nb.finish_datetime);
          if ([A0, A1, B0, B1].some((x) => isNaN(x))) continue;
          const overlap = Math.min(A1, B1) - Math.max(A0, B0);
          let reason = '', lagH = 0, prio = 9;
          if (overlap > 0) {
            reason = `пересечение по ресурсу «${common[0].name}» — ${(overlap / H).toFixed(1)} ч`;
            prio = 1;
          } else {
            const gap = A1 <= B0 ? B0 - A1 : A0 - B1;
            if (gap <= 24 * H) {
              lagH = +(gap / H).toFixed(1);
              reason = `стык по ресурсу «${common[0].name}» — ${lagH} ч`;
              prio = 2;
            } else continue;
          }
          const aFirst = A0 <= B0;
          out.push({
            srcProject: aFirst ? na.projectId : nb.projectId,
            srcOp: aFirst ? na.id : nb.id,
            srcName: aFirst ? na.name : nb.name,
            tgtProject: aFirst ? nb.projectId : na.projectId,
            tgtOp: aFirst ? nb.id : na.id,
            tgtName: aFirst ? nb.name : na.name,
            reason, lag: lagH, prio,
          });
          if (out.length >= 30) break;
        }
        if (out.length >= 30) break;
      }
      const seen = new Set<string>();
      const uniq = out.filter((x) => { const k = x.srcOp + '>' + x.tgtOp; if (seen.has(k)) return false; seen.add(k); return true; }).sort((x, y) => x.prio - y.prio);
      setSugg(uniq);
      notify(uniq.length ? `Найдено предложений: ${uniq.length}` : 'Совпадений по общим ресурсам не найдено');
    } catch (e: any) { notify('Не удалось подобрать связи: ' + (e?.message || e)); }
    setBusy(false);
  };

  const flipSugg = (i: number) => {
    setSugg((prev) => (prev || []).map((s, k) => k === i ? {
      ...s,
      srcProject: s.tgtProject, srcOp: s.tgtOp, srcName: s.tgtName,
      tgtProject: s.srcProject, tgtOp: s.srcOp, tgtName: s.srcName,
    } : s));
  };

  const applySugg = async (s: any) => {
    try {
      await api('/ccm/inter-deps', {
        method: 'POST',
        body: JSON.stringify({ source_project_id: s.srcProject, source_operation_id: s.srcOp, target_project_id: s.tgtProject, target_operation_id: s.tgtOp, dependency_type: 'FS', lag_hours: s.lag || 0 }),
      });
      notify('Связь создана: ' + s.srcName + ' → ' + s.tgtName);
      setSugg((prev) => (prev || []).filter((x) => x !== s));
      await loadLinks();
    } catch (e: any) { notify('Ошибка: ' + (e?.message || e)); }
  };

  const createManual = async () => {
    if (!aId || !bId || !src || !tgt) { notify('Выберите проекты и операции'); return; }
    setBusy(true);
    try {
      await api('/ccm/inter-deps', {
        method: 'POST',
        body: JSON.stringify({ source_project_id: aId, source_operation_id: src, target_project_id: bId, target_operation_id: tgt, dependency_type: dtype, lag_hours: Number(lag) || 0 }),
      });
      notify('Связь создана');
      setSrc(''); setTgt('');
      await loadLinks();
    } catch (e: any) { notify('Ошибка создания связи: ' + (e?.message || e)); }
    setBusy(false);
  };

  const del = async (id: string) => {
    try { await api(`/ccm/inter-deps/${id}`, { method: 'DELETE' }); notify('Связь удалена'); await loadLinks(); }
    catch (e: any) { notify('Ошибка удаления: ' + (e?.message || e)); }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 16, fontWeight: 700 }}>🧩 Комплекс (C v1.1)</span>
        <span style={{ fontSize: 11.5, color: '#5A7090' }}>весь комплекс: расчёт и связи по всем проектам выбранной ветки</span>
      </div>

      <div style={{ ...card, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: '#8FA3BD' }}>Ветка (корень)</span>
        <select style={inp} value={scopeId} onChange={(e) => { setScopeId(e.target.value); setRes(null); setSugg(null); }}>
          {active.map((p: any) => (<option key={p.id} value={p.id}>{p.name}</option>))}
        </select>
        <span style={{ fontSize: 11.5, color: '#5A7090' }}>проектов в ветке: {scopeProjects.length}</span>
        <button style={btn} disabled={busy} onClick={() => void suggest()}>🔎 Подобрать связи</button>
        <button style={btnP} disabled={busy} onClick={() => void calc()}>Рассчитать комплекс</button>
      </div>

      {res && (
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#B0C4DE', marginBottom: 6 }}>
            Результат расчёта: {res.total_duration} ч · операций {res.node_count} · критических {res.critical_count}
          </div>
          <div style={{ fontSize: 11.5, color: '#5A7090', marginBottom: 8 }}>Часы от нуля комплекса; проектные планы не изменяются.</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Проект</th><th style={th}>Операция</th><th style={th}>ES</th><th style={th}>EF</th><th style={th}>Резерв</th><th style={th}>Крит.</th></tr></thead>
            <tbody>
              {(res.nodes || []).slice().sort((a: any, b: any) => a.early_start - b.early_start).map((n: any) => (
                <tr key={n.id} style={{ background: n.is_critical ? 'rgba(248,113,113,.06)' : 'transparent' }}>
                  <td style={td}>{pname(n.project_id)}</td>
                  <td style={td}>{n.name}</td>
                  <td style={td}>{n.early_start}</td>
                  <td style={td}>{n.early_finish}</td>
                  <td style={td}>{n.total_float}</td>
                  <td style={{ ...td, color: n.is_critical ? '#F87171' : '#5A7090', fontWeight: 600 }}>{n.is_critical ? '●' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sugg && (
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#B0C4DE', marginBottom: 6 }}>Предложения по связям (по всей ветке)</div>
          <div style={{ fontSize: 11.5, color: '#5A7090', marginBottom: 8 }}>Анализ общих ресурсов и интервалов в текущих планах всех проектов ветки. Направление меняется кнопкой ⇄, принять — «Связать».</div>
          {sugg.length === 0 && <div style={{ fontSize: 12, color: '#5A7090' }}>Ничего не найдено.</div>}
          {sugg.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Источник</th><th style={th}>Приёмник</th><th style={th}>Причина</th><th style={th}></th></tr></thead>
              <tbody>
                {sugg.map((s: any, i: number) => (
                  <tr key={s.srcOp + '>' + s.tgtOp}>
                    <td style={td}>{pname(s.srcProject)} · {s.srcName}</td>
                    <td style={td}>{pname(s.tgtProject)} · {s.tgtName}</td>
                    <td style={{ ...td, color: '#8FA3BD' }}>{s.reason}{s.lag ? ` (лаг ${s.lag} ч)` : ''}</td>
                    <td style={td}>
                      <button style={btn} onClick={() => flipSugg(i)} title="Поменять направление">⇄</button>{' '}
                      <button style={btnP} onClick={() => void applySugg(s)}>Связать</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#B0C4DE', marginBottom: 8 }}>Связи в ветке</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
          <select style={inp} value={aId} onChange={(e) => setAId(e.target.value)}>
            {scopeProjects.map((p: any) => (<option key={p.id} value={p.id}>{p.name} (A)</option>))}
          </select>
          <select style={inp} value={src} onChange={(e) => setSrc(e.target.value)}>
            <option value="">операция-источник…</option>
            {opsA.map((o: any) => (<option key={o.id} value={o.id}>{o.name}</option>))}
          </select>
          <span style={{ color: '#5A7090' }}>→</span>
          <select style={inp} value={bId} onChange={(e) => setBId(e.target.value)}>
            {scopeProjects.map((p: any) => (<option key={p.id} value={p.id}>{p.name} (B)</option>))}
          </select>
          <select style={inp} value={tgt} onChange={(e) => setTgt(e.target.value)}>
            <option value="">операция-приёмник…</option>
            {opsB.map((o: any) => (<option key={o.id} value={o.id}>{o.name}</option>))}
          </select>
          <select style={inp} value={dtype} onChange={(e) => setDtype(e.target.value)}>
            <option value="FS">FS</option><option value="SS">SS</option><option value="FF">FF</option>
          </select>
          <input style={{ ...inp, width: 64 }} value={lag} onChange={(e) => setLag(e.target.value)} title="Лаг, часы" />
          <button style={btnP} disabled={busy} onClick={() => void createManual()}>＋ Связь</button>
        </div>
        {links.length === 0 && <div style={{ fontSize: 12, color: '#5A7090' }}>Связей в этой ветке нет.</div>}
        {links.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Источник</th><th style={th}>Тип</th><th style={th}>Приёмник</th><th style={th}>Лаг, ч</th><th style={th}></th></tr></thead>
            <tbody>
              {links.map((d: any) => (
                <tr key={d.id}>
                  <td style={td}>{pname(d.source_project_id)} · {d.source_operation_id ? 'операция' : '—'}</td>
                  <td style={td}>{d.dependency_type}</td>
                  <td style={td}>{pname(d.target_project_id)} · {d.target_operation_id ? 'операция' : '—'}</td>
                  <td style={td}>{d.lag_hours}</td>
                  <td style={td}><button style={btn} onClick={() => void del(d.id)}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
