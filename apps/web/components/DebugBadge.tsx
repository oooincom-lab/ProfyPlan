'use client';

import { useState } from 'react';
import type { MouseEvent } from 'react';

/**
 * 🧪 Технический идентификатор окна/формы (режим отладки).
 * Виден только при debug=true. Клик по бейджу копирует полный идентификатор
 * в буфер — удобно вставлять в описание проблемы.
 */
export default function DebugBadge({
  text,
  copy,
  debug = false,
  corner = false,
}: {
  /** Короткая подпись в бейдже, напр. [order:openWin #2] */
  text: string;
  /** Полный текст для копирования (по умолчанию = text) */
  copy?: string;
  debug?: boolean;
  /** Позиционировать поверх контейнера (угол карточки/области) */
  corner?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  if (!debug) return null;
  const id = copy || text;
  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.preventDefault();
    const doCopy = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(id).then(doCopy).catch(doCopy);
      } else {
        const ta = document.createElement('textarea');
        ta.value = id;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch { /* noop */ }
        document.body.removeChild(ta);
        doCopy();
      }
    } catch {
      doCopy();
    }
  };
  return (
    <button
      type="button"
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
      title={'Скопировать идентификатор: ' + id}
      style={{
        background: 'rgba(148,163,184,.12)',
        border: '1px dashed rgba(148,163,184,.45)',
        color: copied ? '#4ADE80' : '#94A3B8',
        borderRadius: 5,
        padding: '1px 7px',
        fontSize: 10.5,
        fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
        cursor: 'copy',
        flexShrink: 0,
        whiteSpace: 'nowrap',
        lineHeight: '16px',
        maxWidth: 260,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        display: 'inline-block',
        ...(corner ? { position: 'absolute' as const, top: 5, right: 5, zIndex: 9 } : {}),
      }}
    >
      {copied ? '✓ скопировано' : text}
    </button>
  );
}