'use client';
/**
 * Расчёты — каркас раздела (блок 6.16 плана; спецификация — Дополнение 11 промта).
 *
 * Что даёт этот каркас:
 *   • единую полосу контекста — область, активные методы (две оси), дата и версия данных, «Пересчитать»,
 *     индикатор «есть несохранённые изменения» — одинаково на всех страницах раздела;
 *   • ленту вкладок: Обзор · Гант · Сетевой график · PERT · Монте-Карло · Сравнение · Запуски;
 *   • состояния вкладок: готова · метод выключен в настройках · страница появится позже (блок в очереди).
 *     Вкладка выключенного метода НЕ скрывается — показывается неактивной с причиной и переходом в настройки.
 *
 * Страницы внутри вкладок рисует рабочий стол: «Гант» и «Сетевой график» — существующие экраны,
 * остальные появятся по блокам 6.17–6.22. Пустых страниц не бывает: вместо пустоты — объяснение.
 *
 * 30.09.2026: вкладки «Сеть CPM» и «CCM» объединены в одну — «Сетевой график» (решение владельца;
 * спецификация — Дополнение 19). CCM остаётся методом оси логики; слой критической цепи кластера
 * появится в общем графике вместе с блоком 6.20.
 */
import React from 'react';
import { CalcMethods, MethodFill, METHOD_FILL_COLOR, METHOD_FILL_LABEL, analysisLabel, logicLabel } from '@/lib/calcMethods';
import { HelpButton } from '@/components/HelpWindow';
import { articleIdForCalcTab } from '@/lib/help';

export type CalcTab = 'overview' | 'gantt' | 'network' | 'estimates' | 'pert' | 'monte-carlo' | 'compare' | 'runs';

export const CALC_TABS: { id: CalcTab; label: string }[] = [
  { id: 'overview', label: 'Обзор' },
  { id: 'gantt', label: 'Гант' },
  { id: 'network', label: 'Сетевой график' },
  { id: 'estimates', label: 'Оценки' },
  { id: 'pert', label: 'PERT' },
  { id: 'monte-carlo', label: 'Монте-Карло' },
  { id: 'compare', label: 'Сравнение' },
  { id: 'runs', label: 'Запуски' },
];

export type CalcTabState = 'ready' | 'method-off' | 'planned';

/** В какой блок плана упирается вкладка и почему она ещё не готова. */
export const CALC_TAB_BLOCK: Record<CalcTab, { block: string; needs: string }> = {
  overview: { block: '6.16', needs: 'Обзор собирается на каркасе; плитки появятся вместе с расчётными страницами' },
  estimates: { block: '6.17', needs: '' },
  gantt: { block: '6.16.9', needs: '' },
  network: { block: '6.16.9', needs: '' },
  pert: { block: '6.18', needs: 'Оценки разброса показываются по критическому пути; полный разбор — Монте-Карло (6.19)' },
  'monte-carlo': { block: '6.19', needs: 'Нужен ввод тройных оценок — блок 6.17' },
  compare: { block: '6.22', needs: 'Появится вместе с запусками и сравнением методов' },
  runs: { block: '6.16.3', needs: 'Сравнение двух запусков и выгрузка — блок 6.22' },
};

export function calcTabState(tab: CalcTab, methods: CalcMethods): CalcTabState {
  if (tab === 'overview' || tab === 'gantt' || tab === 'network' || tab === 'estimates' || tab === 'runs' || tab === 'compare') return 'ready';
  if (tab === 'pert') return methods.analysis === 'pert' ? 'ready' : 'method-off';
  if (tab === 'monte-carlo') return methods.analysis === 'mc' ? 'ready' : 'method-off';
  return 'planned';
}

type TabNotice = {
  reason: string;
  blockedInBlock?: string;
  needs?: string;
};

function tabNotice(tab: CalcTab, methods: CalcMethods): TabNotice {
  if (tab === 'pert') {
    return methods.analysis === 'pert'
      ? { reason: 'Метод PERT включён, но страница ещё не построена.', blockedInBlock: '6.18', needs: CALC_TAB_BLOCK.pert.needs }
      : { reason: 'Метод PERT выключен в настройках расчёта проекта — вкладка показана неактивной, а не скрыта.', blockedInBlock: '6.16.7', needs: 'Включить PERT в настройках расчёта проекта' };
  }
  if (tab === 'monte-carlo') {
    return methods.analysis === 'mc'
      ? { reason: 'Монте-Карло включён — страница открывается на этой вкладке.', blockedInBlock: '6.19', needs: '' }
      : { reason: 'Монте-Карло выключен в настройках расчёта проекта — вкладка показана неактивной, а не скрыта.', blockedInBlock: '6.16.7', needs: 'Включить Монте-Карло в настройках расчёта проекта' };
  }
  // Защита от неожиданных tab-значений: неизвестная вкладка не должна ронять приложение.
  const meta = (CALC_TAB_BLOCK as any)[tab] as { block?: string; needs?: string } | undefined;
  return { reason: 'Страница ещё не построена.', blockedInBlock: meta?.block, needs: meta?.needs };
}

export type CalculationsTabsProps = {
  /** Активная вкладка; null — лента без выделенной вкладки (например, на странице настроек расчёта). */
  active: CalcTab | null;
  onSelect: (tab: CalcTab) => void;
  methods: CalcMethods;
  /** Область расчёта: проект · куст · группа · пул. */
  area?: string;
  /** Имя объекта расчёта — проект или пул. */
  areaName?: string | null;
  /** Дата расчёта и версия входных данных; нет данных — так и пишем, числа не выдумываем. */
  dataDate?: string | null;
  dataVersion?: string | null;
  /** Есть несохранённые изменения относительно последнего расчёта. */
  dirty?: boolean;
  /** Активный режим расчёта (блок 6.29) — показывается в полосе контекста */
  modeTitle?: string | null;
  onRecalculate?: () => void;
  onOpenSettings?: () => void;
  /** Показываем на странице «Настройки расчёта»: кнопка настроек подсвечивается как активная. */
  settingsActive?: boolean;
};

export default function CalculationsTabs({
  active,
  onSelect,
  methods,
  area = 'проект',
  areaName,
  dataDate,
  dataVersion,
  dirty = false,
  modeTitle,
  onRecalculate,
  onOpenSettings,
  settingsActive = false,
}: CalculationsTabsProps) {
  const fill: MethodFill = methods.analysis === 'none' && methods.logic === 'cpm' ? 'partial' : 'filled';

  const chipStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 11,
    color: 'var(--fg-3)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: '2px 9px',
    background: 'var(--bg-3)',
    whiteSpace: 'nowrap',
  };

  return (
    <div style={{ marginBottom: 10 }}>
      {/* ─── Полоса контекста: одинаково на всех страницах раздела ─── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          padding: '8px 12px',
          border: '1px solid var(--border)',
          borderRadius: 8,
          background: 'var(--bg-2)',
        }}
      >
        <span style={chipStyle}>
          <span style={{ color: 'var(--fg-4)' }}>область:</span>
          <b style={{ color: 'var(--fg-2)', fontWeight: 600 }}>{area}</b>
          {areaName ? <span style={{ color: 'var(--fg-3)' }}>· {areaName}</span> : null}
        </span>

        <span style={chipStyle} title={'Хранение метода: ' + methods.raw}>
          <span style={{ color: 'var(--fg-4)' }}>методы:</span>
          <span style={{ color: 'var(--fg-2)' }}>{logicLabel(methods.logic)}</span>
          <span style={{ color: 'var(--fg-4)' }}>+</span>
          <span style={{ color: 'var(--fg-2)' }}>{analysisLabel(methods.analysis)}</span>
        </span>

        <span style={chipStyle}>
          <span
            title={'Значок метода: ' + METHOD_FILL_LABEL[fill]}
            style={{ width: 8, height: 8, borderRadius: 4, background: METHOD_FILL_COLOR[fill], display: 'inline-block' }}
          />
          <span style={{ color: 'var(--fg-3)' }}>{METHOD_FILL_LABEL[fill]}</span>
        </span>

        <span style={chipStyle}>
          <span style={{ color: 'var(--fg-4)' }}>данные:</span>
          <span style={{ color: 'var(--fg-2)' }}>{dataDate || 'нет данных'}</span>
          {dataVersion ? <span style={{ color: 'var(--fg-3)' }}>· версия {dataVersion}</span> : null}
        </span>

        {modeTitle ? (
          <span style={{ ...chipStyle, borderColor: 'var(--accent)' }} title="Режим расчёта из настроек проекта: его номер и название записываются в запуск">
            <span style={{ color: 'var(--fg-4)' }}>режим:</span>
            <b style={{ color: 'var(--fg-2)', fontWeight: 600 }}>{modeTitle}</b>
          </span>
        ) : null}

        {dirty ? (
          <span style={{ ...chipStyle, borderColor: 'var(--warning)', color: 'var(--warning)' }}>есть несохранённые изменения</span>
        ) : null}

        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8 }}>
          {onRecalculate ? (
            <button className="btn btn-primary" onClick={onRecalculate} title="Пересчитать и обновить данные страницы">
              Пересчитать
            </button>
          ) : null}
        </span>
      </div>

      {/* ─── Лента вкладок ─── */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 8 }}>
        {CALC_TABS.map((t) => {
          const state = calcTabState(t.id, methods);
          const isActive = t.id === active;
          const disabled = state === 'method-off';
          return (
            <button
              key={t.id}
              data-help-id={'calc.tab.' + t.id}
              onClick={() => onSelect(t.id)}
              title={
                state === 'ready'
                  ? 'Готова'
                  : state === 'method-off'
                    ? 'Метод выключен в настройках расчёта проекта'
                    : 'Страница появится позже'
              }
              style={{
                fontSize: 12,
                padding: '5px 12px',
                borderRadius: 6,
                cursor: 'pointer',
                border: '1px solid ' + (isActive ? 'var(--accent)' : 'var(--border)'),
                background: isActive ? 'var(--bg-3)' : 'transparent',
                color: isActive ? 'var(--fg)' : disabled ? 'var(--fg-4)' : 'var(--fg-3)',
                fontWeight: isActive ? 600 : 400,
                borderStyle: disabled ? 'dashed' : 'solid',
              }}
            >
              {t.label}
              {state === 'planned' ? <span style={{ color: 'var(--fg-4)' }}> ·</span> : null}
              {state === 'method-off' ? <span style={{ color: 'var(--warning)' }}> ⌀</span> : null}
            </button>
          );
        })}
        {onOpenSettings ? (
          <button
            onClick={onOpenSettings}
            title="Настройки расчёта проекта: доступные методы, анализ, параметры"
            style={{
              fontSize: 12,
              padding: '5px 12px',
              borderRadius: 6,
              cursor: 'pointer',
              border: '1px solid ' + (settingsActive ? 'var(--accent)' : 'var(--border)'),
              background: settingsActive ? 'var(--bg-3)' : 'transparent',
              color: settingsActive ? 'var(--fg)' : 'var(--fg-3)',
              fontWeight: settingsActive ? 600 : 400,
            }}
          >
            Настройки расчёта
          </button>
        ) : null}
        {/* Справка по вкладке: статья активного модуля (блок 6.27); без активной вкладки — справка настроек */}
        <HelpButton articleId={active ? articleIdForCalcTab(active) : 'project-settings'} title={active ? 'Справка по этой вкладке' : 'Справка по настройкам расчёта'} />
      </div>
    </div>
  );
}

/** Заглушка вместо пустой страницы: что не так, в каком блоке и что нужно сделать. */
export function CalcTabNotice({ tab, methods, onOpenSettings, onBack }: { tab: CalcTab; methods: CalcMethods; onOpenSettings?: () => void; onBack?: () => void }) {
  const n = tabNotice(tab, methods);
  const label = CALC_TABS.find((t) => t.id === tab)?.label || tab;
  return (
    <div className="panel">
      <div className="panel-hdr">
        <div>
          <span className="panel-title">{label}</span>
          <span className="panel-sub">страница ещё не построена</span>
        </div>
      </div>
      <div style={{ padding: '14px 16px', display: 'grid', gap: 10, maxWidth: 720 }}>
        <div style={{ fontSize: 13, color: 'var(--fg-2)' }}>{n.reason}</div>
        {n.needs ? (
          <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>
            Что нужно: <span style={{ color: 'var(--fg-2)' }}>{n.needs}</span>
          </div>
        ) : null}
        {n.blockedInBlock ? (
          <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>
            Блок плана: <b style={{ color: 'var(--fg-2)' }}>{n.blockedInBlock}</b>
          </div>
        ) : null}
        <div style={{ display: 'flex', gap: 8 }}>
          {onOpenSettings ? (
            <button className="btn btn-primary" onClick={onOpenSettings}>
              Настройки расчёта
            </button>
          ) : null}
          {onBack ? (
            <button className="btn" onClick={onBack}>
              Вернуться к обзору
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export { tabNotice };
