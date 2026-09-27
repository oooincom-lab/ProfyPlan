'use client';
/**
 * Окно справки (блок 6.27 плана; спецификация — Дополнение 14 промта).
 *
 * Одно окно на всё приложение: содержимое переключается по модулю. Открывается поверх
 * рабочего экрана — место работы не теряется. Кнопку «?» в шапке окон и в шапке панели
 * даёт контекст справки, поэтому текст статьи живёт в одном месте (lib/help.ts).
 */
import React from 'react';
import { HELP_ARTICLES, HELP_STATE_COLOR, HELP_STATE_LABEL, helpArticle, openHelp } from '@/lib/help';

/**
 * Кнопка «?» — единая для шапок окон, шапки панели и ленты вкладок раздела «Расчёты».
 * Ничего не знает о том, кто её отрисовал: отправляет событие, окно справки ловит его
 * в рабочем столе. Поэтому новую кнопку можно поставить где угодно без прокидывания свойств.
 */
export function HelpButton({ articleId, title, compact }: { articleId: string; title?: string; compact?: boolean }) {
  return (
    <button
      type="button"
      className={compact ? 'pp-wbtn' : undefined}
      title={title || 'Справка по этому разделу'}
      onClick={(e) => {
        e.stopPropagation();
        openHelp(articleId);
      }}
      style={
        compact
          ? undefined
          : {
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--fg-3)',
              borderRadius: 6,
              padding: '2px 9px',
              fontSize: 12,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }
      }
    >
      ?
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: '#60A5FA', marginBottom: 5 }}>{title}</div>
      {children}
    </div>
  );
}

export default function HelpWindow({
  articleId,
  onSelect,
  onClose,
}: {
  articleId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const article = helpArticle(articleId) || HELP_ARTICLES[0];
  const bodyText: React.CSSProperties = { fontSize: 12.5, color: 'var(--fg-2)', lineHeight: 1.55 };

  return (
    <div
      className="pp-win focus"
      style={{ position: 'fixed', right: 24, top: 72, width: 470, maxWidth: 'calc(100vw - 48px)', height: 640, maxHeight: 'calc(100vh - 120px)', zIndex: 900, display: 'flex', flexDirection: 'column' }}
    >
      <div className="pp-win-title" style={{ cursor: 'default' }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22D3EE', flexShrink: 0 }} />
        <span className="ttl">Справка</span>
        <button className="pp-wbtn close" title="Закрыть" onClick={onClose}>✕</button>
      </div>

      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
        <select
          value={article.id}
          onChange={(e) => onSelect(e.target.value)}
          style={{ flex: 1, minWidth: 200, background: '#0B1B33', color: 'var(--fg)', border: '1px solid var(--border-2)', borderRadius: 6, padding: '6px 8px', fontSize: 12.5, fontFamily: 'inherit' }}
        >
          {HELP_ARTICLES.map((a) => (
            <option key={a.id} value={a.id}>{a.title}</option>
          ))}
        </select>
        <span
          title="Состояние статьи: справка описывает то, что код делает, а не то, что планировалось"
          style={{ fontSize: 10.5, color: HELP_STATE_COLOR[article.state], border: '1px solid ' + HELP_STATE_COLOR[article.state], borderRadius: 10, padding: '1px 8px', whiteSpace: 'nowrap' }}
        >
          {HELP_STATE_LABEL[article.state]}{article.block ? ' — блок ' + article.block : ''}
        </span>
      </div>

      <div style={{ overflow: 'auto', padding: '12px 14px', display: 'grid', gap: 12 }}>
        <div>
          <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 4 }}>{article.title}</div>
          <div style={{ ...bodyText, color: 'var(--fg-3)' }}>{article.summary}</div>
        </div>

        <Section title="Назначение">
          <div style={bodyText}>{article.purpose}</div>
        </Section>

        {article.steps?.length ? (
          <Section title="Как пользоваться">
            <ol style={{ margin: 0, paddingLeft: 18, ...bodyText }}>
              {article.steps.map((s, i) => (
                <li key={i} style={{ marginBottom: 4 }}>{s}</li>
              ))}
            </ol>
          </Section>
        ) : null}

        {article.fields?.length ? (
          <Section title="Поля и значения">
            <table className="tbl">
              <tbody>
                {article.fields.map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ whiteSpace: 'nowrap', color: 'var(--fg)' }}>{k}</td>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        ) : null}

        {article.calc?.length ? (
          <Section title="Как считается">
            <ul style={{ margin: 0, paddingLeft: 18, ...bodyText }}>
              {article.calc.map((s, i) => (
                <li key={i} style={{ marginBottom: 4 }}>{s}</li>
              ))}
            </ul>
          </Section>
        ) : null}

        {article.limits?.length ? (
          <Section title="Ограничения">
            <ul style={{ margin: 0, paddingLeft: 18, ...bodyText, color: 'var(--fg-3)' }}>
              {article.limits.map((s, i) => (
                <li key={i} style={{ marginBottom: 4 }}>{s}</li>
              ))}
            </ul>
          </Section>
        ) : null}

        {article.links?.length ? (
          <Section title="Смотрите также">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {article.links.map((id) => {
                const a = helpArticle(id);
                if (!a) return null;
                return (
                  <button
                    key={id}
                    onClick={() => onSelect(id)}
                    style={{ background: 'transparent', border: '1px solid var(--border-2)', color: '#93C5FD', borderRadius: 6, padding: '3px 10px', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    {a.title}
                  </button>
                );
              })}
            </div>
          </Section>
        ) : null}
      </div>
    </div>
  );
}
