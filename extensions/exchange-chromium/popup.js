function send(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
}
function pill(state) {
  return { ok: 'ok', busy: 'busy', error: 'error' }[state] || '';
}
async function render() {
  const st = await send({ type: 'GET_STATUS' });
  if (!st || !st.ok) {
    document.getElementById('message').textContent = 'Расширение не готово';
    return;
  }
  const s = st.status || {};
  const state = document.getElementById('state');
  state.textContent = s.state || 'idle';
  state.className = 'pill ' + pill(s.state);
  document.getElementById('message').textContent = s.message || '—';
  const bits = [];
  if (st.connectionName) bits.push(st.connectionName);
  if (st.folderName) bits.push('папка: ' + st.folderName);
  if (s.lastSync) bits.push(new Date(s.lastSync).toLocaleString('ru-RU'));
  document.getElementById('meta').textContent = bits.join(' · ');
}
document.getElementById('sync').addEventListener('click', async () => {
  document.getElementById('message').textContent = 'Обмен…';
  await send({ type: 'SYNC_NOW' });
  await render();
});
document.getElementById('options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});
render();
