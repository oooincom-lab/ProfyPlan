#!/usr/bin/env node
/**
 * Сборка веб-версии плана из канонического текста.
 *
 * Канон — `profyplan-план-реализации.md`. Веб-версия
 * (`profyplan-план-реализации.html`) собирается из него этой командой:
 *
 *     node scripts/render_plan.mjs
 *
 * Смысл: правки вносятся в один документ, веб-версия не расходится с текстом.
 * Раньше это были два независимых файла, и они разошлись (реестр сверки,
 * дефект 4.1: 10 расхождений).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'profyplan-план-реализации.md');
const OUT = join(ROOT, 'profyplan-план-реализации.html');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Разметка внутри строки: `код` и **жирный**. */
function inline(text) {
  let out = esc(text);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  return out;
}

/** Состояние пункта — по завершающему «— <состояние>». */
function splitStatus(text) {
  const m = text.match(/^(.*?)\s+—\s+([^—]{2,60})$/s);
  if (!m) return { body: text.trim(), status: null };
  const tail = m[2].trim();
  if (/^(Не начато|Отложено|Готово|Выложено|Действует|Правило|Отклонено|спецификация|правило)/i.test(tail)) {
    return { body: m[1].trim(), status: tail };
  }
  return { body: text.trim(), status: null };
}

function statusClass(status) {
  if (!status) return 'st-plain';
  if (/Не начато|Отложено/i.test(status)) return 'st-idle';
  if (/Готово частично|правило|Правило|спецификация|закреплено|Действует/i.test(status)) return 'st-part';
  if (/Готово|Выложено|Отклонено/i.test(status)) return 'st-done';
  return 'st-plain';
}

function renderTask(md) {
  let text = md.slice(2).trim();
  const { body, status } = splitStatus(text);
  const bold = body.match(/^\*\*([^*]+)\*\*\s*(.*)$/s);
  const title = bold ? bold[1].trim() : body.slice(0, 80);
  const detail = bold ? bold[2].trim() : '';
  return `  <div class="task">
    <div class="task-title">${inline(title)}</div>
    ${detail ? `<div class="task-detail">${inline(detail)}</div>` : ''}
    ${status ? `<div class="status ${statusClass(status)}">${inline(status)}</div>` : ''}
  </div>`;
}

function renderTable(rows) {
  const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const head = cells(rows[0]);
  const body = rows.slice(1).filter((r) => !/^\|[\s|:-]+\|$/.test(r.trim()));
  return `<div class="tablewrap"><table>
  <thead><tr>${head.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead>
  <tbody>${body.map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody>
</table></div>`;
}

function render(lines) {
  const out = [];
  let i = 0;
  let title = 'План реализации';
  let phaseOpen = false;
  const headings = [];

  while (i < lines.length) {
    const line = lines[i];

    if (/^#\s+/.test(line)) { title = line.replace(/^#\s+/, '').trim(); i++; continue; }

    if (/^##\s+/.test(line)) {
      if (phaseOpen) { out.push('</div>'); phaseOpen = false; }
      const text = line.replace(/^##\s+/, '').trim();
      const block = text.match(/^Блок\s+([^\s.]+)\.\s*(.*)$/);
      headings.push(text);
      if (block) {
        out.push(`<div class="phase"><div class="phase-head"><span class="tag">Блок ${inline(block[1])}</span> ${inline(block[2])}</div>`);
        phaseOpen = true;
      } else {
        out.push(`<h2>${inline(text)}</h2>`);
      }
      i++;
      continue;
    }

    if (/^###\s+/.test(line)) { out.push(`<h3>${inline(line.replace(/^###\s+/, '').trim())}</h3>`); i++; continue; }

    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
      out.push(`<div class="note">${buf.map((b) => inline(b.trim())).filter(Boolean).join('<br>')}</div>`);
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) { buf.push(lines[i]); i++; }
      out.push(`<div class="tasks">\n${buf.map(renderTask).join('\n')}\n</div>`);
      continue;
    }

    if (/^\|/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\|/.test(lines[i])) { buf.push(lines[i]); i++; }
      out.push(renderTable(buf));
      continue;
    }

    if (/^---+$/.test(line.trim())) { out.push('<hr>'); i++; continue; }
    if (!line.trim()) { i++; continue; }

    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(#|>|[-*]\s|\|)/.test(lines[i])) { buf.push(lines[i].trim()); i++; }
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }

  // закрываем блок, если документ заканчивается внутри него
  if (phaseOpen) { out.push('</div>'); phaseOpen = false; }
  return { title, headings, body: out.join('\n') };
}

function page({ title, headings, body }) {
  const styles = `
    :root{--bg:#0F1E36;--card:#16294d;--elev:#1b3157;--line:rgba(143,163,189,.22);
      --text:#E8EEF7;--muted:#8FA3BD;--accent:#3B82F6;--ok:#57C79B;--warn:#E2B341;--idle:#8FA3BD}
    *{box-sizing:border-box}
    body{margin:0;background:var(--bg);color:var(--text);
      font:15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
    .wrap{max-width:1160px;margin:0 auto;padding:36px 22px 64px}
    header.mast{border-bottom:1px solid var(--line);padding-bottom:14px;margin-bottom:8px}
    .kicker{color:var(--accent);font-size:12px;letter-spacing:.08em;text-transform:uppercase}
    h1{font-size:26px;margin:8px 0 6px}
    .meta{color:var(--muted);font-size:13px}
    h2{font-size:19px;margin:34px 0 12px;padding-bottom:8px;border-bottom:1px solid var(--line)}
    h3{font-size:16px;margin:22px 0 8px}
    p{margin:10px 0}
    .phase{margin:20px 0 8px;border-left:3px solid var(--accent);padding-left:12px}
    .phase-head{font-weight:600;font-size:16px}
    .tag{display:inline-block;background:rgba(59,130,246,.16);border:1px solid rgba(59,130,246,.4);
      color:#DBEAFE;border-radius:999px;padding:1px 9px;font-size:11.5px;margin-right:8px}
    .tasks{display:grid;gap:8px;margin:10px 0 18px}
    .task{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 13px}
    .task-title{font-weight:600}
    .task-detail{color:var(--muted);font-size:13.5px;margin-top:4px}
    .status{display:inline-block;margin-top:7px;font-size:11.5px;border-radius:999px;padding:2px 9px;border:1px solid var(--line)}
    .st-idle{color:var(--idle)} .st-part{color:var(--warn)} .st-done{color:var(--ok)} .st-plain{color:var(--muted)}
    .note{background:var(--elev);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:12px 0;color:#D7E3F4;font-size:14px}
    .tablewrap{overflow-x:auto;margin:14px 0}
    table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}
    th,td{padding:8px 10px;text-align:left;border-bottom:1px solid var(--line);font-size:13.5px;vertical-align:top}
    th{background:var(--elev);color:var(--muted);font-size:11.5px;text-transform:uppercase;letter-spacing:.04em}
    tr:last-child td{border-bottom:none}
    code{background:#0b1626;border:1px solid var(--line);border-radius:5px;padding:0 5px;font-size:12.5px}
    hr{border:none;border-top:1px solid var(--line);margin:26px 0}
    footer{margin-top:40px;border-top:1px solid var(--line);padding-top:14px;color:var(--muted);font-size:13px}
  `;
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${styles}</style>
</head>
<body>
<div class="wrap">
<header class="mast">
  <div class="kicker">ProfyPlan · план реализации</div>
  <h1>${esc(title)}</h1>
  <div class="meta">Веб-версия собрана из канонического текста плана: <code>profyplan-план-реализации.md</code>.
    Разделов: ${headings.length}. Правки вносятся в текст, затем сборка повторяется.</div>
</header>
${body}
<footer>
  Файл собран автоматически — правьте текстовый план и запускайте <code>node scripts/render_plan.mjs</code>.
  Любая правка прямо в этом файле будет потеряна при следующей сборке.
</footer>
</div>
</body>
</html>
`;
}

const lines = readFileSync(SRC, 'utf8').split(/\r?\n/);
const data = render(lines);
writeFileSync(OUT, page(data), 'utf8');
console.log(`[plan] собрано разделов: ${data.headings.length}; записано: ${OUT}`);
