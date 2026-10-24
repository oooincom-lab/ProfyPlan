'use client';

import { useCallback, useEffect, useState } from 'react';

type Api = (path: string, opts?: any) => Promise<any>;

const card: any = { background: 'var(--bg-2, #0D1F3A)', border: '1px solid var(--border, #1E3252)', borderRadius: 10, padding: 14 };
const inp: any = { background: '#0A1628', border: '1px solid #1E3252', borderRadius: 6, color: '#E8EEF5', padding: '6px 9px', fontSize: 12, fontFamily: 'inherit' };
const btn: any = { background: 'rgba(59,130,246,.12)', border: '1px solid rgba(59,130,246,.45)', color: '#93C5FD', borderRadius: 6, padding: '6px 11px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' };

export default function OrgStructureView({ api }: { api: Api }) {
  const [levels, setLevels] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [levelName, setLevelName] = useState('');
  const [levelCode, setLevelCode] = useState('');
  const [empName, setEmpName] = useState('');
  const [empDept, setEmpDept] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [l, e, d] = await Promise.all([api('/org-levels'), api('/employees'), api('/departments')]);
      setLevels(l?.items || []);
      setEmployees(e?.items || []);
      setDepartments(d?.items || d || []);
    } catch (e: any) { setErr(e?.message || String(e)); }
  }, [api]);

  useEffect(() => { void load(); }, [load]);

  const addLevel = async () => {
    if (!levelName.trim() || !levelCode.trim()) return;
    try {
      await api('/org-levels', { method: 'POST', body: JSON.stringify({ code: levelCode.trim(), name: levelName.trim(), sort_order: levels.length, can_be_resource: true }) });
      setLevelName(''); setLevelCode(''); await load();
    } catch (e: any) { setErr(e?.message || String(e)); }
  };

  const addEmployee = async () => {
    if (!empName.trim()) return;
    try {
      await api('/employees', { method: 'POST', body: JSON.stringify({ name: empName.trim(), department_id: empDept || null }) });
      setEmpName(''); await load();
    } catch (e: any) { setErr(e?.message || String(e)); }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 14 }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>Оргструктура и сотрудники</div>
        <div style={{ fontSize: 12, color: '#5A7090' }}>Уровни настраиваются под ваш вид деятельности</div>
      </div>
      {err && <div style={{ color: '#F87171', fontSize: 12, marginBottom: 10 }}>{err}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div style={card}>
          <div style={{ fontWeight: 650, marginBottom: 8 }}>Уровни оргструктуры</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            <input style={inp} placeholder="Код (например, brigade)" value={levelCode} onChange={(e) => setLevelCode(e.target.value)} />
            <input style={inp} placeholder="Название (цех, бригада, отдел)" value={levelName} onChange={(e) => setLevelName(e.target.value)} />
            <button style={btn} onClick={() => void addLevel()}>+ Уровень</button>
          </div>
          {levels.map((l) => (
            <div key={l.id} style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: '1px solid #16294A', fontSize: 12 }}>
              <span style={{ color: '#93C5FD', minWidth: 110 }}>{l.code}</span>
              <span>{l.name}</span>
              {l.can_be_resource && <span style={{ marginLeft: 'auto', color: '#4ADE80', fontSize: 11 }}>может быть ресурсом</span>}
            </div>
          ))}
        </div>
        <div style={card}>
          <div style={{ fontWeight: 650, marginBottom: 8 }}>Сотрудники</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            <input style={inp} placeholder="ФИО" value={empName} onChange={(e) => setEmpName(e.target.value)} />
            <select style={inp} value={empDept} onChange={(e) => setEmpDept(e.target.value)}>
              <option value="">Без подразделения</option>
              {departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <button style={btn} onClick={() => void addEmployee()}>+ Сотрудник</button>
          </div>
          {employees.map((e) => (
            <div key={e.id} style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: '1px solid #16294A', fontSize: 12 }}>
              <span>{e.name}</span>
              <span style={{ marginLeft: 'auto', color: '#5A7090' }}>{departments.find((d: any) => d.id === e.department_id)?.name || 'без подразделения'}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ ...card, marginTop: 14, color: '#8FA3BD', fontSize: 12 }}>
        Ресурсный профиль включается у подразделения или сотрудника только там, где есть планируемая ёмкость. Названия уровней — цех, участок, бригада, команда, отдел — произвольные.
      </div>
    </div>
  );
}
