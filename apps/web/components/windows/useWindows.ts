'use client';

import { useRef, useState } from 'react';

export type OrderTab = 'order' | 'bom' | 'route' | 'res' | 'plan';

export type WinRec = {
  id: string;
  kind: 'order' | 'list' | 'bom' | 'dir' | 'resedit';
  orderId: string;
  data?: any;
  listKind?: 'orders' | 'groups' | 'pools';
  title?: string;
  dockTop?: number;
  x: number;
  y: number;
  w: number;
  h: number;
  min: boolean;
  max?: boolean;
  prev?: { x: number; y: number; w: number; h: number };
  z: number;
  tab: OrderTab;
  editing: boolean;
  saving?: boolean;
  form: Record<string, string>;
};

export type LayState = { winId: string; cols: number; rows: number; placed: string[] };

/**
 * Состояние и логика оконного режима (MDI): перетаскивание, Snap-зоны,
 * сетка раскладок, панель задач. Вынесено из page.tsx, чтобы не раздувать
 * основной компонент рабочего стола.
 */
export function useWindows(sidebarWidth: number = 260) {
  const [wins, setWins] = useState<WinRec[]>([]);
  const winZ = useRef(10);
  const [snapZone, setSnapZone] = useState<any>(null);
  const [lay, setLay] = useState<LayState | null>(null);
  const [snapEnabled, setSnapEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('profyplan_snap');
      return v !== '0';
    }
    return true;
  });

  // Рабочая область окон: правее левого меню (260px), ниже шапки (53px),
  // выше панели задач (44px).
  const deskRect = () => ({
    x: sidebarWidth,
    y: 53,
    w: typeof window !== 'undefined' ? window.innerWidth - sidebarWidth : 1140,
    h: typeof window !== 'undefined' ? Math.max(400, window.innerHeight - 53 - 44) : 800,
  });

  const zoneFor = (x: number, y: number, w: number, h: number): any => {
    const d = deskRect();
    const l = x <= d.x + 26, r = x + w >= d.x + d.w - 26, t = y <= d.y + 26, b = y + h >= d.y + d.h - 26;
    if (l && r) return { x: d.x, y: d.y, w: d.w, h: d.h };
    if (l && t) return { x: d.x, y: d.y, w: d.w / 2, h: d.h / 2 };
    if (r && t) return { x: d.x + d.w / 2, y: d.y, w: d.w / 2, h: d.h / 2 };
    if (l && b) return { x: d.x, y: d.y + d.h / 2, w: d.w / 2, h: d.h / 2 };
    if (r && b) return { x: d.x + d.w / 2, y: d.y + d.h / 2, w: d.w / 2, h: d.h / 2 };
    if (l) return { x: d.x, y: d.y, w: d.w / 2, h: d.h };
    if (r) return { x: d.x + d.w / 2, y: d.y, w: d.w / 2, h: d.h };
    if (t) return { x: d.x, y: d.y, w: d.w, h: d.h / 2 };
    if (b) return { x: d.x, y: d.y + d.h / 2, w: d.w, h: d.h / 2 };
    return null;
  };

  const openWin = (o: any) => {
    const ex = wins.find((w: WinRec) => w.orderId === o.id);
    if (ex) {
      winZ.current += 1;
      setWins(prev => prev.map(w => w.id === ex.id ? { ...w, min: false, z: winZ.current } : w));
      return;
    }
    winZ.current += 1;
    const n = wins.length;
    const d = deskRect();
    setWins(prev => [...prev, {
      id: 'w' + Date.now().toString(36),
      kind: 'order' as const,
      orderId: o.id,
      data: o,
      x: d.x + 40 + (n % 5) * 36,
      y: d.y + 26 + (n % 5) * 34,
      w: Math.min(480, d.w - 60),
      h: Math.min(380, d.h - 60),
      min: false,
      z: winZ.current,
      tab: 'order' as const,
      editing: false,
      form: {},
    }]);
  };

  const openBomWin = (o: any) => {
    const ex = wins.find((w: WinRec) => w.kind === 'bom' && w.orderId === o.id);
    if (ex) {
      winZ.current += 1;
      setWins(prev => prev.map(w => w.id === ex.id ? { ...w, min: false, data: o, z: winZ.current } : w));
      return;
    }
    winZ.current += 1;
    const d = deskRect();
    const MX = 28;
    const w = Math.min(920, d.w - MX * 2);
    const h = Math.min(720, d.h - MX * 2);
    setWins(prev => [...prev, {
      id: 'b' + Date.now().toString(36),
      kind: 'bom' as const,
      orderId: o.id,
      data: o,
      x: d.x + Math.max(MX, (d.w - w) / 2),
      y: d.y + Math.max(18, (d.h - h) / 2),
      w,
      h,
      min: false,
      z: winZ.current,
      tab: 'bom' as const,
      editing: false,
      form: {},
    }]);
  };

  const openListWin = (kind: 'orders' | 'groups' | 'pools', title: string, dockTop?: number) => {
    const d = deskRect();
    const MX = 28; // симметричный отступ, как у контента дашборда
    const top = dockTop != null ? dockTop : d.y + 140;
    const ex = wins.find(w => w.kind === 'list' && w.listKind === kind);
    if (ex) {
      winZ.current += 1;
      setWins(prev => prev.map(w => w.id === ex.id ? { ...w, min: false, z: winZ.current, dockTop: top } : w));
      return;
    }
    winZ.current += 1;
    setWins(prev => [...prev, {
      id: 'l' + Date.now().toString(36),
      kind: 'list' as const,
      orderId: '',
      listKind: kind,
      title,
      dockTop: top,
      x: d.x + MX,
      y: top,
      w: d.w - MX * 2,
      h: Math.max(160, d.h - (top - d.y) - 16),
      min: false,
      z: winZ.current,
      tab: 'order' as const,
      editing: false,
      form: {},
    }]);
  };

  const openResEdit = (res: any | null) => {
    const d = deskRect();
    const w = Math.min(620, d.w - 80);
    const h = Math.min(540, d.h - 80);
    const id = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    winZ.current += 1;
    setWins(prev => [...prev, {
      id,
      kind: 'resedit' as const,
      orderId: '',
      data: res,
      title: res ? 'Редактирование ресурса' : 'Новый ресурс',
      x: d.x + Math.max(28, (d.w - w) / 2),
      y: d.y + Math.max(18, (d.h - h) / 2),
      w,
      h,
      min: false,
      z: winZ.current,
      tab: 'order' as const,
      editing: false,
      form: res ? {
        name: res.name || '', resource_type: res.resource_type || 'equipment',
        capacity_per_unit: String(res.capacity_per_unit ?? 1), capacity_unit: res.capacity_unit || 'hour',
        unit: res.unit || '', country_code: res.country_code || '', schedule_id: res.schedule_id || '',
      } : {
        name: '', resource_type: 'equipment', capacity_per_unit: '1', capacity_unit: 'hour',
        unit: '', country_code: '', schedule_id: '',
      },
    }]);
    return id;
  };

  const openDirWin = (entity: string, title: string, columns: any[], onSelect?: (row: any) => void, onManageEdit?: (row: any) => void, onManageDelete?: (row: any) => void) => {
    const d = deskRect();
    if (!onSelect) {
      const ex = wins.find(w => w.kind === 'dir' && w.data?.entity === entity);
      if (ex) {
        winZ.current += 1;
        setWins(prev => prev.map(w => w.id === ex.id ? { ...w, min: false, z: winZ.current } : w));
        return ex.id;
      }
    }
    const id = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    winZ.current += 1;
    setWins(prev => [...prev, {
      id,
      kind: 'dir' as const,
      orderId: '',
      data: { entity, columns, onSelect, onManageEdit, onManageDelete },
      title,
      x: d.x + 60,
      y: d.y + 40,
      w: Math.min(840, d.w - 80),
      h: Math.min(560, d.h - 80),
      min: false,
      z: winZ.current,
      tab: 'order' as const,
      editing: false,
      form: {},
    }]);
    return id;
  };

  const closeWin = (id: string) => { setWins(prev => prev.filter(w => w.id !== id)); setLay(null); };

  const focusWin = (id: string) => {
    winZ.current += 1;
    setWins(prev => prev.map(w => w.id === id ? { ...w, z: winZ.current, min: false } : w));
  };

  const toggleMinWin = (id: string) => {
    setWins(prev => prev.map(w => w.id === id ? { ...w, min: !w.min } : w));
  };

  const minimizeAll = () => {
    setWins(prev => prev.map(w => (w.min ? w : { ...w, min: true })));
  };

  const toggleMinimizeAll = () => {
    const allMin = wins.length > 0 && wins.every(w => w.min);
    setWins(prev => prev.map(w => (allMin ? { ...w, min: false } : { ...w, min: true })));
  };

  const toggleSnap = (v: boolean) => {
    setSnapEnabled(v);
    if (typeof window !== 'undefined') localStorage.setItem('profyplan_snap', v ? '1' : '0');
  };

  const toggleMaxWin = (id: string) => {
    const d = deskRect();
    winZ.current += 1;
    setWins(prev => prev.map(w => {
      if (w.id !== id) return w;
      if (w.max) {
        const p = w.prev || { x: w.x, y: w.y, w: w.w, h: w.h };
        return { ...w, max: false, x: p.x, y: p.y, w: p.w, h: p.h, z: winZ.current };
      }
      return { ...w, max: true, prev: { x: w.x, y: w.y, w: w.w, h: w.h }, x: d.x, y: d.y, w: d.w, h: d.h, min: false, z: winZ.current };
    }));
  };

  const resetWin = (id: string) => {
    const d = deskRect();
    const MX = 28;
    const w = wins.find(x => x.id === id);
    if (w && w.kind === 'list') {
      const top = w.dockTop != null ? w.dockTop : d.y + 140;
      winZ.current += 1;
      setLay(null);
      setWins(prev => prev.map(x => x.id === id ? {
        ...x,
        x: d.x + MX, y: top, w: d.w - MX * 2, h: Math.max(160, d.h - (top - d.y) - 16),
        min: false, z: winZ.current,
      } : x));
      return;
    }
    const idx = wins.findIndex(x => x.id === id);
    const n = idx < 0 ? wins.length : idx;
    winZ.current += 1;
    setLay(null);
    setWins(prev => prev.map(x => x.id === id ? {
      ...x,
      x: d.x + 40 + (n % 5) * 36,
      y: d.y + 26 + (n % 5) * 34,
      w: Math.min(480, d.w - 60),
      h: Math.min(380, d.h - 60),
      min: false,
      z: winZ.current,
    } : x));
  };

  const startDrag = (e: any, w: WinRec) => {
    if ((e.target as HTMLElement).closest('.pp-wbtn')) return;
    focusWin(w.id);
    const sx = e.clientX - w.x, sy = e.clientY - w.y;
    let zone: any = null;
    const el = document.getElementById('pp-win-' + w.id);
    el?.classList.add('dragging');
    const move = (ev: PointerEvent) => {
      setWins(prev => prev.map(x => x.id === w.id ? { ...x, x: ev.clientX - sx, y: ev.clientY - sy } : x));
      zone = snapEnabled ? zoneFor(ev.clientX - sx, ev.clientY - sy, w.w, w.h) : null;
      setSnapZone(zone);
    };
    const up = () => {
      el?.classList.remove('dragging');
      if (zone) setWins(prev => prev.map(x => x.id === w.id ? { ...x, x: zone.x, y: zone.y, w: zone.w, h: zone.h } : x));
      setSnapZone(null);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const startResize = (e: any, w: WinRec) => {
    e.preventDefault(); e.stopPropagation();
    focusWin(w.id);
    const sx = e.clientX, sy = e.clientY, sw = w.w, sh = w.h;
    const move = (ev: PointerEvent) => {
      setWins(prev => prev.map(x => x.id === w.id ? { ...x, w: Math.max(280, sw + ev.clientX - sx), h: Math.max(160, sh + ev.clientY - sy) } : x));
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const pickLay = (cols: number, rows: number) => {
    if (!lay) return;
    const d = deskRect();
    const cw = d.w / cols, ch = d.h / rows;
    setWins(prev => prev.map(w => w.id === lay.winId ? { ...w, x: d.x, y: d.y, w: cw, h: ch } : w));
    setLay({ winId: lay.winId, cols, rows, placed: [] });
  };

  const placeNext = () => {
    if (!lay || !lay.cols) return;
    const d = deskRect();
    const idx = 1 + lay.placed.length;
    const total = lay.cols * lay.rows;
    if (idx >= total) { setLay(null); return; }
    const others = wins.filter(w => w.id !== lay.winId && !lay.placed.includes(w.id));
    const next = others[0];
    if (!next) { setLay(null); return; }
    const cell = { x: d.x + (idx % lay.cols) * (d.w / lay.cols), y: d.y + Math.floor(idx / lay.cols) * (d.h / lay.rows), w: d.w / lay.cols, h: d.h / lay.rows };
    setWins(prev => prev.map(w => w.id === next.id ? { ...w, x: cell.x, y: cell.y, w: cell.w, h: cell.h, min: false } : w));
    const placed = [...lay.placed, next.id];
    if (placed.length >= total - 1) { setLay(null); return; }
    setLay({ ...lay, placed });
  };

  const snapZones = (kind: string, d: any) => {
    if (kind === 'full') return [{ x: d.x, y: d.y, w: d.w, h: d.h }];
    if (kind === 'h2') return [{ x: d.x, y: d.y, w: d.w / 2, h: d.h }, { x: d.x + d.w / 2, y: d.y, w: d.w / 2, h: d.h }];
    if (kind === 'h3') return [0, 1, 2].map(i => ({ x: d.x + (d.w / 3) * i, y: d.y, w: d.w / 3, h: d.h }));
    if (kind === 'v2') return [{ x: d.x, y: d.y, w: d.w, h: d.h / 2 }, { x: d.x, y: d.y + d.h / 2, w: d.w, h: d.h / 2 }];
    if (kind === 'grid22') return [0, 1, 2, 3].map(i => ({ x: d.x + (i % 2) * (d.w / 2), y: d.y + Math.floor(i / 2) * (d.h / 2), w: d.w / 2, h: d.h / 2 }));
    return [];
  };

  const applySnap = (kind: string) => {
    if (!lay) return;
    const d = deskRect();
    const zones = snapZones(kind, d);
    const active = wins.find(w => w.id === lay.winId);
    const others = wins.filter(w => w.id !== lay.winId && !w.min);
    const targets = [active, ...others].filter(Boolean) as WinRec[];
    setWins(prev => prev.map(w => {
      const idx = targets.findIndex(t => t.id === w.id);
      if (idx >= 0 && idx < zones.length) {
        const z = zones[idx];
        return { ...w, x: z.x, y: z.y, w: z.w, h: z.h, min: false, max: false };
      }
      return w;
    }));
    setLay(null);
  };

  const applySnapGrid = (cols: number, rows: number) => {
    if (!lay) return;
    const d = deskRect();
    const zones: any[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) zones.push({ x: d.x + c * (d.w / cols), y: d.y + r * (d.h / rows), w: d.w / cols, h: d.h / rows });
    const active = wins.find(w => w.id === lay.winId);
    const others = wins.filter(w => w.id !== lay.winId && !w.min);
    const targets = [active, ...others].filter(Boolean) as WinRec[];
    setWins(prev => prev.map(w => {
      const idx = targets.findIndex(t => t.id === w.id);
      if (idx >= 0 && idx < zones.length) {
        const z = zones[idx];
        return { ...w, x: z.x, y: z.y, w: z.w, h: z.h, min: false, max: false };
      }
      return w;
    }));
    setLay(null);
  };

  const applySnapCell = (colCount: number, colIndex: number, rowCount: number, rowIndex: number) => {
    if (!lay) return;
    const d = deskRect();
    const cw = d.w / colCount, ch = d.h / rowCount;
    const zones: any[] = [];
    for (let r = 0; r < rowCount; r++) for (let c = 0; c < colCount; c++) zones.push({ x: d.x + c * cw, y: d.y + r * ch, w: cw, h: ch });
    const targetIndex = rowIndex * colCount + colIndex;
    const others = wins.filter(w => w.id !== lay.winId && !w.min);
    const rest = zones.filter((_, i) => i !== targetIndex);
    setWins(prev => prev.map(w => {
      if (w.id === lay.winId) {
        const z = zones[targetIndex];
        return { ...w, x: z.x, y: z.y, w: z.w, h: z.h, min: false, max: false };
      }
      const oi = others.findIndex(t => t.id === w.id);
      if (oi >= 0 && oi < rest.length) {
        const z = rest[oi];
        return { ...w, x: z.x, y: z.y, w: z.w, h: z.h, min: false, max: false };
      }
      return w;
    }));
    setLay(null);
  };

  return {
    wins, setWins, lay, setLay, snapZone,
    openWin, openBomWin, openListWin, openDirWin, openResEdit, closeWin, focusWin, toggleMinWin, minimizeAll, toggleMinimizeAll, toggleMaxWin, resetWin, snapEnabled, toggleSnap,
    startDrag, startResize, pickLay, placeNext, applySnap, applySnapGrid, applySnapCell,
  };
}
