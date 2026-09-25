'use client';
/**
 * Единый показатель читаемости раскладки сети CPM вместо счётчика из четырёх чисел.
 *
 * Показывает строку вида «Читаемость 92 %» с цветной точкой:
 *   • зелёная — хорошо, жёлтая — средне, красная — плохо.
 * Подробности — по значку «i»: пересечения по обеим укладкам, проходы линий
 * сквозь узлы, наложения узлов, плотность, а также итог честной проверки
 * планарности (`cpm-planarity`): подтверждена построением / граф непланарный /
 * не подтверждена (метод не дал ответ). Числа не сглаживаются: показатель
 * считается теми же метриками (`cpm-metrics`), что и прежний счётчик. Числа
 * пересечений даются раздельно («по датам» / «по слоям»), потому что зависят
 * от укладки. Планарность объявляется только по результату проверки.
 */
import React, { useState } from 'react';
import {
  readabilityScore, readabilityBand,
  type LayoutMetrics, type ReadabilityBand,
} from '@/lib/cpm-metrics';
import type { PlanarityResult, PlanarityState } from '@/lib/cpm-planarity';
import { CPM_INDICATOR_HINTS } from '@/lib/cpm-hints';

const BAND_COLOR: Record<ReadabilityBand, string> = {
  good: '#10B981',
  mid: '#F59E0B',
  bad: '#EF4444',
};
const BAND_LABEL: Record<ReadabilityBand, string> = {
  good: 'хорошо',
  mid: 'средне',
  bad: 'плохо',
};
const MONO = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

/** Цвет точки-состояния проверки планарности. */
const PLANAR_COLOR: Record<PlanarityState, string> = {
  confirmed: '#10B981',
  nonplanar: '#EF4444',
  unconfirmed: '#F59E0B',
};

export interface CpmReadabilityProps {
  metrics: LayoutMetrics;
  /** Пересечения в хронологической укладке «По датам». */
  crossingsByDate?: number;
  /** Пересечения в структурной укладке «По слоям». */
  crossingsByLayer?: number;
  /** Итог честной проверки планарности сети (по значку «i»). */
  planarity?: PlanarityResult;
  /**
   * Пересечения линий на ИТОГОВОЙ геометрии — как рисуется, со всеми связями
   * (операционными и служебными «Старт»/«Финиш», маркеры обрезки). Это честное
   * число для сообщений; счётчик пересечений ниже считается только по
   * операционным связям и по укладкам.
   */
  drawnCrossings?: number;
  /** Из пересечений итоговой геометрии — сколько с участием служебных линий. */
  drawnService?: number;
  /** Наложения подписей узлов после авторасстановки (компактный режим). */
  labelOverlaps?: number;
  /** Наложения подписей при прежнем фиксированном размещении — для сравнения. */
  labelOverlapsFixed?: number;
  /** Сторона прижатия всплывающих подробностей. */
  align?: 'left' | 'right';
}

function DetailRow({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '1px 0' }}>
      <span style={{ color: '#8FA3BD' }}>{k}</span>
      <b style={{ fontFamily: MONO, color: accent ? '#FCD34D' : '#E8EEF5' }}>{v}</b>
    </div>
  );
}

export default function CpmReadability({ metrics, crossingsByDate, crossingsByLayer, planarity, drawnCrossings, drawnService, labelOverlaps, labelOverlapsFixed, align = 'left' }: CpmReadabilityProps) {
  const [open, setOpen] = useState(false);
  const score = readabilityScore(metrics);
  const band = readabilityBand(score);
  const color = BAND_COLOR[band];
  const byDate = crossingsByDate != null ? crossingsByDate : metrics.crossings;
  const byLayer = crossingsByLayer != null ? crossingsByLayer : metrics.crossings;

  return (
    <span
      data-cpm-quality="indicator"
      data-cpm-label-overlaps={labelOverlaps != null ? String(labelOverlaps) : undefined}
      data-cpm-label-overlaps-fixed={labelOverlapsFixed != null ? String(labelOverlapsFixed) : undefined}
      data-cpm-crossings-drawn={drawnCrossings != null ? String(drawnCrossings) : undefined}
      data-cpm-crossings-drawn-service={drawnService != null ? String(drawnService) : undefined}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6 }}
    >
      <span
        aria-hidden="true"
        title={CPM_INDICATOR_HINTS.readability}
        style={{
          width: 9, height: 9, borderRadius: 50, flexShrink: 0,
          background: color, boxShadow: '0 0 7px ' + color,
        }}
      />
      <span style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: 600, color: '#E8EEF5', whiteSpace: 'nowrap' }}>
        Читаемость {score}&nbsp;%
      </span>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        onMouseDown={(e) => e.stopPropagation()}
        aria-label="Подробности качества раскладки"
        title="Подробности качества раскладки"
        style={{
          width: 16, height: 16, flexShrink: 0, borderRadius: 50, cursor: 'pointer', padding: 0,
          border: '1px solid ' + (open ? '#3B82F6' : '#2A4060'),
          background: open ? 'rgba(59,130,246,0.22)' : 'transparent',
          color: open ? '#60A5FA' : '#8FA3BD', fontStyle: 'italic', fontWeight: 700,
          fontSize: 10, lineHeight: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        i
      </button>
      {open && (
        <div
          data-cpm-quality="details"
          style={{
            position: 'absolute', top: '135%', [align === 'right' ? 'right' : 'left']: 0,
            zIndex: 40, width: 280, padding: '9px 11px', borderRadius: 9,
            background: '#162844', border: '1px solid #26364F', boxShadow: '0 10px 26px rgba(0,0,0,0.5)',
            fontSize: 11.5, lineHeight: 1.35, color: '#E8EEF5',
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6, color: '#93C5FD' }}>
            Качество раскладки · {BAND_LABEL[band]}
          </div>
          {drawnCrossings != null && (
            <DetailRow
              k="Пересечения линий на схеме"
              accent={drawnCrossings > 0}
              v={String(drawnCrossings) + (drawnService ? ' (служебных — ' + drawnService + ')' : '')}
            />
          )}
          <DetailRow k="Пересечения связей (по укладкам)" v={'по датам: ' + byDate + ' · по слоям: ' + byLayer} />
          <DetailRow k="Проходы линий сквозь узлы" v={String(metrics.edgeNodeHits)} />
          <DetailRow k="Наложения узлов" v={String(metrics.nodeOverlaps)} />
          <DetailRow k="Плотность" v={metrics.density + ' %'} />
          {labelOverlaps != null && (
            <DetailRow
              k="Наложения подписей"
              accent={labelOverlaps > 0}
              v={labelOverlapsFixed != null && labelOverlapsFixed !== labelOverlaps
                ? 'авто: ' + labelOverlaps + ' · было: ' + labelOverlapsFixed
                : String(labelOverlaps)}
            />
          )}
          <div style={{ marginTop: 7, paddingTop: 6, borderTop: '1px solid #26364F', color: '#8FA3BD' }}>
            Цвет точки — условное форматирование: зелёный — 90 % и выше, жёлтый — 70…89 %, красный — ниже 70 %.
          </div>
          <div style={{ marginTop: 5, color: '#8FA3BD' }}>
            Пересечения приведены для обеих укладок — «По датам» держит время работ, «По слоям» подбирает порядок.
          </div>
          {planarity && (
            <div data-cpm-planarity={planarity.state} style={{ marginTop: 8, paddingTop: 7, borderTop: '1px solid #26364F' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, color: '#93C5FD' }}>
                <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 50, flexShrink: 0, background: PLANAR_COLOR[planarity.state] }} />
                Планарность сети
              </div>
              <div style={{ marginTop: 3, fontWeight: 600, color: PLANAR_COLOR[planarity.state] }}>
                {planarity.shortLabel}
              </div>
              <div style={{ marginTop: 2, color: '#8FA3BD' }}>
                {planarity.explanation}
              </div>
            </div>
          )}
        </div>
      )}
    </span>
  );
}
