'use client';
/**
 * Раздел «Инструменты» — общие инструменты, работающие с любым контекстом.
 * Пока реально доступна сеть CPM (открывается видом в рабочем поле); остальные
 * инструменты помечены как «в работе» и появятся по плану (шаги 8.4–8.5).
 */
import { useState } from 'react';

type Props = {
  projects: any[];
  selectedProject: any;
  onOpenNetwork: (p: any) => void;
};

const card: React.CSSProperties = {
  background: '#101F38', border: '1px solid #1E3252', borderRadius: 12, padding: '14px 16px',
  display: 'flex', flexDirection: 'column', gap: 8,
};
const title: React.CSSProperties = { fontSize: 14.5, fontWeight: 700, color: '#E8EEF5' };
const desc: React.CSSProperties = { fontSize: 12.5, color: '#8FA3BD', lineHeight: 1.55, flex: 1 };
const btn: React.CSSProperties = {
  alignSelf: 'flex-start', background: '#12304F', border: '1px solid #2B5B92', color: '#DBEAFE',
  borderRadius: 8, padding: '5px 12px', fontSize: 12.5, cursor: 'pointer',
};
const badge = (text: string, tone: 'ok' | 'wait'): React.CSSProperties => ({
  alignSelf: 'flex-start', fontSize: 11.5, padding: '2px 8px', borderRadius: 999,
  border: '1px solid ' + (tone === 'ok' ? '#1F5F4B' : '#3B4A63'),
  background: tone === 'ok' ? '#123326' : '#141F33',
  color: tone === 'ok' ? '#34D399' : '#8FA3BD',
});

export default function ToolsPanel({ projects, selectedProject, onOpenNetwork }: Props) {
  const [pick, setPick] = useState<string>(selectedProject?.id || (projects?.[0]?.id || ''));
  const proj = projects?.find((p: any) => p.id === pick) || null;

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Инструменты</div>
        <div style={{ fontSize: 12.5, color: '#8FA3BD' }}>
          Общие инструменты работают с выбранным контекстом — проектом, кустом или заказом.
          Из сущности они открываются кнопкой с уже подставленным контекстом.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, color: '#8FA3BD' }}>Контекст:</span>
        <select
          value={pick}
          onChange={(e) => setPick(e.target.value)}
          style={{ background: '#0A1628', border: '1px solid #1E3A5F', borderRadius: 8, color: '#E8EEF5', padding: '5px 8px', fontSize: 12.5 }}
        >
          {(projects || []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <span style={{ fontSize: 12.5, color: '#5A7090' }}>
          {proj ? `операций в плане: ${proj.id ? '—' : ''}` : 'проект не выбран'}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
        <div style={card}>
          <div style={title}>🕸 Сеть CPM</div>
          <div style={desc}>
            Сетевой граф операций с днями на связях: ранние и поздние сроки, резервы, критический путь.
            Открывается видом в рабочем поле, без отдельной страницы.
          </div>
          <span style={badge('доступно', 'ok')}>доступно</span>
          <button style={btn} disabled={!proj} onClick={() => proj && onOpenNetwork(proj)}>Открыть сеть CPM</button>
        </div>

        <div style={card}>
          <div style={title}>🎚 Сценарии «что если»</div>
          <div style={desc}>
            Пробный расчёт с изменёнными условиями: мощность ресурса, ремонт, вторая смена, сдвиг куста.
            Локальный по умолчанию, с расширением до портфеля.
          </div>
          <span style={badge('в работе', 'wait')}>в работе</span>
          <button style={{ ...btn, opacity: 0.5, cursor: 'default' }} disabled>Появится позже</button>
        </div>

        <div style={card}>
          <div style={title}>🗂 Сравнение версий плана</div>
          <div style={desc}>
            Зафиксированные версии и отклонения: срок, критический путь, потери — «было / стало».
          </div>
          <span style={badge('в работе', 'wait')}>в работе</span>
          <button style={{ ...btn, opacity: 0.5, cursor: 'default' }} disabled>Появится позже</button>
        </div>

        <div style={card}>
          <div style={title}>🧾 Журнал изменений</div>
          <div style={desc}>
            Что и когда меняли в плане: закрепления, потоки, сдвиги. Данные уже пишутся, остался экран.
          </div>
          <span style={badge('в работе', 'wait')}>в работе</span>
          <button style={{ ...btn, opacity: 0.5, cursor: 'default' }} disabled>Появится позже</button>
        </div>

        <div style={card}>
          <div style={title}>🎲 Вероятностные оценки</div>
          <div style={desc}>
            PERT и Монте-Карло: доверительный интервал срока и точки риска по операциям.
          </div>
          <span style={badge('в работе', 'wait')}>в работе</span>
          <button style={{ ...btn, opacity: 0.5, cursor: 'default' }} disabled>Появится позже</button>
        </div>

        <div style={card}>
          <div style={title}>⬇️ Экспорт</div>
          <div style={desc}>
            Выгрузка плана и отчётов в таблицы — для внешних систем и согласований.
          </div>
          <span style={badge('в работе', 'wait')}>в работе</span>
          <button style={{ ...btn, opacity: 0.5, cursor: 'default' }} disabled>Появится позже</button>
        </div>
      </div>
    </div>
  );
}
