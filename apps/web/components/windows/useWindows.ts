'use client';

import { useRef, useState } from 'react';

export type OrderTab = 'order' | 'bom' | 'route' | 'res' | 'plan';

export type WinRec = {
  id: string;
  orderId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  min: boolean;
  z: number;
  tab: OrderTab;
  editing: boolean;
  form: Record<string, string>;
};

export type LayState = { winId: string; cols: number; rows: number; placed: string[] };

/**
 * Состояние и логика оконного режима (MDI): перетаскивание, Snap-зоны,
 * сетка раскладок, панель задач. Вынесено из page.tsx, чтобы не раздувать
 * основной компонент рабочего стола.
 */
export function useWindows() {
  const [wins, setWins] = useState<WinRec[]>([]);
  const winZ = useRef(10);
  const [snapZone, setSnapZone] = useState<any>(null);
  const [lay, setLay] = useState<LayState | null>(null);

  // Рабочая область окон: правее левого меню (260px), ниже шапки (53px),
  // выше панели задач (44px).
  const deskRect = () => ({
    x: 260,
    y: 53,
    w: typeof window !== 'undefined' ? window.innerWidth - 260 : 1140,
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
      orderId: o.id,
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

  const closeWin = (id: string) => { setWins(prev => prev.filter(w => w.id !== id)); setLay(null); };

  const focusWin = (id: string) => {
    winZ.current += 1;
    setWins(prev => prev.map(w => w.id === id ? { ...w, z: winZ.current, min: false } : w));
  };

  const toggleMinWin = (id: string) => {
    setWins(prev => prev.map(w => w.id === id ? { ...w, min: !w.min } : w));
  };

  const resetWin = (id: string) => {
    const d = deskRect();
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
      zone = zoneFor(ev.clientX - sx, ev.clientY - sy, w.w, w.h);
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

  return {
    wins, setWins, lay, setLay, snapZone,
    openWin, closeWin, focusWin, toggleMinWin, resetWin,
    startDrag, startResize, pickLay, placeNext,
  };
}
