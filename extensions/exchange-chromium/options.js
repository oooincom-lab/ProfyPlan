/* ProfyPlan exchange helper — options page. */
const DEFAULT_API = 'https://profyplan.ru/api/v1';

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}
function storageSet(obj) {
  return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
}
function send(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
}
function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('profyplan-exchange', 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('handles')) req.result.createObjectStore('handles');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbSet(key, value) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

const $ = (id) => document.getElementById(id);

function setMsg(text, kind = 'muted') {
  const el = $('msg');
  el.textContent = text || '';
  el.className = 'msg ' + kind;
}

async function loadConnections() {
  const cfg = await storageGet(['token', 'apiBase']);
  if (!cfg.token) {
    setMsg('Нет токена портала. Откройте ProfyPlan и войдите, затем вернитесь сюда.', 'warn');
    return;
  }
  const base = (cfg.apiBase || DEFAULT_API).replace(/\/+$/, '');
  try {
    const resp = await fetch(base + '/integration/connections', {
      headers: { Authorization: 'Bearer ' + cfg.token }
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    const items = data.items || data || [];
    const sel = $('connection');
    sel.innerHTML = '';
    for (const c of items) {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name + (c.transport ? ' · ' + c.transport : '');
      sel.appendChild(opt);
    }
    if (!items.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Подключений нет — создайте в разделе «Интеграция»';
      sel.appendChild(opt);
    }
    const saved = await storageGet(['connectionId']);
    if (saved.connectionId && items.some((c) => c.id === saved.connectionId)) {
      sel.value = saved.connectionId;
    }
    setMsg(items.length ? 'Подключения загружены' : 'В портале пока нет подключений', items.length ? 'ok' : 'warn');
  } catch (e) {
    setMsg('Не удалось загрузить подключения: ' + (e.message || e), 'err');
  }
}

async function pickFolder() {
  if (!window.showDirectoryPicker) {
    setMsg('Этот браузер не поддерживает выбор папки. Нужен Chrome, Edge, Opera или Яндекс Браузер.', 'err');
    return;
  }
  try {
    const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
    if (dir.requestPermission) {
      const perm = await dir.requestPermission({ mode: 'readwrite' });
      if (perm !== 'granted') {
        setMsg('Доступ к папке не выдан', 'err');
        return;
      }
    }
    await idbSet('exchangeDir', dir);
    $('folder').value = dir.name;
    await storageSet({ folderName: dir.name });
    setMsg('Папка выбрана: ' + dir.name, 'ok');
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    setMsg('Не удалось выбрать папку: ' + (e.message || e), 'err');
  }
}

async function loadStatus() {
  const st = await send({ type: 'GET_STATUS' });
  if (!st || !st.ok) {
    setMsg('Расширение ещё не получило токен портала', 'warn');
    return;
  }
  $('statusState').textContent = st.status?.state || 'idle';
  $('statusText').textContent = st.status?.message || '—';
  $('lastSync').textContent = st.status?.lastSync ? new Date(st.status.lastSync).toLocaleString('ru-RU') : '—';
  $('folder').value = st.folderName || $('folder').value || '';
  $('enabled').checked = !!st.enabled;
  if (st.connectionId) $('connection').value = st.connectionId;
  if (st.leaseHolder && st.status?.state === 'busy') {
    $('holder').textContent = 'Обмен держит: ' + (st.leaseHolder.agent_id || '') + ' · ' + (st.leaseHolder.instance_id || '');
  } else {
    $('holder').textContent = '';
  }
}

async function save() {
  const cfg = await storageGet(['token', 'apiBase', 'portalOrigin']);
  if (!cfg.token) {
    setMsg('Сначала войдите в ProfyPlan — расширение возьмёт токен из портала.', 'warn');
    return;
  }
  const connectionId = $('connection').value;
  const connectionName = $('connection').selectedOptions?.[0]?.textContent || '';
  const enabled = $('enabled').checked;
  if (enabled && !$('folder').value) {
    setMsg('Сначала выберите папку обмена.', 'err');
    return;
  }
  const st = await send({
    type: 'SET_CONFIG',
    apiBase: cfg.apiBase || DEFAULT_API,
    connectionId,
    connectionName,
    folderName: $('folder').value || null,
    enabled
  });
  setMsg(st && st.ok ? 'Настройки сохранены' : 'Не удалось сохранить настройки', st && st.ok ? 'ok' : 'err');
  await loadStatus();
}

async function syncNow() {
  setMsg('Обмен…', 'muted');
  const st = await send({ type: 'SYNC_NOW' });
  if (st && st.ok) setMsg(st.status?.message || 'Готово', st.status?.state === 'error' ? 'err' : 'ok');
  else setMsg('Не удалось выполнить обмен', 'err');
  await loadStatus();
}

document.addEventListener('DOMContentLoaded', async () => {
  $('refresh').addEventListener('click', loadConnections);
  $('pickFolder').addEventListener('click', pickFolder);
  $('save').addEventListener('click', save);
  $('syncNow').addEventListener('click', syncNow);
  $('openPortal').addEventListener('click', async () => {
    const cfg = await storageGet(['portalOrigin']);
    chrome.tabs.create({ url: (cfg.portalOrigin || 'https://profyplan.ru') + '/workspace' });
  });
  await loadConnections();
  await loadStatus();
});
