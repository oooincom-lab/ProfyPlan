/**
 * CPM page — планирование + динамика (факт).
 */
'use client';

import { useState, useEffect, useRef } from 'react';
import { getProjects, runCPM, login, logout } from '@/lib/api';

interface CPMNode {
  id: string; name: string; duration: number;
  early_start: number; early_finish: number;
  late_start: number; late_finish: number;
  total_float: number; free_float: number;
  is_critical: boolean; predecessors: string[];
}

type Mode = 'plan' | 'dynamic';

const LEFT_MARGIN = 140;
const NODE_H = 36;
const LANE_H = 56;
const NODE_R = 14;

export default function CPMPage() {
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nodes, setNodes] = useState<CPMNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('plan');
  const [needsLogin, setNeedsLogin] = useState(false);
  const [loginEmail, setLoginEmail] = useState('planner@demo.ru');
  const [loginPass, setLoginPass] = useState('demo123');
  const [loginErr, setLoginErr] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredNode, setHoveredNode] = useState<any>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // Try loading projects on mount — if fails, show login
  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      const res: any = await getProjects();
      const items = res.items || res || [];
      setProjects(Array.isArray(items) ? items : []);
      setNeedsLogin(false);
    } catch (e: any) {
      const msg = String(e.message || e || '');
      if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('Invalid')) {
        logout();
      }
      setNeedsLogin(true);
      setError(msg);
    }
  };

  const handleLogin = async () => {
    setLoginErr(null);
    try {
      await login(loginEmail, loginPass);
      setNeedsLogin(false);
      setError(null);
      await loadProjects();
    } catch (e: any) {
      setLoginErr(e.message);
    }
  };

  const handleSelect = async (pid: string) => {
    setSelectedId(pid);
    setLoading(true);
    setError(null);
    try {
      const result = await runCPM(pid);
      setNodes(result.nodes || []);
    } catch (e: any) {
      setError(e.message);
      if (String(e.message || '').includes('401')) {
        logout();
        setNeedsLogin(true);
      }
    } finally { setLoading(false); }
  };

  const layout = useRef<Record<string, { row: number; x: number; y: number }>>({});

  useEffect(() => {
    if (nodes.length === 0) return;
    const rowAssign: Record<string, number> = {};
    nodes.forEach((n, i) => {
      const preds = n.predecessors || [];
      if (preds.length === 0) { rowAssign[n.id] = i % 8; return; }
      let maxRow = -1;
      preds.forEach(pid => { if (rowAssign[pid] !== undefined) maxRow = Math.max(maxRow, rowAssign[pid]); });
      rowAssign[n.id] = maxRow >= 0 ? maxRow : i % 8;
    });
    const dur = Math.max(...nodes.map(n => n.early_finish), 1);
    const newLayout: Record<string, any> = {};
    nodes.forEach(n => {
      newLayout[n.id] = {
        row: rowAssign[n.id] || 0,
        x: LEFT_MARGIN + (n.early_start / dur) * (2000 - LEFT_MARGIN - 60),
        y: 60 + (rowAssign[n.id] || 0) * LANE_H,
      };
    });
    layout.current = newLayout;
  }, [nodes]);

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas || nodes.length === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const dur = Math.max(...nodes.map(n => n.early_finish), 1);
    const l = layout.current;

    // Edges
    nodes.forEach(n => {
      const fp = l[n.id];
      if (!fp) return;
      (n.predecessors || []).forEach(pid => {
        const tp = l[pid];
        if (!tp) return;
        const isCrit = n.is_critical && nodes.find(x => x.id === pid)?.is_critical;
        ctx.strokeStyle = isCrit ? '#F59E0B' : 'rgba(90,112,144,0.4)';
        ctx.lineWidth = isCrit ? 2.5 : 1;
        ctx.beginPath();
        ctx.moveTo(tp.x + 40, tp.y);
        ctx.lineTo(fp.x - 40, fp.y);
        ctx.stroke();
        const mx = fp.x - 40;
        ctx.fillStyle = isCrit ? '#F59E0B' : 'rgba(90,112,144,0.6)';
        ctx.beginPath();
        ctx.moveTo(mx, fp.y);
        ctx.lineTo(mx - 8, fp.y - 5);
        ctx.lineTo(mx - 8, fp.y + 5);
        ctx.closePath(); ctx.fill();
      });
    });

    // Grid
    ctx.strokeStyle = 'rgba(30,50,82,0.3)';
    ctx.lineWidth = 0.5;
    for (let t = 0; t <= dur; t += Math.max(1, Math.floor(dur / 20))) {
      const x = LEFT_MARGIN + (t / dur) * (2000 - LEFT_MARGIN - 60);
      ctx.beginPath(); ctx.moveTo(x, 20); ctx.lineTo(x, canvas.height / dpr - 10); ctx.stroke();
      ctx.fillStyle = '#5A7090'; ctx.font = '10px IBM Plex Mono'; ctx.textAlign = 'center';
      ctx.fillText(String(t), x, 16);
    }

    // Time axis
    ctx.fillStyle = '#5A7090'; ctx.font = '12px Inter';
    ctx.textAlign = 'right'; ctx.fillText('Часы →', 2000, 16);

    // Nodes
    nodes.forEach(n => {
      const p = l[n.id];
      if (!p) return;
      const { x, y } = p;
      const isHovered = hoveredNode?.id === n.id;

      const w = Math.max(80, Math.min(200, n.name.length * 7 + 24));
      ctx.fillStyle = isHovered
        ? (n.is_critical ? 'rgba(59,130,246,0.25)' : 'rgba(90,112,144,0.15)')
        : (n.is_critical ? 'rgba(59,130,246,0.12)' : 'rgba(90,112,144,0.06)');
      ctx.strokeStyle = n.is_critical ? '#3B82F6' : '#5A7090';
      ctx.lineWidth = n.is_critical ? 2 : 1;

      const rx = x - w / 2, ry = y - NODE_H / 2;
      ctx.beginPath();
      ctx.moveTo(rx + 6, ry); ctx.lineTo(rx + w - 6, ry);
      ctx.arcTo(rx + w, ry, rx + w, ry + 6, 6);
      ctx.lineTo(rx + w, ry + NODE_H - 6);
      ctx.arcTo(rx + w, ry + NODE_H, rx + w - 6, ry + NODE_H, 6);
      ctx.lineTo(rx + 6, ry + NODE_H);
      ctx.arcTo(rx, ry + NODE_H, rx, ry + NODE_H - 6, 6);
      ctx.lineTo(rx, ry + 6);
      ctx.arcTo(rx, ry, rx + 6, ry, 6);
      ctx.closePath();
      ctx.fill(); ctx.stroke();

      ctx.fillStyle = '#E8EEF5'; ctx.font = '11px Inter'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const label = n.name.length > 18 ? n.name.slice(0, 17) + '…' : n.name;
      ctx.fillText(label, x, y);
    });

    // Tooltip
    if (hoveredNode) {
      const np = l[hoveredNode.id];
      if (np) {
        const lines = [
          hoveredNode.name,
          'ES: ' + hoveredNode.early_start + '  EF: ' + hoveredNode.early_finish,
          'LS: ' + hoveredNode.late_start + '  LF: ' + hoveredNode.late_finish,
          'Float: ' + hoveredNode.total_float + 'h  ' + (hoveredNode.is_critical ? '⚡ Крит' : ''),
        ];
        const tw = Math.max(...lines.map(l => ctx.measureText(l).width)) + 20;
        const th = lines.length * 14 + 12;
        let tx = mousePos.x + 14, ty = mousePos.y - 10;
        if (tx + tw > rect.width) tx = mousePos.x - tw - 14;
        if (ty + th > rect.height) ty = mousePos.y - th - 10;
        ctx.fillStyle = 'rgba(15,30,54,0.95)';
        ctx.fillRect(tx, ty, tw, th);
        ctx.strokeStyle = 'rgba(59,130,246,0.4)'; ctx.lineWidth = 1;
        ctx.strokeRect(tx, ty, tw, th);
        ctx.fillStyle = '#E8EEF5'; ctx.font = '11px IBM Plex Mono'; ctx.textAlign = 'left';
        lines.forEach((line, i) => ctx.fillText(line, tx + 10, ty + 14 + i * 14));
      }
    }
  };

  useEffect(() => { requestAnimationFrame(draw); }, [nodes, hoveredNode, mode]);

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    setMousePos({ x, y });
    const l = layout.current;
    let found: any = null;
    for (const n of nodes) {
      const np = l[n.id]; if (!np) continue;
      if (Math.abs(x - np.x) < 60 && Math.abs(y - np.y) < NODE_H / 2 + 6) { found = n; break; }
    }
    if (found !== hoveredNode) setHoveredNode(found);
  };

  // Resize
  useEffect(() => {
    const c = containerRef.current; if (!c) return;
    const ro = new ResizeObserver(() => nodes.length > 0 && requestAnimationFrame(draw));
    ro.observe(c); return () => ro.disconnect();
  }, [nodes.length]);

  // Login form
  if (needsLogin) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0A1628' }}>
        <div style={{ background: '#0F1E36', padding: '32px 40px', borderRadius: 12, border: '1px solid #1E3252', width: 360 }}>
          <h2 style={{ color: '#E8EEF5', fontSize: 18, margin: '0 0 4px' }}>ProfyPlan CPM</h2>
          <p style={{ color: '#5A7090', fontSize: 13, margin: '0 0 20px' }}>Войдите для расчёта графа</p>
          <input value={loginEmail} onChange={e => setLoginEmail(e.target.value)} placeholder="Email"
            style={{ width: '100%', padding: '10px 12px', borderRadius: 6, border: '1px solid #1E3252', background: '#0A1628', color: '#E8EEF5', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
          <input type="password" value={loginPass} onChange={e => setLoginPass(e.target.value)} placeholder="Пароль"
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            style={{ width: '100%', padding: '10px 12px', borderRadius: 6, border: '1px solid #1E3252', background: '#0A1628', color: '#E8EEF5', fontSize: 14, outline: 'none', boxSizing: 'border-box', marginTop: 8 }} />
          <button onClick={handleLogin} style={{ width: '100%', marginTop: 16, padding: '10px', borderRadius: 8, border: 'none', background: '#3B82F6', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Войти</button>
          {loginErr && <div style={{ marginTop: 10, color: '#EF4444', fontSize: 12 }}>{loginErr}</div>}
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0A1628', color: '#E8EEF5', fontFamily: 'Inter, sans-serif', display: 'flex', flexDirection: 'column' }}>
      <header style={{ padding: '12px 24px', background: '#0F1E36', borderBottom: '1px solid #1E3252', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>ProfyPlan CPM</h1>

        <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid #1E3252' }}>
          {(['plan', 'dynamic'] as Mode[]).map(m => (
            <button key={m} onClick={() => setMode(m)}
              style={{ padding: '5px 14px', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                background: mode === m ? '#3B82F6' : 'transparent', color: mode === m ? '#fff' : '#8FA3BD' }}>
              {m === 'plan' ? 'План' : 'Динамика'}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 6, marginLeft: 8 }}>
          {projects.map(p => (
            <button key={p.id} onClick={() => handleSelect(p.id)} disabled={loading}
              style={{ padding: '5px 14px', borderRadius: 6, border: selectedId === p.id ? '1.5px solid #3B82F6' : '1px solid #1E3252',
                background: selectedId === p.id ? 'rgba(59,130,246,0.15)' : 'transparent', color: selectedId === p.id ? '#60A5FA' : '#8FA3BD',
                fontSize: 12, cursor: 'pointer', fontWeight: selectedId === p.id ? 600 : 400, opacity: loading ? 0.5 : 1 }}>
              {p.name || p.id?.slice(0, 8)}
            </button>
          ))}
          {projects.length === 0 && <span style={{ color: '#5A7090', fontSize: 12 }}>Нет проектов</span>}
        </div>

        {loading && <span style={{ color: '#60A5FA', fontSize: 12 }}>Расчёт...</span>}
      </header>

      {error && (
        <div style={{ margin: '12px 24px', padding: '8px 16px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#EF4444', fontSize: 13 }}>
          {error} <button onClick={() => setError(null)} style={{ marginLeft: 12, background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer' }}>✕</button>
        </div>
      )}

      {nodes.length > 0 && (
        <div style={{ margin: '12px 24px', padding: '10px 18px', borderRadius: 8, background: '#0F1E36', border: '1px solid #1E3252', display: 'flex', gap: 24, fontSize: 12, color: '#B0C4DE' }}>
          <span><b style={{ color: '#E8EEF5' }}>{nodes.length}</b> операций</span>
          <span><b style={{ color: '#10B981' }}>{nodes.filter(n => n.is_critical).length}</b> на крит. пути</span>
          <span>Длительность: <b style={{ color: '#E8EEF5' }}>{Math.max(...nodes.map(n => n.early_finish), 0)} ч</b></span>
        </div>
      )}

      <div ref={containerRef} style={{ flex: 1, position: 'relative', overflow: 'hidden', margin: '0 8px 8px', borderRadius: 10, background: 'rgba(15,30,54,0.4)', border: '1px solid #1E3252' }}
        onMouseMove={handleMouseMove}>
        {nodes.length === 0 && (
          <div style={{ padding: 48, textAlign: 'center', color: '#5A7090', fontSize: 14 }}>
            Выберите проект для расчёта CPM
          </div>
        )}
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      </div>
    </div>
  );
}
