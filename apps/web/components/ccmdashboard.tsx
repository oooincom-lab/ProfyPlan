/**
 * CCM Dashboard — сводная страница Multi-Project планирования.
 * Сетевой график + Диаграмма Ганта + Загрузка ресурсов.
 */
'use client';

import { useState, useEffect } from 'react';
import GanttChart from './ganttchart';
import ResourceLoadChart from './resourceloadchart';
import NetworkGraph from './networkgraph';
import { getProjects, mergeProjects, resourceLeveling } from '@/lib/api';

type Tab = 'gantt' | 'network-graph' | 'resource-load';

export default function CCMDashboard() {
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>('gantt');
  const [ccmResult, setCcmResult] = useState<any>(null);
  const [levelResult, setLevelResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getProjects()
      .then(res => setProjects(res.items || []))
      .catch(() => {});
  }, []);

  const toggleProject = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const runMerge = async () => {
    if (selectedIds.length < 2) {
      setError('Выберите минимум 2 проекта');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await mergeProjects(selectedIds);
      setCcmResult(result);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const runLeveling = async () => {
    if (selectedIds.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const result = await resourceLeveling(selectedIds[0]);
      setLevelResult(result);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: 'gantt', label: 'Диаграмма Ганта' },
    { key: 'network-graph', label: 'Сетевой график' },
    { key: 'resource-load', label: 'Загрузка ресурсов' },
  ];

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--fg)' }}>
      {/* Top bar */}
      <header style={{
        padding: '12px 24px',
        background: 'var(--bg-2)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        flexWrap: 'wrap',
      }}>
        <h1 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>
          ProfyPlan CCM
        </h1>
        <span style={{
          fontSize: 10, fontFamily: 'IBM Plex Mono, monospace',
          background: 'rgba(59,130,246,0.12)', color: 'var(--accent-3)',
          border: '1px solid rgba(59,130,246,0.3)', borderRadius: 100,
          padding: '3px 10px',
        }}>
          Multi-Project
        </span>

        {/* Project selector */}
        <div style={{ display: 'flex', gap: 6, marginLeft: 8 }}>
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => toggleProject(p.id)}
              style={{
                padding: '4px 12px',
                borderRadius: 6,
                border: selectedIds.includes(p.id)
                  ? '1.5px solid var(--accent)'
                  : '1px solid var(--border)',
                background: selectedIds.includes(p.id)
                  ? 'rgba(59,130,246,0.15)'
                  : 'transparent',
                color: selectedIds.includes(p.id) ? 'var(--accent-3)' : 'var(--fg-3)',
                fontSize: 12,
                cursor: 'pointer',
                fontWeight: selectedIds.includes(p.id) ? 600 : 400,
              }}
            >
              {p.name || p.id?.slice(0, 8)}
            </button>
          ))}
        </div>

        {selectedIds.length >= 2 && (
          <button
            onClick={runMerge}
            disabled={loading}
            style={{
              padding: '6px 16px',
              borderRadius: 6,
              background: 'var(--accent)',
              color: '#fff',
              border: 'none',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              opacity: loading ? 0.5 : 1,
            }}
          >
            {loading ? 'Расчёт...' : 'Объединить и рассчитать CPM'}
          </button>
        )}

        {selectedIds.length === 1 && (
          <button
            onClick={runLeveling}
            disabled={loading}
            style={{
              padding: '6px 16px',
              borderRadius: 6,
              background: 'var(--success)',
              color: '#fff',
              border: 'none',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              opacity: loading ? 0.5 : 1,
            }}
          >
            Resource Leveling
          </button>
        )}
      </header>

      {/* Tabs */}
      <nav style={{
        display: 'flex', gap: 0,
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg)',
        padding: '0 24px',
      }}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '8px 18px',
              border: 'none',
              borderBottom: activeTab === tab.key
                ? '2px solid var(--accent)'
                : '2px solid transparent',
              background: 'transparent',
              color: activeTab === tab.key ? 'var(--fg)' : 'var(--fg-3)',
              fontSize: 13,
              fontWeight: activeTab === tab.key ? 600 : 400,
              cursor: 'pointer',
            }}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Error */}
      {error && (
        <div style={{
          margin: '12px 24px',
          padding: '8px 16px',
          borderRadius: 8,
          background: 'rgba(239,68,68,0.1)',
          border: '1px solid rgba(239,68,68,0.25)',
          color: '#EF4444',
          fontSize: 13,
        }}>
          {error}
          <button
            onClick={() => setError(null)}
            style={{
              marginLeft: 12, background: 'none', border: 'none',
              color: '#EF4444', cursor: 'pointer', fontSize: 13,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Stats bar — shown after merge */}
      {ccmResult && (
        <div style={{
          margin: '12px 24px',
          padding: '10px 18px',
          borderRadius: 8,
          background: 'var(--bg-2)',
          border: '1px solid var(--border)',
          display: 'flex', gap: 24, flexWrap: 'wrap',
          fontSize: 12, color: 'var(--fg-2)',
        }}>
          <span>
            <b style={{ color: 'var(--fg)' }}>{ccmResult.node_count}</b> операций
          </span>
          <span>
            <b style={{ color: 'var(--success)' }}>{ccmResult.critical_count}</b> на крит. пути
          </span>
          <span>
            Длительность: <b style={{ color: 'var(--fg)' }}>{ccmResult.total_duration} ч</b>
          </span>
          <span>
            Межпроектных связей: <b style={{ color: 'var(--accent-3)' }}>{ccmResult.inter_project_deps}</b>
          </span>
        </div>
      )}

      {/* Main content */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {activeTab === 'gantt' && (
          <div style={{ height: 'calc(100vh - 140px)', overflow: 'auto' }}>
            {selectedIds.length >= 2 ? (
              <GanttChart projectIds={selectedIds} />
            ) : (
              <div style={{
                padding: 48, textAlign: 'center', color: 'var(--fg-3)', fontSize: 14,
              }}>
                Выберите 2 или более проекта и нажмите «Объединить и рассчитать CPM»
              </div>
            )}
          </div>
        )}

        {activeTab === 'network-graph' && (
          <div style={{ height: 'calc(100vh - 140px)', overflow: 'hidden' }}>
            <NetworkGraph cpmResult={ccmResult} levelResult={levelResult} />
          </div>
        )}

        {activeTab === 'resource-load' && (
          <div style={{ padding: 24, overflow: 'auto' }}>
            {levelResult ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  <div style={{
                    padding: '10px 16px', borderRadius: 8,
                    background: 'var(--bg-3)', border: '1px solid var(--border)',
                    fontSize: 12,
                  }}>
                    Конфликтов разрешено:{' '}
                    <b style={{ color: 'var(--success)' }}>{levelResult.conflicts_resolved}</b>
                  </div>
                  <div style={{
                    padding: '10px 16px', borderRadius: 8,
                    background: 'var(--bg-3)', border: '1px solid var(--border)',
                    fontSize: 12,
                  }}>
                    Makespan:{' '}
                    <b>{levelResult.total_makespan_hours} ч</b>
                  </div>
                </div>
                <ResourceLoadChart
                  data={Object.entries(levelResult.resource_utilization || {}).map(
                    ([name, load]: [string, any]) => ({
                      resourceName: name,
                      loadPercent: Number(load),
                      utilizedHours: 0,
                      availableHours: 8,
                      queueOps: (levelResult.queue_lengths && levelResult.queue_lengths[name]) || 0,
                      isBottleneck: (levelResult.bottlenecks || []).includes(name),
                    })
                  )}
                />
                {levelResult.bottlenecks?.length > 0 && (
                  <div style={{
                    padding: '10px 16px', borderRadius: 8,
                    background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
                    fontSize: 12, color: '#EF4444',
                  }}>
                    ⚠ Узкие места: {levelResult.bottlenecks.join(', ')}
                  </div>
                )}
              </div>
            ) : (
              <div style={{
                padding: 48, textAlign: 'center', color: 'var(--fg-3)', fontSize: 14,
              }}>
                Выберите проект и нажмите «Resource Leveling» для анализа загрузки
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
