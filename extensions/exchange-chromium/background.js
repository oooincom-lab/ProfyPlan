/* ProfyPlan exchange helper — service worker.
 * Watches a folder chosen by the user, uploads incoming packets to the portal,
 * downloads outbox packets and keeps a single lease per connection.
 */
const ALARM = 'pp-exchange-tick';
const DEFAULT_API = 'https://profyplan.ru/api/v1';
const AGENT = 'chromium-extension';

let syncing = false;

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}
function storageSet(obj) {
  return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
}
function storageRemove(keys) {
  return new Promise((resolve) => chrome.storage.local.remove(keys, resolve));
}

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('profyplan-exchange', 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('handles')) {
        req.result.createObjectStore('handles');
      }
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
async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('handles', 'readonly');
    const req = tx.objectStore('handles').get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getCfg() {
  return storageGet([
    'token', 'apiBase', 'portalOrigin', 'connectionId', 'connectionName',
    'folderName', 'enabled', 'leaseToken', 'leaseExpires', 'leaseHolder',
    'lastStatus', 'processedKeys', 'instanceId', 'sessionId'
  ]);
}

async function ensureIds() {
  const cfg = await getCfg();
  const patch = {};
  if (!cfg.instanceId) patch.instanceId = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + '-' + Math.random());
  if (!cfg.sessionId) patch.sessionId = 's-' + (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
  if (Object.keys(patch).length) await storageSet(patch);
  return { ...cfg, ...patch };
}

function apiUrl(cfg, path) {
  const base = (cfg.apiBase || DEFAULT_API).replace(/\/+$/, '');
  return base + path;
}

async function fetchJson(path, options = {}) {
  const cfg = await getCfg();
  if (!cfg.token) {
    const e = new Error('Нет токена портала — откройте ProfyPlan и войдите');
    e.code = 'no_token';
    throw e;
  }
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', 'Bearer ' + cfg.token);
  const resp = await fetch(apiUrl(cfg, path), { ...options, headers });
  const text = await resp.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { /* not json */ }
  if (!resp.ok) {
    const err = new Error((json && (json.detail?.message || json.detail)) || ('HTTP ' + resp.status));
    err.status = resp.status;
    err.json = json;
    throw err;
  }
  return json;
}

async function saveStatus(state, message, extra = {}) {
  const status = {
    state,
    message,
    at: new Date().toISOString(),
    ...extra
  };
  await storageSet({ lastStatus: status });
  return status;
}

async function clearLease() {
  await storageRemove(['leaseToken', 'leaseExpires', 'leaseHolder']);
}

async function releaseLease() {
  const cfg = await getCfg();
  if (cfg.leaseToken && cfg.connectionId) {
    try {
      await fetchJson(`/integration/connections/${cfg.connectionId}/lease`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lease_token: cfg.leaseToken })
      });
    } catch (e) { /* lease мог уже истечь */ }
  }
  await clearLease();
}

async function ensureLease() {
  const cfg = await ensureIds();
  if (!cfg.connectionId) return false;
  const now = Date.now();
  const exp = cfg.leaseExpires ? Date.parse(cfg.leaseExpires) : 0;
  if (cfg.leaseToken && exp > now + 15000) {
    try {
      const r = await fetchJson(`/integration/connections/${cfg.connectionId}/lease/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lease_token: cfg.leaseToken })
      });
      await storageSet({ leaseExpires: r.expires_at });
      return true;
    } catch (e) {
      await clearLease();
    }
  }
  try {
    const r = await fetchJson(`/integration/connections/${cfg.connectionId}/lease`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: AGENT,
        instance_id: cfg.instanceId,
        session_id: cfg.sessionId,
        ttl_seconds: 120
      })
    });
    await storageSet({
      leaseToken: r.lease_token,
      leaseExpires: r.expires_at,
      leaseHolder: r.holder
    });
    return true;
  } catch (e) {
    if (e.status === 409) {
      const holder = e.json && e.json.detail && e.json.detail.holder;
      await storageSet({ leaseHolder: holder || null });
      await saveStatus('busy', 'Обмен уже идёт на другом компьютере или в другой сессии', { holder });
    } else if (e.code === 'no_token' || e.status === 401) {
      await saveStatus('error', 'Сессия портала истекла — откройте ProfyPlan и войдите заново');
    } else {
      await saveStatus('error', 'Не удалось взять обмен: ' + (e.message || e));
    }
    return false;
  }
}

async function getDirHandle() {
  const handle = await idbGet('exchangeDir');
  if (!handle) return null;
  let permission = 'granted';
  try {
    permission = await handle.queryPermission({ mode: 'readwrite' });
  } catch (e) { /* старый браузер */ }
  return { handle, permission };
}

async function moveToProcessed(rootDir, srcDir, name, file) {
  const processed = await rootDir.getDirectoryHandle('processed', { create: true });
  const target = await processed.getFileHandle(name, { create: true });
  const writable = await target.createWritable();
  await writable.write(await file.arrayBuffer());
  await writable.close();
  await srcDir.removeEntry(name);
}

async function syncOnce() {
  if (syncing) return null;
  syncing = true;
  try {
    const cfg = await getCfg();
    if (!cfg.enabled || !cfg.connectionId || !cfg.token) {
      return await saveStatus('idle', 'Обмен не настроен: выберите подключение и папку');
    }
    const dirInfo = await getDirHandle();
    if (!dirInfo) {
      return await saveStatus('idle', 'Не выбрана папка обмена — откройте настройки расширения');
    }
    if (dirInfo.permission !== 'granted') {
      return await saveStatus('error', 'Нет доступа к папке — откройте настройки и подтвердите доступ');
    }
    const ok = await ensureLease();
    if (!ok) return null;

    const { handle: dir } = dirInfo;
    const inDir = await dir.getDirectoryHandle('in', { create: true });
    const latest = await getCfg();
    const processed = latest.processedKeys || {};
    const processedPatch = {};
    let inCount = 0;
    let outCount = 0;
    const errors = [];

    // 1. Входящие: файлы из выбранной папки → портал
    const incoming = [];
    for await (const [name, handle] of inDir.entries()) {
      if (handle.kind === 'file' && name.toLowerCase().endsWith('.json')) {
        incoming.push({ name, handle });
      }
    }
    for (const item of incoming) {
      try {
        const file = await item.handle.getFile();
        const key = item.name + '|' + file.size + '|' + file.lastModified;
        if (processed[key]) {
          await moveToProcessed(dir, inDir, item.name, file);
          continue;
        }
        const fd = new FormData();
        fd.append('file', new Blob([await file.text()], { type: 'application/json' }), item.name);
        await fetchJson(`/integration/connections/${latest.connectionId}/import-file`, {
          method: 'POST',
          body: fd
        });
        await moveToProcessed(dir, inDir, item.name, file);
        processedPatch[key] = Date.now();
        inCount += 1;
      } catch (e) {
        errors.push(item.name + ': ' + (e.message || e));
      }
    }

    // 2. Исходящие: пакеты портала → папка out
    try {
      const outbox = await fetchJson(`/integration/connections/${latest.connectionId}/outbox`);
      const outDir = await dir.getDirectoryHandle('out', { create: true });
      for (const item of outbox.items || []) {
        try {
          const resp = await fetch(apiUrl(latest, `/integration/connections/${latest.connectionId}/files/${encodeURIComponent(item.name)}`), {
            headers: { Authorization: 'Bearer ' + latest.token }
          });
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          const blob = await resp.blob();
          const fh = await outDir.getFileHandle(item.name, { create: true });
          const w = await fh.createWritable();
          await w.write(blob);
          await w.close();
          await fetchJson(`/integration/connections/${latest.connectionId}/outbox/${encodeURIComponent(item.name)}/ack`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}'
          });
          outCount += 1;
        } catch (e) {
          errors.push('out/' + item.name + ': ' + (e.message || e));
        }
      }
    } catch (e) {
      errors.push('outbox: ' + (e.message || e));
    }

    // Ограничиваем историю ключей
    const keys = Object.keys(processedPatch);
    if (keys.length) {
      const merged = { ...processed, ...processedPatch };
      const all = Object.keys(merged);
      if (all.length > 500) {
        all.sort((a, b) => merged[a] - merged[b]).slice(0, all.length - 500).forEach((k) => delete merged[k]);
      }
      await storageSet({ processedKeys: merged });
    }

    const when = new Date().toISOString();
    if (errors.length) {
      return await saveStatus('error', `Обмен с ошибками: ${errors.slice(0, 2).join('; ')}`, {
        lastSync: when, counts: { in: inCount, out: outCount }, errors: errors.slice(0, 10)
      });
    }
    return await saveStatus('ok', `Обмен выполнен: входящих ${inCount}, исходящих ${outCount}`, {
      lastSync: when, counts: { in: inCount, out: outCount }
    });
  } catch (e) {
    return await saveStatus('error', 'Ошибка обмена: ' + (e.message || e));
  } finally {
    syncing = false;
  }
}

async function getStatus() {
  const cfg = await getCfg();
  const dir = await getDirHandle().catch(() => null);
  return {
    ok: true,
    connectionId: cfg.connectionId || null,
    connectionName: cfg.connectionName || null,
    folderName: dir ? dir.handle.name : (cfg.folderName || null),
    folderPermission: dir ? dir.permission : null,
    enabled: !!cfg.enabled,
    hasToken: !!cfg.token,
    apiBase: cfg.apiBase || DEFAULT_API,
    status: cfg.lastStatus || { state: 'idle', message: 'Обмен не настроен' },
    leaseHolder: cfg.leaseHolder || null
  };
}

function ensureAlarm() {
  chrome.alarms.create(ALARM, { periodInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener((details) => {
  ensureAlarm();
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(ensureAlarm);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) syncOnce();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case 'PORTAL_TOKEN': {
        const cfg = await getCfg();
        const patch = { token: msg.token, apiBase: msg.apiBase, portalOrigin: msg.portalOrigin };
        if (cfg.token !== msg.token) {
          await clearLease();
        }
        await storageSet(patch);
        return { ok: true };
      }
      case 'SET_CONFIG': {
        const cfg = await getCfg();
        const patch = {
          apiBase: msg.apiBase || cfg.apiBase || DEFAULT_API,
          connectionId: msg.connectionId || null,
          connectionName: msg.connectionName || null,
          folderName: msg.folderName || null,
          enabled: !!msg.enabled
        };
        if (cfg.connectionId !== patch.connectionId) await clearLease();
        if (!patch.enabled) await releaseLease();
        await storageSet(patch);
        return await getStatus();
      }
      case 'GET_STATUS':
        return await getStatus();
      case 'SYNC_NOW':
        await syncOnce();
        return await getStatus();
      case 'RELEASE_LEASE':
        await releaseLease();
        return await getStatus();
      case 'OPEN_OPTIONS':
        chrome.runtime.openOptionsPage();
        return { ok: true };
      default:
        return { ok: false, error: 'unknown message' };
    }
  })().then(sendResponse).catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true;
});

ensureAlarm();
