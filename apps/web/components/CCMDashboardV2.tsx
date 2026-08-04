/**
 * CCM V2 Dashboard — План (Baseline) + Динамика (Actual).  
 * Две версии графа: предварительный расчёт и рабочий с фактом.
 */
'use client';

import { useState, useEffect, useCallback } from 'react';
import NetworkGraphV2 from '@/components/NetworkGraphV2';
import { login, isAuthenticated, getProjects, mergeProjects, resourceLeveling, createBaseline } from '@/lib/api';

type Tab = 'network-graph';

export default function CCMV2Dashboard() {
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>('network-graph');
  const [ccmResult, setCcmResult] = useState<any>(null);
  const [levelResult, setLevelResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showBaseline, setShowBaseline] = useState(false);
  const [baselineNodes, setBaselineNodes] = useState<any>(null);
  const [authed, setAuthed] = useState(false);
  const [loginEmail, setLoginEmail] = useState('planner@demo.ru');
  const [loginPass, setLoginPass] = useState('demo123');
  const [loginErr, setLoginErr] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthenticated()) {
      setAuthed(true);
    }
  }, []);

  useEffect(() => {
    if (authed) {
      getProjects().then((res: any) => setProjects(res.items || res || [])).catch(() => {});
    }
  }, [authed]);

  const toggleProject = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const runMerge = useCallback(async () => {
    if (selectedIds.length === 0) {
      setError('Выберите хотя бы один проект');
      return;
    }
    setLoading(true); setError(null);
    try {
      const result = await mergeProjects(selectedIds);
      setCcmResult(result);
      if (selectedIds.length === 1) {
        try {
          const lr = await resourceLeveling(selectedIds[0], false);
          setLevelResult(lr);
        } catch {}
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [selectedIds]);

  const approveBaseline = useCallback(async () => {
    if (selectedIds.length === 0) return;
    setLoading(true);
    try {
      // Save current graph as baseline
      if (ccmResult) {
        setBaselineNodes(ccmResult.nodes.map((n: any) => ({ ...n })));
      }
      for (const pid of selectedIds) {
        await createBaseline(pid, `Baseline ${new Date().toLocaleDateString('ru')}`);
      }
      alert('Baseline утверждён!');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [selectedIds, ccmResult]);

  const handleLogin = async () => {
    setLoginErr(null);
    try {
      await login(loginEmail, loginPass);
      setAuthed(true);
    } catch (e: any) {
      setLoginErr(e.message);
    }
  };

  // --- Login screen
  if (!authed) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: '#0A1628', fontFamily: 'Inter, sans-serif',
      }}>
        <div style={{
          background: '#0F1E36', padding: '32px 40px', borderRadius: 12,
          border: '1px solid #1E3252', width: 360,
        }}>
          <h2 style={{ color: '#E8EEF5', fontSize: 18, margin: '0 0 4px' }}>ProfyPlan CCM V2</h2>
          <p style={{ color: '#5A7090', fontSize: 13, margin: '0 0 20px' }}>Войдите для работы с графом</p>
          <input
            value={loginEmail}
            onChange={e => setLoginEmail(e.target.value)}
            placeholder="Email"
            style={inputStyle}
          />
          <input
            type="password"
            value={loginPass}
            onChange={e => setLoginPass(e.target.value)}
            placeholder="Пароль"
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            style={{ ...inputStyle, marginTop: 8 }}
          />
          <button onClick={handleLogin} style={{
            width: '100%', marginTop: 16, padding: '10px', borderRadius: 8,
            border: 'none', background: '#3B82F6', color: '#fff',
            fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}>
            Войти
          </button>
          {loginErr && (
            <div style={{ marginTop: 10, color: '#EF4444', fontSize: 12 }}>{loginErr}</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100vh',
      background: '#0A1628', color: '#E8EEF5', fontFamily: 'Inter, sans-serif',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 20px', background: '#0F1E36',
        borderBottom: '1px solid #1E3252',
        display: 'flex', alignItems: 'center', gap: 20,
      }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>CCM V2 — Динамика</h2>

        {/* Project selector */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1 }}>
          {projects.map((p: any) => (
            <button
              key={p.id}
              onClick={() => toggleProject(p.id)}
              style={{
                padding: '5px 14px', borderRadius: 100,
                border: selectedIds.includes(p.id) ? '1px solid #3B82F6' : '1px solid #1E3252',
                background: selectedIds.includes(p.id) ? 'rgba(59,130,246,0.15)' : '#0A1628',
                color: selectedIds.includes(p.id) ? '#60A5FA' : '#8FA3BD',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {p.name}
            </button>
          ))}
        </div>

        {/* Actions */}
        <button onClick={runMerge} disabled={loading} style={{
          padding: '6px 16px', borderRadius: 6, border: 'none',
          background: selectedIds.length > 0 ? '#3B82F6' : '#162844',
          color: selectedIds.length > 0 ? '#fff' : '#5A7090',
          fontSize: 12, fontWeight: 600, cursor: selectedIds.length > 0 ? 'pointer' : 'default',
        }}>
          {loading ? 'Расчёт...' : 'Объединить'}
        </button>
        <button onClick={approveBaseline} disabled={loading || !ccmResult} style={{
          padding: '6px 16px', borderRadius: 6,
          background: ccmResult ? '#10B981' : '#162844',
          border: 'none', color: ccmResult ? '#fff' : '#5A7090',
          fontSize: 12, fontWeight: 600, cursor: ccmResult ? 'pointer' : 'default',
        }}>
          Утвердить Baseline
        </button>
        <button onClick={() => setShowBaseline(!showBaseline)} disabled={!baselineNodes} style={{
          padding: '6px 16px', borderRadius: 6,
          background: showBaseline ? '#F59E0B' : 'rgba(245,158,11,0.1)',
          border: '1px solid rgba(245,158,11,0.3)', color: showBaseline ? '#0A1628' : '#F59E0B',
          fontSize: 12, fontWeight: 600, cursor: baselineNodes ? 'pointer' : 'default',
        }}>
          {showBaseline ? 'Скрыть Baseline' : 'Сравнить с Baseline'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: '8px 20px', background: 'rgba(239,68,68,0.1)', color: '#EF4444', fontSize: 12 }}>
          {error}
          <button onClick={() => setError(null)} style={{ marginLeft: 12, background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer' }}>&times;</button>
        </div>
      )}

      {/* Graph */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <NetworkGraphV2
          cpmResult={ccmResult}
          levelResult={levelResult}
          baselineNodes={showBaseline ? baselineNodes : null}
          showBaseline={showBaseline}
        />
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 6,
  border: '1px solid #1E3252', background: '#0A1628',
  color: '#E8EEF5', fontSize: 14, outline: 'none',
  boxSizing: 'border-box',
};
