'use client';

import DirectoryTable from './DirectoryTable';
import DebugBadge from './DebugBadge';

type ColumnDef = {
  key: string;
  label: string;
  width?: number;
  render?: (val: any, row: any) => React.ReactNode;
};

type Props = {
  title: string;
  entity: string;
  columns: ColumnDef[];
  apiBase: string;
  onClose: () => void;
  onSelect?: (row: any) => void;
  /** modal — центрированное окно с затемнением; panel — встроенная боковая панель (режим «Встроенно») */
  variant?: 'modal' | 'panel';
  onManageCalendar?: (row: any) => void;
  debug?: boolean;
};

/**
 * Универсальный модуль работы со справочником: модальное окно поверх
 * CRUD-таблицы DirectoryTable. Один модуль — для всех справочников.
 * (В оконном режиме этот же контент рендерится внутри окна.)
 */
export default function DirectoryManager({ title, entity, columns, apiBase, onClose, onSelect, variant = 'modal', onManageCalendar, debug = false }: Props) {
  const panel = variant === 'panel';
  return (
    <div
      style={{
        position: 'fixed',
        ...(panel
          ? { top: 0, right: 0, bottom: 0, width: 760, maxWidth: '94vw', zIndex: 7000, background: '#0D1F3A', borderLeft: '1px solid #1E3A5F', display: 'flex', flexDirection: 'column' }
          : { inset: 0, zIndex: 9000, background: 'rgba(3,10,20,.62)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }),
      }}
      onClick={(e) => { if (e.target === e.currentTarget && !panel) onClose(); }}
    >
      <div
        style={{
          background: 'linear-gradient(135deg, #0F1E36, #162844)', border: panel ? 'none' : '1px solid #1E3A5F',
          borderRadius: panel ? 0 : 12, width: '100%', maxWidth: panel ? 'none' : 960, maxHeight: panel ? 'none' : '82vh',
          height: panel ? '100%' : 'auto',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #1E3252', background: '#0D1F3A', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', flex: 1 }}>{title}</div>
          <DebugBadge debug={debug} text={`[dir:manager:${entity}]`} copy={`[dir:manager:${entity}] «${title}»`} />
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 0, color: '#8FA3BD', cursor: 'pointer', fontSize: 18, padding: '2px 8px' }}
          >
            ✕
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 12 }}>
          <DirectoryTable entity={entity} columns={columns} apiBase={apiBase} onSelect={onSelect} onManageCalendar={onManageCalendar} />
        </div>
      </div>
    </div>
  );
}
