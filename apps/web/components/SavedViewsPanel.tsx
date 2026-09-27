'use client';
/**
 * Реестр сохранённых видов (блок 6.13а) — панель управления сохранениями
 * сетевого графика: сохранить текущее состояние как вид, список видов, применить
 * вид одним действием, переименовать, удалить с подтверждением, выгрузить в файл,
 * загрузить из файла, поделиться общим видом и посмотреть журнал изменений.
 *
 * Сервер — источник истины. Если сервер недоступен, реестр переходит в локальный
 * резерв: виды остаются в браузере и помечаются «только локально». У каждого
 * действия есть контекстная справка «что делает / на что влияет / значение по
 * умолчанию / как вернуть».
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AppModal from './AppModal';
import {
  applyGraphState,
  buildEnvelopeFromGraph,
  captureGraphState,
  createSavedView,
  copySavedView,
  deleteSavedView,
  exportSavedViews,
  getSavedView,
  getSavedViewLog,
  graphStateFromEnvelope,
  importSavedViews,
  listSavedViews,
  loadLastApplied,
  loadLocalViews,
  localCreateView,
  localDeleteView,
  localRenameView,
  renameSavedView,
  saveLastApplied,
  saveIntoView,
  SavedViewsError,
  shareSavedView,
  unshareSavedView,
  type SavedViewLimit,
  type SavedViewLogItem,
  type SavedViewRow,
  type ViewEnvelope,
} from '@/lib/savedViews';

interface Props {
  projectId: string | null;
  projectName?: string | null;
  onClose: () => void;
}

interface HelpEntry { what: string; affects: string; def: string; back: string }
interface Notice { kind: 'ok' | 'warn' | 'err'; text: string }

const HELP: Record<string, HelpEntry> = {
  save: {
    what: 'Сохраняет текущее состояние сетевого графика как новый именованный вид.',
    affects: 'Раскладку, режим укладки, единицу, границы периода, масштаб, показ только критического пути, «Старт/Финиш», «Дни на связях» и ручные позиции узлов.',
    def: 'Имя вида обязательно; тип — личный вид. Лимит числа видов задаётся настройкой views.saved_limit (по умолчанию 10).',
    back: 'Удалить ненужный вид, выгрузить его в файл или применить другой вид — состояние переключится одним действием.',
  },
  list: {
    what: 'Показывает виды проекта: свои и общие виды других участников.',
    affects: 'Ни на что не влияет — это только список; изменения начинаются с кнопок строки.',
    def: 'Свежие виды сверху. Пометка «на сервере» / «только локально» показывает, где лежит вид.',
    back: 'Обновить список кнопкой «Обновить»; строка «применён» отмечает последний применённый вид.',
  },
  apply: {
    what: 'Возвращает рабочее поле в сохранённое состояние одним действием.',
    affects: 'Раскладку, режим, единицу, границы периода, масштаб, показ критического пути и ручные позиции узлов.',
    def: 'Применяется как есть; рабочие данные проекта не изменяются.',
    back: 'Применить другой вид или выставить настройки графика вручную; применить «Свежий вид» — вернуть исходную раскладку.',
  },
  save_into: {
    what: 'Перезаписывает содержимое существующего вида текущим состоянием.',
    affects: 'Хранимый снимок настроек вида — вместо прежнего. Имя и доступ не меняются.',
    def: 'Доступно владельцу личного вида и всем, у кого вид общий со статусом «изменение».',
    back: 'Отменить перезапись нельзя — заранее выгрузите вид в файл, если снимок нужен как эталон.',
  },
  rename: {
    what: 'Меняет имя вида.',
    affects: 'Только подпись вида; содержимое и доступ не меняются.',
    def: 'Имя уникально среди своих видов проекта (без учёта регистра).',
    back: 'Переименовать обратно; имя «(копия)» сервер предлагает сам при конфликте импорта.',
  },
  delete: {
    what: 'Удаляет вид.',
    affects: 'Вид исчезает из реестра и освобождает место в лимите. Общие виды других участников удалить нельзя.',
    def: 'Удаление требует подтверждения — спрашивается в модалке, не молча.',
    back: 'Восстановить удалённый вид нельзя; если он нужен — заранее выгрузите его в файл.',
  },
  export: {
    what: 'Выгружает вид (или все доступные) в файл JSON.',
    affects: 'Ничего не меняет на сервере; выгрузка общего вида отмечается в его журнале.',
    def: 'Файл содержит версию схемы и содержимое; годится для переноса и резерва.',
    back: 'Загрузить файл обратно кнопкой «Импорт из файла».',
  },
  import: {
    what: 'Загружает виды из файла JSON, добавляя их личными видами.',
    affects: 'Увеличивает число сохранённых видов и расходует лимит.',
    def: 'При совпадении имени импорт отказывает и предлагает переименование («имя (копия)»).',
    back: 'Загруженные виды удаляются как обычные личные виды.',
  },
  share: {
    what: 'Делает свой вид общим для участников проекта.',
    affects: 'Другие применяют вид; со статусом «чтение» сохраняет только владелец, со статусом «изменение» — все с записью в журнал.',
    def: 'Общим может быть ровно один свой вид в проекте.',
    back: 'Кнопка «Вернуть в личные» (unshare) снимает общий доступ.',
  },
  copy: {
    what: '«Сохранить как свой» — ответвляет личную копию от вида (в т.ч. общего).',
    affects: 'Создаёт новый личный вид, расходуя лимит; исходный вид не меняется.',
    def: 'Имя копии формируется сервером: «имя (копия)», «(копия 2)»…',
    back: 'Копия — обычный личный вид: переименовать или удалить.',
  },
  log: {
    what: 'Показывает журнал изменений вида: кто, когда и что делал.',
    affects: 'Только чтение.',
    def: 'Ведётся для общих видов; показываются последние записи.',
    back: 'Закрыть журнал — список видов остаётся под ним.',
  },
  limit: {
    what: 'Лимит числа ваших сохранённых видов в проекте.',
    affects: 'При исчерпании лимита создание и импорт отклоняются с пояснением; молчаливой перезаписи нет.',
    def: 'Настройка views.saved_limit по умолчанию 10; наследуется системой → рабочим столом → проектом → группой → кластером.',
    back: 'Удалите ненужный вид или выгрузите его в файл и повторите сохранение.',
  },
};

function HelpButton({ id, openId, onToggle }: { id: string; openId: string | null; onToggle: (id: string) => void }) {
  return (
    <button
      type="button"
      className="sv-help-btn"
      aria-label="Контекстная справка"
      title="Что делает · на что влияет · значение по умолчанию · как вернуть"
      onClick={() => onToggle(id)}
    >{openId === id ? '×' : '?'}</button>
  );
}

function HintBox({ entry }: { entry: HelpEntry }) {
  return (
    <div className="sv-help-box">
      <div><b>Что делает:</b> {entry.what}</div>
      <div><b>На что влияет:</b> {entry.affects}</div>
      <div><b>Значение по умолчанию:</b> {entry.def}</div>
      <div><b>Как вернуть:</b> {entry.back}</div>
    </div>
  );
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const ACTION_LABELS: Record<string, string> = {
  create: 'создан', save: 'сохранён', rename: 'переименован', share: 'сделан общим',
  unshare: 'возвращён в личные', copy: 'скопирован', delete: 'удалён', import: 'импортирован', export: 'выгружен',
};

function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function SavedViewsPanel({ projectId, projectName, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<SavedViewRow[]>([]);
  const [limit, setLimit] = useState<SavedViewLimit | null>(null);
  const [mySharedId, setMySharedId] = useState<string | null>(null);
  const [storage, setStorage] = useState<'server' | 'local'>('server');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [helpId, setHelpId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [logView, setLogView] = useState<{ id: string; name: string } | null>(null);
  const [logItems, setLogItems] = useState<SavedViewLogItem[] | null>(null);
  const [pendingImport, setPendingImport] = useState<{ payload: any; suggestions: Record<string, string> } | null>(null);
  const [lastAppliedId, setLastAppliedId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setNotice(null);
    try {
      const data = await listSavedViews(projectId);
      setItems(data.items);
      setLimit(data.limit);
      setMySharedId(data.my_shared_view_id);
      setStorage('server');
    } catch (e) {
      const rows = loadLocalViews(projectId);
      setItems(rows);
      setLimit({ key: 'views.saved_limit', value: 10, source: 'local', source_label: 'локальный резерв', used: rows.length, remaining: Math.max(0, 10 - rows.length) });
      setMySharedId(null);
      setStorage('local');
      setNotice({ kind: 'warn', text: 'Сервер недоступен — реестр работает в локальном резерве: виды хранятся только в этом браузере.' });
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!projectId) return;
    const la = loadLastApplied(projectId);
    setLastAppliedId(la ? la.id : null);
  }, [projectId]);

  const limitReached = !!limit && limit.remaining <= 0;

  const toggleHelp = useCallback((id: string) => {
    setHelpId((cur) => (cur === id ? null : id));
  }, []);

  /* ── сохранить текущее состояние как новый вид ── */
  const onSaveCurrent = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) { setNotice({ kind: 'err', text: 'Укажите имя вида.' }); return; }
    if (!projectId) { setNotice({ kind: 'err', text: 'Проект не выбран.' }); return; }
    if (limitReached) {
      setNotice({ kind: 'warn', text: `Лимит сохранённых видов исчерпан: ${limit!.used} из ${limit!.value}. Удалите ненужный вид или выгрузите его в файл.` });
      return;
    }
    setBusy(true);
    try {
      const state = await captureGraphState();
      if (!state) {
        setNotice({ kind: 'warn', text: 'Не удалось снять состояние сетевого графика: откройте сеть CPM и повторите.' });
        return;
      }
      const envelope: ViewEnvelope = buildEnvelopeFromGraph(state);
      if (storage === 'local') {
        localCreateView(projectId, trimmed, envelope);
        setName('');
        await refresh();
        setNotice({ kind: 'ok', text: `Вид «${trimmed}» сохранён локально (сервер недоступен).` });
        return;
      }
      try {
        await createSavedView(projectId, trimmed, envelope);
        setName('');
        setNotice({ kind: 'ok', text: `Вид «${trimmed}» сохранён на сервере.` });
        await refresh();
      } catch (e) {
        const err = e as SavedViewsError;
        if (err.code === 'view_limit_reached') {
          setNotice({ kind: 'warn', text: err.message });
        } else if (err.code === 'view_name_taken') {
          setNotice({ kind: 'err', text: err.message });
        } else if (err.code === 'network_error') {
          localCreateView(projectId, trimmed, envelope);
          setName('');
          await refresh();
          setNotice({ kind: 'warn', text: `Сервер стал недоступен — вид «${trimmed}» сохранён локально.` });
        } else {
          setNotice({ kind: 'err', text: err.message });
        }
      }
    } finally {
      setBusy(false);
    }
  }, [name, projectId, limitReached, limit, storage, refresh]);

  /* ── применить вид ── */
  const onApply = useCallback(async (row: SavedViewRow) => {
    if (!projectId) return;
    setBusy(true);
    try {
      let envelope: ViewEnvelope | null = null;
      if (row.storage === 'local') {
        envelope = row.content || null;
      } else {
        try {
          const res = await getSavedView(row.id);
          envelope = res.content;
        } catch (e) {
          if ((e as SavedViewsError).code === 'network_error') {
            const local = loadLocalViews(projectId).find((r) => r.id === row.id);
            envelope = local?.content || null;
          } else {
            throw e;
          }
        }
      }
      const state = graphStateFromEnvelope(envelope);
      if (!state) { setNotice({ kind: 'warn', text: 'В виде нет настроек сетевого графика.' }); return; }
      applyGraphState(state);
      saveLastApplied(projectId, row.id, row.name);
      setLastAppliedId(row.id);
      setNotice({ kind: 'ok', text: `Вид «${row.name}» применён.` });
    } catch (e) {
      setNotice({ kind: 'err', text: (e as SavedViewsError).message });
    } finally {
      setBusy(false);
    }
  }, [projectId]);

  /* ── сохранить в существующий вид ── */
  const onSaveInto = useCallback(async (row: SavedViewRow) => {
    if (!projectId || row.storage === 'local') return;
    setBusy(true);
    try {
      const state = await captureGraphState();
      if (!state) { setNotice({ kind: 'warn', text: 'Не удалось снять состояние сетевого графика.' }); return; }
      const envelope = buildEnvelopeFromGraph(state);
      await saveIntoView(row.id, envelope);
      setNotice({ kind: 'ok', text: `Состояние записано в вид «${row.name}».` });
      await refresh();
    } catch (e) {
      setNotice({ kind: 'err', text: (e as SavedViewsError).message });
    } finally {
      setBusy(false);
    }
  }, [projectId, refresh]);

  /* ── переименовать ── */
  const onRename = useCallback(async (row: SavedViewRow) => {
    const trimmed = renameText.trim();
    if (!trimmed) { setNotice({ kind: 'err', text: 'Имя вида не может быть пустым.' }); return; }
    setBusy(true);
    try {
      if (row.storage === 'local' && projectId) {
        localRenameView(projectId, row.id, trimmed);
      } else {
        await renameSavedView(row.id, trimmed);
      }
      setRenameId(null);
      setRenameText('');
      await refresh();
      setNotice({ kind: 'ok', text: `Вид переименован в «${trimmed}».` });
    } catch (e) {
      setNotice({ kind: 'err', text: (e as SavedViewsError).message });
    } finally {
      setBusy(false);
    }
  }, [renameText, projectId, refresh]);

  /* ── удалить ── */
  const onDelete = useCallback(async (row: SavedViewRow) => {
    setBusy(true);
    try {
      if (row.storage === 'local' && projectId) {
        localDeleteView(projectId, row.id);
      } else {
        await deleteSavedView(row.id);
      }
      setConfirmId(null);
      await refresh();
      setNotice({ kind: 'ok', text: `Вид «${row.name}» удалён.` });
    } catch (e) {
      setNotice({ kind: 'err', text: (e as SavedViewsError).message });
    } finally {
      setBusy(false);
    }
  }, [projectId, refresh]);

  /* ── поделиться / вернуть в личные / копия ── */
  const onShare = useCallback(async (row: SavedViewRow, mode: 'read' | 'write') => {
    setBusy(true);
    try {
      await shareSavedView(row.id, mode);
      await refresh();
      setNotice({ kind: 'ok', text: `Вид «${row.name}» сделан общим (${mode === 'write' ? 'изменение' : 'чтение'}).` });
    } catch (e) {
      const err = e as SavedViewsError;
      if (err.code === 'shared_view_limit') {
        setNotice({ kind: 'warn', text: err.message });
      } else {
        setNotice({ kind: 'err', text: err.message });
      }
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const onUnshare = useCallback(async (row: SavedViewRow) => {
    setBusy(true);
    try {
      await unshareSavedView(row.id);
      await refresh();
      setNotice({ kind: 'ok', text: `Вид «${row.name}» возвращён в личные.` });
    } catch (e) {
      setNotice({ kind: 'err', text: (e as SavedViewsError).message });
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const onCopy = useCallback(async (row: SavedViewRow) => {
    setBusy(true);
    try {
      const res = await copySavedView(row.id);
      await refresh();
      setNotice({ kind: 'ok', text: `Создана личная копия: «${res.item?.name || row.name}».` });
    } catch (e) {
      const err = e as SavedViewsError;
      if (err.code === 'view_limit_reached') setNotice({ kind: 'warn', text: err.message });
      else setNotice({ kind: 'err', text: err.message });
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  /* ── экспорт / импорт ── */
  const onExport = useCallback(async (rows?: SavedViewRow[]) => {
    if (!projectId) return;
    setBusy(true);
    try {
      const ids = rows ? rows.filter((r) => r.storage === 'server').map((r) => r.id) : undefined;
      if (rows && (!ids || ids.length === 0)) {
        setNotice({ kind: 'warn', text: 'Локальный вид нельзя выгрузить через сервер — сервер недоступен.' });
        return;
      }
      const data = await exportSavedViews(projectId, ids);
      const base = rows && rows.length === 1 ? rows[0].name.replace(/[^\wа-яА-ЯёЁ\- ]/g, '').trim() || 'view' : 'saved-views';
      downloadJson(`${base || 'saved-views'}.json`, data);
      setNotice({ kind: 'ok', text: `Выгружено видов: ${data?.count ?? 0}.` });
    } catch (e) {
      setNotice({ kind: 'err', text: (e as SavedViewsError).message });
    } finally {
      setBusy(false);
    }
  }, [projectId]);

  const runImport = useCallback(async (payload: any, renames?: Record<string, string>) => {
    if (!projectId) return;
    setBusy(true);
    try {
      const res = await importSavedViews(projectId, payload, renames);
      setPendingImport(null);
      await refresh();
      setNotice({ kind: 'ok', text: `Загружено видов: ${res.created.length}.` });
    } catch (e) {
      const err = e as SavedViewsError;
      if (err.code === 'view_name_conflict' && err.detail) {
        setPendingImport({ payload, suggestions: err.detail.suggestions || {} });
        const names = (err.detail.conflicts || []).join('», «');
        setNotice({ kind: 'warn', text: `Имена уже заняты: «${names}». Можно загрузить с автоматическим переименованием.` });
      } else if (err.code === 'view_limit_reached') {
        setNotice({ kind: 'warn', text: err.message });
      } else {
        setNotice({ kind: 'err', text: err.message });
      }
    } finally {
      setBusy(false);
    }
  }, [projectId, refresh]);

  const onFilePicked = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      await runImport(payload);
    } catch {
      setNotice({ kind: 'err', text: 'Не удалось прочитать файл: ожидается JSON выгрузки видов.' });
    }
  }, [runImport]);

  /* ── журнал ── */
  const onOpenLog = useCallback(async (row: SavedViewRow) => {
    if (row.storage === 'local') {
      setLogView({ id: row.id, name: row.name });
      setLogItems([]);
      return;
    }
    setLogView({ id: row.id, name: row.name });
    setLogItems(null);
    try {
      const res = await getSavedViewLog(row.id);
      setLogItems(res.items);
    } catch (e) {
      setLogItems([]);
      setNotice({ kind: 'err', text: (e as SavedViewsError).message });
    }
  }, []);

  const sectionsLabel = useMemo(() => ({ cpm: 'сетевой график', gantt: 'Гант', pools: 'кластеры', general: 'общее' } as Record<string, string>), []);

  return (
    <AppModal
      title={`Виды · реестр сохранений${projectName ? ' · ' + projectName : ''}`}
      width={840}
      accent="var(--accent)"
      onClose={onClose}
    >
      <div className="sv">
        <style>{`
          .sv{display:flex;flex-direction:column;gap:12px;font-size:12.5px;color:var(--fg)}
          .sv-row{display:flex;gap:8px;align-items:center}
          .sv-grow{flex:1;min-width:0}
          .sv-input{width:100%;background:var(--bg-3);border:1px solid var(--border-2);border-radius:8px;color:var(--fg);padding:7px 10px;font-size:12.5px;font-family:inherit}
          .sv-input::placeholder{color:var(--fg-4)}
          .sv-input:focus{outline:none;border-color:var(--accent)}
          .sv-btn{border:1px solid var(--border-2);background:transparent;color:var(--fg-2);border-radius:8px;padding:7px 14px;font-size:12.5px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap}
          .sv-btn:hover:not(:disabled){border-color:var(--accent);color:var(--accent-3)}
          .sv-btn:disabled{opacity:.5;cursor:not-allowed}
          .sv-btn-primary{background:var(--accent);border-color:var(--accent);color:#fff}
          .sv-btn-primary:hover:not(:disabled){background:var(--accent-2);border-color:var(--accent-2);color:#fff}
          .sv-btn-sm{border:1px solid var(--border-2);background:transparent;color:var(--fg-2);border-radius:7px;padding:4px 9px;font-size:11px;cursor:pointer;font-family:inherit;white-space:nowrap}
          .sv-btn-sm:hover:not(:disabled){border-color:var(--accent);color:var(--accent-3)}
          .sv-btn-sm:disabled{opacity:.5;cursor:not-allowed}
          .sv-btn-danger{color:var(--danger);border-color:var(--danger)}
          .sv-btn-danger:hover:not(:disabled){color:var(--danger);border-color:var(--danger)}
          .sv-help-btn{width:18px;height:18px;border-radius:50%;border:1px solid var(--border-2);background:transparent;color:var(--fg-3);font-size:11px;line-height:1;cursor:pointer;padding:0;font-family:inherit}
          .sv-help-btn:hover{border-color:var(--accent);color:var(--accent-3)}
          .sv-help-box{background:var(--bg-3);border:1px solid var(--border-2);border-radius:8px;padding:8px 10px;font-size:11.5px;color:var(--fg-2);display:flex;flex-direction:column;gap:3px}
          .sv-banner{border-radius:8px;padding:8px 10px;font-size:12px;background:var(--bg-3);border:1px solid var(--border-2);border-left-width:3px}
          .sv-banner.ok{border-left-color:var(--success)}
          .sv-banner.warn{border-left-color:var(--warning)}
          .sv-banner.err{border-left-color:var(--danger)}
          .sv-lim{display:flex;flex-direction:column;gap:5px}
          .sv-lim-hdr{display:flex;gap:8px;align-items:center;font-size:11.5px;color:var(--fg-3)}
          .sv-bar{height:6px;border-radius:3px;background:var(--border);overflow:hidden}
          .sv-bar i{display:block;height:100%;background:var(--accent)}
          .sv-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--border);border-bottom:1px solid var(--border);padding:8px 0}
          .sv-badge{font-size:10px;border-radius:5px;padding:1px 7px;border:1px solid var(--border-2);color:var(--fg-3);white-space:nowrap}
          .sv-badge.server{border-color:var(--success);color:var(--success)}
          .sv-badge.local{border-color:var(--warning);color:var(--warning)}
          .sv-badge.shared{border-color:var(--accent);color:var(--accent-3)}
          .sv-badge.applied{border-color:var(--accent);color:var(--accent-3)}
          .sv-list{display:flex;flex-direction:column;gap:8px;max-height:44vh;overflow:auto;padding-right:2px}
          .sv-item{display:flex;flex-direction:column;gap:7px;background:var(--bg-2);border:1px solid var(--border);border-radius:10px;padding:10px 12px}
          .sv-item.applied{border-color:var(--accent)}
          .sv-item-hdr{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
          .sv-name{font-weight:600;font-size:13px;color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
          .sv-meta{color:var(--fg-3);font-size:11px}
          .sv-acts{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
          .sv-empty{color:var(--fg-4);font-size:12px;padding:14px;text-align:center;border:1px dashed var(--border-2);border-radius:10px}
          .sv-log{background:var(--bg-2);border:1px solid var(--border);border-radius:10px;padding:10px 12px;max-height:26vh;overflow:auto}
          .sv-log-row{display:flex;gap:8px;font-size:11.5px;color:var(--fg-2);padding:3px 0;border-bottom:1px solid var(--border)}
          .sv-log-row:last-child{border-bottom:none}
          .sv-log-at{color:var(--fg-4);font-family:'IBM Plex Mono',monospace;white-space:nowrap}
        `}</style>

        {!projectId && (
          <div className="sv-banner warn">Проект не выбран. Откройте проект и перейдите к сети CPM, чтобы работать с видами.</div>
        )}

        {notice && <div className={`sv-banner ${notice.kind}`}>{notice.text}</div>}

        {/* Сохранить текущее состояние */}
        <div className="sv-row">
          <input
            className="sv-input"
            placeholder="Имя нового вида, например «План по слоям — печать»"
            value={name}
            disabled={!projectId || busy}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void onSaveCurrent(); }}
          />
          <button className="sv-btn sv-btn-primary" disabled={!projectId || busy || limitReached} onClick={() => void onSaveCurrent()}>
            💾 Сохранить текущее состояние
          </button>
          <HelpButton id="save" openId={helpId} onToggle={toggleHelp} />
        </div>
        {helpId === 'save' && <HintBox entry={HELP.save} />}
        {limitReached && (
          <div className="sv-banner warn">
            Лимит сохранённых видов исчерпан: {limit!.used} из {limit!.value}. Удалите ненужный вид или выгрузите его в файл, затем повторите сохранение.
          </div>
        )}

        {/* Лимит */}
        <div className="sv-lim">
          <div className="sv-lim-hdr">
            <span>
              Видов: <b style={{ color: 'var(--fg-2)' }}>{limit ? `${limit.used} из ${limit.value}` : '—'}</b>
              {limit ? ` · источник лимита — ${limit.source_label}` : ''}
            </span>
            <span className="sv-grow" />
            <HelpButton id="limit" openId={helpId} onToggle={toggleHelp} />
          </div>
          {limit && (
            <div className="sv-bar"><i style={{ width: `${limit.value > 0 ? Math.min(100, Math.round((limit.used / limit.value) * 100)) : 0}%` }} /></div>
          )}
        </div>
        {helpId === 'limit' && <HintBox entry={HELP.limit} />}

        {/* Панель инструментов реестра */}
        <div className="sv-tools">
          <button className="sv-btn" disabled={!projectId || busy} onClick={() => void refresh()}>↻ Обновить</button>
          <button className="sv-btn" disabled={!projectId || busy || storage === 'local'} onClick={() => void onExport()}>⭳ Экспорт всех</button>
          <button className="sv-btn" disabled={!projectId || busy || storage === 'local'} onClick={() => fileRef.current?.click()}>⭱ Импорт из файла</button>
          <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={(e) => void onFilePicked(e)} />
          <span className="sv-grow" />
          <span className={`sv-badge ${storage === 'server' ? 'server' : 'local'}`}>
            {storage === 'server' ? 'реестр на сервере' : 'реестр только локально'}
          </span>
          <HelpButton id="list" openId={helpId} onToggle={toggleHelp} />
        </div>
        {helpId === 'list' && <HintBox entry={HELP.list} />}

        {pendingImport && (
          <div className="sv-banner warn">
            Часть имён занята. Загрузить с автоматическим переименованием?
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="sv-btn sv-btn-primary" disabled={busy} onClick={() => void runImport(pendingImport.payload, pendingImport.suggestions)}>Загрузить с переименованием</button>
              <button className="sv-btn" disabled={busy} onClick={() => setPendingImport(null)}>Отмена</button>
            </div>
          </div>
        )}

        {/* Список видов */}
        {loading && <div className="sv-empty">Загрузка видов…</div>}
        {!loading && items.length === 0 && (
          <div className="sv-empty">Сохранённых видов нет. Настройте сетевой график и нажмите «Сохранить текущее состояние».</div>
        )}
        {!loading && items.length > 0 && (
          <div className="sv-list">
            {items.map((row) => {
              const applied = lastAppliedId === row.id;
              const isMyShared = row.is_own && row.kind === 'shared';
              const sharedRow = row.kind === 'shared';
              return (
                <div key={row.id} className={`sv-item${applied ? ' applied' : ''}`}>
                  <div className="sv-item-hdr">
                    <span className="sv-name" title={row.name}>{row.name}</span>
                    <span className={`sv-badge ${row.storage === 'server' ? 'server' : 'local'}`}>
                      {row.storage === 'server' ? 'на сервере' : 'только локально'}
                    </span>
                    <span className="sv-badge">{row.status}</span>
                    {row.imported && <span className="sv-badge">импорт</span>}
                    {applied && <span className="sv-badge applied">применён</span>}
                    <span className="sv-grow" />
                    <button
                      className="sv-btn-sm sv-btn-danger"
                      disabled={busy || !row.can_manage}
                      title={row.can_manage ? 'Удалить вид' : 'Удалить может только автор'}
                      onClick={() => setConfirmId(row.id)}
                    >Удалить</button>
                  </div>

                  <div className="sv-meta">
                    Автор: {row.owner_name || (row.is_own ? 'вы' : '—')} · разделы: {row.sections.length ? row.sections.map((s) => sectionsLabel[s] || s).join(', ') : '—'} · ручных позиций узлов: {row.node_positions} · изменён: {fmtDate(row.updated_at)}
                  </div>

                  {renameId === row.id ? (
                    <div className="sv-row">
                      <input className="sv-input" value={renameText} autoFocus disabled={busy}
                        onChange={(e) => setRenameText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') void onRename(row); if (e.key === 'Escape') setRenameId(null); }} />
                      <button className="sv-btn sv-btn-primary" disabled={busy} onClick={() => void onRename(row)}>Сохранить</button>
                      <button className="sv-btn" disabled={busy} onClick={() => { setRenameId(null); setRenameText(''); }}>Отмена</button>
                    </div>
                  ) : (
                    <div className="sv-acts">
                      <button className="sv-btn-sm" disabled={busy} title="Применить вид к рабочему полю" onClick={() => void onApply(row)}>✓ Применить</button>
                      <button className="sv-btn-sm" disabled={busy || !row.can_write || row.storage === 'local'} title="Записать текущее состояние в этот вид" onClick={() => void onSaveInto(row)}>💾 Сохранить в этот вид</button>
                      <button className="sv-btn-sm" disabled={busy || !row.can_manage} title="Переименовать" onClick={() => { setRenameId(row.id); setRenameText(row.name); }}>✎ Переименовать</button>
                      <button className="sv-btn-sm" disabled={busy || row.storage === 'local'} title="Выгрузить этот вид в файл" onClick={() => void onExport([row])}>⭳ Экспорт</button>
                      <button className="sv-btn-sm" disabled={busy || row.storage === 'local'} title="Показать журнал изменений" onClick={() => void onOpenLog(row)}>🕓 Журнал</button>
                      {row.is_own && !sharedRow && (
                        <>
                          <button className="sv-btn-sm" disabled={busy} title="Сделать вид общим (только чтение)" onClick={() => void onShare(row, 'read')}>Общий · чтение</button>
                          <button className="sv-btn-sm" disabled={busy} title="Сделать вид общим (изменение всеми)" onClick={() => void onShare(row, 'write')}>Общий · изменение</button>
                        </>
                      )}
                      {isMyShared && (
                        <button className="sv-btn-sm" disabled={busy} title="Вернуть вид в личные" onClick={() => void onUnshare(row)}>Вернуть в личные</button>
                      )}
                      {!row.is_own && (
                        <button className="sv-btn-sm" disabled={busy} title="Сохранить как свою личную копию" onClick={() => void onCopy(row)}>Сохранить как свой</button>
                      )}
                    </div>
                  )}

                  {confirmId === row.id && (
                    <div className="sv-banner err">
                      Удалить вид «{row.name}»? Восстановить его нельзя — при необходимости сначала выгрузите в файл.
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <button className="sv-btn sv-btn-danger" disabled={busy} onClick={() => void onDelete(row)}>Удалить</button>
                        <button className="sv-btn" disabled={busy} onClick={() => setConfirmId(null)}>Отмена</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Контекстные справки для строк-действий */}
        {(helpId && ['apply', 'save_into', 'rename', 'delete', 'export', 'import', 'share', 'copy', 'log'].includes(helpId)) && (
          <HintBox entry={HELP[helpId]} />
        )}
        <div className="sv-row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span className="sv-meta">Справка:</span>
          {(['apply', 'save_into', 'rename', 'delete', 'export', 'import', 'share', 'copy', 'log'] as const).map((id) => (
            <button key={id} className="sv-btn-sm" onClick={() => toggleHelp(id)}>{helpId === id ? '×' : '?'} {{
              apply: 'Применить', save_into: 'Сохранить в вид', rename: 'Переименовать', delete: 'Удалить',
              export: 'Экспорт', import: 'Импорт', share: 'Общий вид', copy: 'Копия', log: 'Журнал',
            }[id]}</button>
          ))}
        </div>

        {/* Журнал изменений */}
        {logView && (
          <div className="sv-log">
            <div className="sv-row" style={{ marginBottom: 6 }}>
              <b style={{ color: 'var(--fg-2)' }}>Журнал вида «{logView.name}»</b>
              <span className="sv-grow" />
              <button className="sv-btn-sm" onClick={() => { setLogView(null); setLogItems(null); }}>Закрыть</button>
            </div>
            {logItems === null && <div className="sv-meta">Загрузка журнала…</div>}
            {logItems && logItems.length === 0 && (
              <div className="sv-meta">{storage === 'local' ? 'Журнал ведётся для серверных общих видов.' : 'Записей нет.'}</div>
            )}
            {logItems && logItems.map((l) => (
              <div key={l.id} className="sv-log-row">
                <span className="sv-log-at">{fmtDate(l.at)}</span>
                <span>{ACTION_LABELS[l.action] || l.action}</span>
                <span className="sv-grow" />
                <span className="sv-meta">{l.user_name || '—'}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppModal>
  );
}
