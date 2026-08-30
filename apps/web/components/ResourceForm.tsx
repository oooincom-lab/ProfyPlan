'use client';

import type { CSSProperties } from 'react';
import ReferenceField from './ReferenceField';

export const RES_TYPES: { v: string; l: string }[] = [
  { v: 'equipment', l: 'Оборудование' },
  { v: 'employee', l: 'Сотрудник' },
  { v: 'team', l: 'Бригада' },
  { v: 'line', l: 'Линия' },
  { v: 'area', l: 'Участок' },
];
export const CAP_UNITS = ['hour', 'day', 'shift'];
export const COUNTRIES = ['RU', 'BY', 'KZ'];

export const typeLabel = (v: string) => RES_TYPES.find(t => t.v === v)?.l || v;
export const capUnitLabel = (v: string) => (v === 'hour' ? 'час' : v === 'day' ? 'день' : v === 'shift' ? 'смена' : v);

const input = (style?: CSSProperties): CSSProperties => ({ background: '#0A1628', border: '1px solid #1E3A5F', borderRadius: 6, color: '#E2E8F0', padding: '6px 9px', fontSize: 13, ...style });
const btn = (c: string): CSSProperties => ({ background: c, border: 'none', color: '#fff', borderRadius: 6, padding: '7px 13px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' });
const ghost = (): CSSProperties => ({ background: 'transparent', border: '1px solid #1E3A5F', color: '#8FA3BD', borderRadius: 6, padding: '7px 13px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' });
const lbl = (): CSSProperties => ({ fontSize: 10.5, color: '#5A7090', textTransform: 'uppercase' as const });

type Props = {
  form: Record<string, string>;
  onChange: (patch: Record<string, string>) => void;
  schedules: any[];
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
};

/**
 * Форма создания/редактирования глобального ресурса.
 * Используется и в модальном окне ResourceManager, и в MDI-окне WindowsLayer.
 */
export default function ResourceForm({ form, onChange, schedules, saving, onSave, onCancel }: Props) {
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: 'span 2' }}>
          <span style={lbl()}>Название</span>
          <input value={form.name || ''} onChange={e => onChange({ name: e.target.value })} style={input()} placeholder="Станок / Бригада" />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={lbl()}>Тип</span>
          <select value={form.resource_type || 'equipment'} onChange={e => onChange({ resource_type: e.target.value })} style={input()}>
            {RES_TYPES.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={lbl()}>Мощность</span>
          <input type="number" step="0.1" min="0" value={form.capacity_per_unit || ''} onChange={e => onChange({ capacity_per_unit: e.target.value })} style={input()} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={lbl()}>Ед. мощности</span>
          <select value={form.capacity_unit || 'hour'} onChange={e => onChange({ capacity_unit: e.target.value })} style={input()}>
            {CAP_UNITS.map(u => <option key={u} value={u}>{capUnitLabel(u)}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={lbl()}>Ед. продукции</span>
          <input value={form.unit || ''} onChange={e => onChange({ unit: e.target.value })} style={input()} placeholder="шт / кг" />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={lbl()}>Страна (календарь)</span>
          <select value={form.country_code || ''} onChange={e => onChange({ country_code: e.target.value })} style={input()}>
            <option value="">Наследовать от проекта</option>
            {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={lbl()}>Доступ</span>
          <select value={form.scope || 'shared'} onChange={e => onChange({ scope: e.target.value })} style={input()}>
            <option value="shared">🌐 Общий (межпроектный пул)</option>
            <option value="project">🔒 Проектный (резерв под один проект)</option>
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: 'span 2' }}>
          <span style={lbl()}>Подразделение</span>
          <ReferenceField
            entity="departments"
            value={form.department_id || null}
            onChange={(v) => onChange({ department_id: v || '' })}
            placeholder="Выбрать подразделение…"
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={lbl()}>График (по умолчанию)</span>
          <select value={form.schedule_id || ''} onChange={e => onChange({ schedule_id: e.target.value })} style={input()}>
            <option value="">— не задан —</option>
            {schedules.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button onClick={onSave} disabled={saving} style={btn('#3B82F6')}>{saving ? 'Сохранение…' : '✓ Сохранить'}</button>
        <button onClick={onCancel} style={ghost()}>Отмена</button>
      </div>
    </>
  );
}
