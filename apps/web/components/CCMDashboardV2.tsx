/**
 * CCM V2 Dashboard — План (Baseline) + Динамика (Actual).  
 * Две версии графа: предварительный расчёт и рабочий с фактом.
 */
'use client';

import { useState, useEffect, useCallback } from 'react';
import NetworkGraphV2 from '@/components/NetworkGraphV2';
import { getProjects, mergeProjects, resourceLeveling, createBaseline } from '@/lib/api';
import { runCPM } from '@/lib/api';

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

  useEffect(() => {
    getProjects().then(setProjects).catch(() => {});
  }, []);

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
