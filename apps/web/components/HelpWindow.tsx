'use client';
/**
 * Содержимое окна справки (блок 6.27). Само окно — обычное окно общего оконного менеджера
 * (свернуть, развернуть, раскладка, закрыть, панель задач): здесь только содержимое.
 *
 * Устройство — как у справочных сайтов: поиск сверху, дерево разделов слева со вложенностью,
 * хлебные крошки, ссылки внутри текста, переходы «назад» и «дальше по разделу».
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  HELP_ARTICLES,
  HELP_GROUPS,
  HELP_STATE_COLOR,
  HELP_STATE_LABEL,
  helpArticle,
  helpGroupOf,
  helpInline,
  hintEntries,
  helpOrder,
  helpSearch,
  helpSnippet,
  openHelp,
} from '@/lib/help';
import { CALC_MODES } from '@/lib/calcModes';

/** Кнопка «?» — единая для шапок окон, шапки панели и ленты вкладок раздела «Расчёты». */
export function HelpButton({ articleId, title, compact }: { articleId: string; title?: string; compact?: boolean }) {
  const onOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    openHelp(articleId);
  };
  // В шапке окна — та же кнопка, что «свернуть / раскладка / закрыть». В шапке раздела и на вкладках —
  // штатная маленькая вторичная кнопка системы (.btn.btn-secondary.btn-sm), а не голый текст.
  if (compact) {
    return (
      <button type="button" className="pp-wbtn" title={title || 'Справка по этому окну'} onClick={onOpen}>
        ?
      </button>
    );
  }
  return (
    <button
      type="button"
      className="btn btn-secondary btn-sm"
      title={title || 'Справка по разделу'}
      onClick={onOpen}
      style={{ minWidth: 30, justifyContent: 'center', fontWeight: 700 }}
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

/** Текст со ссылками [[id]] / [[id|текст]] — чтобы читатель шёл по справке, а не искал статью. */
function RichText({ text, style, onSelect }: { text: string; style?: React.CSSProperties; onSelect: (id: string) => void }) {
  const parts = helpInline(text);
  return (
    <span style={style}>
      {parts.map((p, i) =>
        p.id ? (
          <button
            key={i}
            onClick={() => onSelect(p.id!)}
            style={{ background: 'none', border: 0, padding: 0, color: '#93C5FD', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}
          >
            {p.text}
          </button>
        ) : (
          <React.Fragment key={i}>{p.text}</React.Fragment>
        ),
      )}
    </span>
  );
}

export default function HelpContent({
  articleId,
  onSelect,
}: {
  articleId: string;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [history, setHistory] = useState<string[]>([]);

  const article = helpArticle(articleId) || HELP_ARTICLES[0];
  const results = useMemo(() => helpSearch(query), [query]);
  const order = helpOrder();
  const idx = order.indexOf(article.id);
  const prev = idx > 0 ? helpArticle(order[idx - 1]) : null;
  const next = idx >= 0 && idx < order.length - 1 ? helpArticle(order[idx + 1]) : null;

  useEffect(() => {
    setQuery('');
  }, [articleId]);

  const go = (id: string) => {
    if (!id || id === article.id) return;
    setHistory((h) => [...h, article.id]);
    onSelect(id);
  };
  const back = () => {
    setHistory((h) => {
      if (!h.length) return h;
      onSelect(h[h.length - 1]);
      return h.slice(0, -1);
    });
  };

  const bodyText: React.CSSProperties = { fontSize: 12.5, color: 'var(--fg-2)', lineHeight: 1.55 };
  const linkStyle: React.CSSProperties = {
    background: 'transparent',
    border: '1px solid var(--border-2)',
    color: '#93C5FD',
    borderRadius: 6,
    padding: '3px 10px',
    fontSize: 11.5,
    cursor: 'pointer',
    fontFamily: 'inherit',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* ─── Поиск и возврат ─── */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '9px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <button className="pp-wbtn" title="Назад" onClick={back} disabled={!history.length} style={{ opacity: history.length ? 1 : 0.45 }}>
          ↩
        </button>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results.length) go(results[0].id);
          }}
          placeholder="Поиск по справке: поле, окно, метод, расчёт…"
          style={{ flex: 1, minWidth: 160, background: '#0B1B33', color: 'var(--fg)', border: '1px solid var(--border-2)', borderRadius: 6, padding: '6px 10px', fontSize: 12.5, outline: 'none', fontFamily: 'inherit' }}
        />
        {query ? <span style={{ fontSize: 11.5, color: 'var(--fg-4)', whiteSpace: 'nowrap' }}>{results.length} найдено</span> : null}
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {/* ─── Дерево разделов (или выдача поиска) ─── */}
        <div style={{ width: 250, flexShrink: 0, borderRight: '1px solid var(--border)', overflow: 'auto', padding: '8px 6px' }}>
          {query.trim().length >= 2 ? (
            results.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--fg-4)', padding: '8px 6px' }}>
                Ничего не нашлось. Попробуйте другое слово — например, «резерв», «прогоны», «заказ».
              </div>
            ) : (
              results.map((a) => (
                <button
                  key={a.id}
                  onClick={() => go(a.id)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 0, borderLeft: '2px solid transparent', padding: '6px 8px', cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  <div style={{ fontSize: 12.5, color: 'var(--fg-2)' }}>{a.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--fg-4)', marginTop: 2 }}>{helpSnippet(a, query)}</div>
                </button>
              ))
            )
          ) : (
            HELP_GROUPS.map((g) => {
              const isCollapsed = !!collapsed[g.title];
              const groupActive = g.ids.includes(article.id);
              return (
                <div key={g.title} style={{ marginBottom: 10 }}>
                  {/* Ветка дерева: заголовок раздела */}
                  <button
                    onClick={() => setCollapsed((c) => ({ ...c, [g.title]: !c[g.title] }))}
                    style={{ display: 'flex', alignItems: 'center', gap: 7, width: '100%', background: 'transparent', border: 0, padding: '5px 6px 5px 4px', cursor: 'pointer', fontFamily: 'inherit', color: groupActive ? 'var(--fg-2)' : 'var(--fg-4)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600 }}
                  >
                    <span style={{ width: 11, color: 'var(--fg-4)' }}>{isCollapsed ? '▸' : '▾'}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>{g.title}</span>
                  </button>
                  {/* Вложенность: статьи сдвинуты вправо и соединены направляющей линией */}
                  {!isCollapsed && (
                    <div style={{ marginLeft: 13, borderLeft: '1px solid var(--border)', paddingTop: 2, paddingBottom: 2 }}>
                      {g.ids.map((id) => {
                        const a = helpArticle(id);
                        if (!a) return null;
                        const active = id === article.id;
                        return (
                          <button
                            key={id}
                            onClick={() => go(id)}
                            title={HELP_STATE_LABEL[a.state]}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              width: '100%',
                              textAlign: 'left',
                              background: active ? 'rgba(59,130,246,.14)' : 'transparent',
                              border: 0,
                              borderLeft: '2px solid ' + (active ? 'var(--accent)' : 'transparent'),
                              marginLeft: -1,
                              padding: '6px 8px 6px 12px',
                              cursor: 'pointer',
                              fontFamily: 'inherit',
                              color: active ? 'var(--fg)' : 'var(--fg-2)',
                              fontSize: 12.5,
                              fontWeight: active ? 600 : 400,
                            }}
                          >
                            <span style={{ width: 6, height: 6, borderRadius: 3, background: HELP_STATE_COLOR[a.state], flexShrink: 0 }} />
                            <span style={{ flex: 1, minWidth: 0 }}>{a.title}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* ─── Статья ─── */}
        <div style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: '12px 16px', display: 'grid', gap: 12, alignContent: 'start' }}>
          <div style={{ fontSize: 11.5, color: 'var(--fg-4)' }}>
            Справка › {helpGroupOf(article.id)} › <span style={{ color: 'var(--fg-3)' }}>{article.title}</span>
          </div>

          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 16, fontWeight: 600 }}>{article.title}</span>
              <span
                title="Справка описывает то, что код делает, а не то, что планировалось"
                style={{ fontSize: 10.5, color: HELP_STATE_COLOR[article.state], border: '1px solid ' + HELP_STATE_COLOR[article.state], borderRadius: 10, padding: '1px 8px', whiteSpace: 'nowrap' }}
              >
                {HELP_STATE_LABEL[article.state]}{article.block ? ' — блок ' + article.block : ''}
              </span>
            </div>
            <div style={{ ...bodyText, color: 'var(--fg-3)', marginTop: 4 }}>{article.summary}</div>
          </div>

          <Section title="Назначение">
            <RichText text={article.purpose} style={bodyText} onSelect={go} />
          </Section>

          {article.steps?.length ? (
            <Section title="Как пользоваться">
              <ol style={{ margin: 0, paddingLeft: 18, ...bodyText }}>
                {article.steps.map((s, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>
                    <RichText text={s} onSelect={go} />
                  </li>
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
                      <td>
                        <RichText text={v} onSelect={go} />
                      </td>
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
                  <li key={i} style={{ marginBottom: 4 }}>
                    <RichText text={s} onSelect={go} />
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {article.limits?.length ? (
            <Section title="Ограничения">
              <ul style={{ margin: 0, paddingLeft: 18, ...bodyText, color: 'var(--fg-3)' }}>
                {article.limits.map((s, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>
                    <RichText text={s} onSelect={go} />
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {article.id === 'calc-modes' ? (
            <Section title="Режимы (из общего описания)">
              <div style={{ display: 'grid', gap: 8 }}>
                {CALC_MODES.map((m) => (
                  <div key={m.id} style={{ border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-2)', padding: '8px 10px' }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg)', marginBottom: 3 }}>{m.title}</div>
                    <div style={{ ...bodyText, fontSize: 12 }}><b>Считает:</b> {m.computes}</div>
                    <div style={{ ...bodyText, fontSize: 12 }}><b>Получите:</b> {m.gives.join(' · ')}</div>
                    <div style={{ ...bodyText, fontSize: 12, color: 'var(--fg-3)' }}><b>Не будет:</b> {m.limits.join('; ')}</div>
                    <div style={{ ...bodyText, fontSize: 12, color: 'var(--fg-4)' }}>{m.time} · {m.when}</div>
                  </div>
                ))}
              </div>
            </Section>
          ) : null}

          {article.id === 'calc-network' ? (
            <>
              <Section title="Подсказки органов управления (из общего словаря)">
                <ul style={{ margin: 0, paddingLeft: 18, ...bodyText }}>
                  {hintEntries('graph').map((h) => (
                    <li key={h.key} style={{ marginBottom: 5 }}>
                      <RichText text={h.text} onSelect={go} />
                    </li>
                  ))}
                </ul>
              </Section>
              <Section title="Индикаторы, цвета и пороги">
                <ul style={{ margin: 0, paddingLeft: 18, ...bodyText }}>
                  {hintEntries('indicator').map((h) => (
                    <li key={h.key} style={{ marginBottom: 5 }}>
                      <RichText text={h.text} onSelect={go} />
                    </li>
                  ))}
                </ul>
              </Section>
            </>
          ) : null}

          {article.links?.length ? (
            <Section title="Смотрите также">
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {article.links.map((id) => {
                  const a = helpArticle(id);
                  if (!a) return null;
                  return (
                    <button key={id} onClick={() => go(id)} style={linkStyle}>
                      {a.title}
                    </button>
                  );
                })}
              </div>
            </Section>
          ) : null}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
            {prev ? (
              <button onClick={() => go(prev.id)} style={linkStyle} title="Предыдущая статья раздела">← {prev.title}</button>
            ) : (
              <span />
            )}
            {next ? (
              <button onClick={() => go(next.id)} style={linkStyle} title="Следующая статья раздела">{next.title} →</button>
            ) : (
              <span />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
