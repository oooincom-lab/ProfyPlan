'use client';

import { ReactNode } from 'react';

/**
 * Стилизованная модалка в дизайне ProfyPlan.
 * Заменяет браузерные window.confirm / window.prompt.
 */
export default function AppModal({ title, onClose, children, width = 460, accent = '#3B82F6' }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  accent?: string;
}) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(2,8,18,.68)', zIndex: 4000, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(2px)' }}
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width, maxWidth: '94vw', maxHeight: '84vh', display: 'flex', flexDirection: 'column',
          background: 'linear-gradient(180deg, #10244a 0%, #0B1B33 100%)',
          border: '1px solid #2A4060', borderRadius: 14,
          boxShadow: '0 26px 80px rgba(0,0,0,.6), 0 0 0 1px rgba(59,130,246,.06)',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid #1E3252', background: 'rgba(13,31,58,.85)', flexShrink: 0 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: accent, flexShrink: 0, boxShadow: `0 0 8px ${accent}88` }} />
          <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700, color: '#E8EEF5', letterSpacing: '.01em' }}>{title}</span>
          <button
            onClick={onClose}
            title="Закрыть"
            style={{ background: 'transparent', border: 'none', color: '#5A7090', fontSize: 15, cursor: 'pointer', padding: '2px 8px', borderRadius: 6, fontFamily: 'inherit' }}
          >✕</button>
        </div>
        <div style={{ padding: '14px 16px', overflow: 'auto', fontSize: 12.5, color: '#E2E8F0' }}>{children}</div>
      </div>
    </div>
  );
}

/** Кнопки-акции в модалках (единый стиль) */
export function ModalButtons({ onCancel, onOk, okText = 'Готово', okColor = '#3B82F6', disabled }: {
  onCancel: () => void;
  onOk: () => void;
  okText?: string;
  okColor?: string;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16, paddingTop: 12, borderTop: '1px solid #1E3252' }}>
      <button
        onClick={onCancel}
        style={{ background: 'transparent', border: '1px solid #1E3A5F', color: '#8FA3BD', borderRadius: 8, padding: '7px 16px', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}
      >Отмена</button>
      <button
        onClick={onOk}
        disabled={disabled}
        style={{ background: okColor, border: 'none', color: '#fff', borderRadius: 8, padding: '7px 16px', fontSize: 12.5, fontWeight: 600, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? .5 : 1, fontFamily: 'inherit' }}
      >{okText}</button>
    </div>
  );
}
