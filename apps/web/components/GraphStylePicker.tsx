'use client';
/**
 * Окно выбора стиля графиков.
 *
 * Открывается из настроек рабочего стола («Стиль графиков»). Показывает сцены
 * «простой заказ · группа с маркерами · пул» для каждой палитры, сгруппированные
 * по плотности заливки. Выбранный вариант применяется к виду «Сеть CPM»:
 * компонент передаёт палитру в канву, а сам выбор сохраняется по теме
 * (тёмная/светлая) в браузере.
 */
import React, { useMemo, useState } from 'react';
import {
  GRAPH_PALETTES, PALETTE_GROUP_TITLES, SEMANTIC_COLORS, SEMANTIC_COLORS_LIGHT,
  palettesForTheme, getPalette, type GraphPalette, type GraphPaletteGroup, type ThemeName,
} from '@/lib/graph-styles';

interface Props {
  open: boolean;
  theme: ThemeName;
  value: string;
  onClose: () => void;
  onApply: (id: string) => void;
}

function Scene({ p, theme, size = 150 }: { p: GraphPalette; theme: ThemeName; size?: number }) {
  const cs = theme === 'light' ? SEMANTIC_COLORS_LIGHT : SEMANTIC_COLORS;
  const bg = cs.background;
  const nid = 'ar-' + p.id;
  return (
    <svg viewBox="0 0 400 250" width="100%" height={size * 1.66}>
      <defs>
        <marker id={nid} markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
          <path d="M0,0 L7,3 L0,6 z" fill={cs.reserve} />
        </marker>
        <marker id={nid + 'r'} markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
          <path d="M0,0 L7,3 L0,6 z" fill={cs.critical} />
        </marker>
      </defs>

      {/* простой заказ */}
      <rect x="12" y="30" width="150" height="86" rx="12" fill="none" stroke={cs.orderFrame} strokeDasharray="6 5" opacity="0.85" />
      <text x="20" y="24" fill={cs.orderFrame} fontSize="10.5" fontWeight="600">простой заказ</text>

      {/* группа с маркерами */}
      <rect x="12" y="146" width="176" height="86" rx="12" fill="none" stroke={cs.groupFrame} strokeDasharray="6 5" opacity="0.9" />
      <text x="20" y="140" fill={cs.groupFrame} fontSize="10.5" fontWeight="600">группа · маркеры ◆</text>

      {/* пул */}
      <rect x="212" y="88" width="176" height="152" rx="12" fill={p.fill} opacity={p.fillOpacity} stroke={p.frame} strokeDasharray="6 5" />
      <text x="220" y="82" fill={p.frame} fontSize="10.5" fontWeight="600">пул · общий ресурс</text>

      {/* связи */}
      <line x1="106" y1="73" x2="167" y2="101" stroke={cs.reserve} strokeWidth="1.6" markerEnd={`url(#${nid})`} />
      <line x1="214" y1="110" x2="300" y2="110" stroke={cs.critical} strokeWidth="2.2" markerEnd={`url(#${nid}r)`} />
      <line x1="106" y1="189" x2="167" y2="189" stroke={cs.reserve} strokeWidth="1.6" markerEnd={`url(#${nid})`} />
      <line x1="252" y1="189" x2="320" y2="150" stroke={cs.reserve} strokeWidth="1.6" markerEnd={`url(#${nid})`} />

      {/* узлы заказа */}
      <circle cx="52" cy="73" r="22" fill={cs.orderFrame} opacity="0.18" stroke={cs.orderFrame} strokeWidth="1.8" />
      <text x="52" y="77" fill={cs.text} fontSize="10.5" textAnchor="middle">30</text>
      <circle cx="118" cy="73" r="22" fill={cs.reserveFill} opacity="0.9" stroke={cs.reserve} strokeWidth="1.6" />
      <text x="118" y="77" fill={cs.text} fontSize="10.5" textAnchor="middle">12</text>

      {/* узлы группы + маркеры */}
      <circle cx="52" cy="189" r="22" fill={cs.groupFrame} opacity="0.18" stroke={cs.groupFrame} strokeWidth="2.4" />
      <text x="52" y="193" fill={cs.text} fontSize="10.5" textAnchor="middle">27</text>
      <circle cx="118" cy="189" r="22" fill={cs.groupFrame} opacity="0.18" stroke={cs.groupFrame} strokeWidth="2.4" />
      <text x="118" y="193" fill={cs.text} fontSize="10.5" textAnchor="middle">36</text>
      <circle cx="82" cy="222" r="8" fill={cs.groupFrame} /><text x="82" y="226" fontSize="8" textAnchor="middle" fill={bg}>◆</text>
      <circle cx="148" cy="222" r="8" fill={cs.groupFrame} /><text x="148" y="226" fontSize="8" textAnchor="middle" fill={bg}>◆</text>

      {/* узлы пула */}
      <circle cx="248" cy="110" r="22" fill={p.fill} opacity="0.95" stroke={p.frame} strokeWidth="2.4" />
      <text x="248" y="114" fill={cs.text} fontSize="10.5" textAnchor="middle">18</text>
      <circle cx="336" cy="110" r="22" fill={cs.criticalFill} opacity="0.95" stroke={cs.critical} strokeWidth="2.2" />
      <text x="336" y="114" fill={cs.text} fontSize="10.5" textAnchor="middle">22</text>
      <circle cx="292" cy="189" r="22" fill={p.fill} opacity="0.95" stroke={p.frame} strokeWidth="2.4" />
      <text x="292" y="193" fill={cs.text} fontSize="10.5" textAnchor="middle">9</text>
      <circle cx="358" cy="189" r="22" fill={cs.reserveFill} opacity="0.9" stroke={cs.reserve} strokeWidth="1.6" />
      <text x="358" y="193" fill={cs.text} fontSize="10.5" textAnchor="middle">14</text>
    </svg>
  );
}

export default function GraphStylePicker({ open, theme, value, onClose, onApply }: Props) {
  const [pick, setPick] = useState<string>(value);
  const list = useMemo(() => palettesForTheme(theme), [theme]);
  const groups = useMemo(() => {
    const g: Record<string, GraphPalette[]> = {};
    list.forEach((p) => { (g[p.group] = g[p.group] || []).push(p); });
    return g;
  }, [list]);

  if (!open) return null;
  const preview = getPalette(pick);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(6,12,22,0.74)', zIndex: 4200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: 'min(1280px, 97vw)', maxHeight: '92vh', overflow: 'auto', background: '#0F1B2D', border: '1px solid #26364F', borderRadius: 12, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <b style={{ fontSize: 15 }}>Стиль графиков</b>
          <span style={{ fontSize: 12, color: '#8FA3BD' }}>
            тема: {theme === 'light' ? 'светлая' : 'тёмная'} · выбран: {getPalette(value).name}
          </span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => setPick('rose-abyss')} style={{ padding: '3px 10px' }}>Сбросить</button>
            <button className="btn" onClick={() => { onApply(pick); onClose(); }} style={{ padding: '3px 12px' }}>Применить</button>
            <button className="btn" onClick={onClose} style={{ padding: '3px 10px' }}>Закрыть</button>
          </span>
        </div>

        <div style={{ fontSize: 12, color: '#8FA3BD', marginBottom: 12 }}>
          Сцены одинаковые: простой заказ — голубой пунктир, группа с маркерами — фиолетовый с ◆, пул — пунктир в гамме варианта.
          Критические операции красные, с резервом — синие; эти смысловые цвета палитрой не меняются.
        </div>

        {(Object.keys(groups) as GraphPaletteGroup[]).map((g) => (
          <div key={g} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, margin: '6px 0 8px', paddingLeft: 8, borderLeft: '3px solid #3B82F6' }}>
              {PALETTE_GROUP_TITLES[g]}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 10 }}>
              {groups[g].map((p) => (
                <div
                  key={p.id}
                  onClick={() => setPick(p.id)}
                  style={{
                    background: '#152238',
                    border: '1px solid ' + (pick === p.id ? '#3B82F6' : '#26364F'),
                    borderRadius: 10,
                    padding: 10,
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 13 }}>
                    <span style={{ width: 16, height: 16, borderRadius: 4, background: p.fill, border: '2px solid ' + p.frame, display: 'inline-block' }} />
                    {p.name}
                    <span style={{ marginLeft: 'auto', fontSize: 11.5, color: '#8FA3BD', fontFamily: 'Consolas,monospace' }}>{p.frame}</span>
                  </div>
                  <Scene p={p} theme={theme} />
                  <div style={{ fontSize: 11.5, color: '#8FA3BD', marginTop: 6 }}>{p.note}</div>
                </div>
              ))}
            </div>
          </div>
        ))}

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', borderTop: '1px solid #26364F', paddingTop: 10 }}>
          <span style={{ fontSize: 12.5, color: '#CBD8EA' }}>
            Предпросмотр выбранного: <b>{preview.name}</b> · рамка <code>{preview.frame}</code> · заливка <code>{preview.fill}</code> · плотность {Math.round(preview.fillOpacity * 100)} %
          </span>
        </div>
      </div>
    </div>
  );
}
