/* ProfyPlan exchange helper — content script.
 * Reads the portal JWT from localStorage and passes it to the service worker.
 * The extension never asks for the password.
 */
(function () {
  let lastToken = null;

  function apiBaseFor(host) {
    if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:8000/v1';
    return 'https://profyplan.ru/api/v1';
  }

  function tick() {
    try {
      const token = window.localStorage.getItem('profyplan_token');
      if (!token || token === lastToken) return;
      lastToken = token;
      chrome.runtime.sendMessage({
        type: 'PORTAL_TOKEN',
        token,
        apiBase: apiBaseFor(window.location.hostname),
        portalOrigin: window.location.origin
      });
    } catch (e) {
      /* страница может быть в переходном состоянии — повторим на следующем тике */
    }
  }

  tick();
  window.setInterval(tick, 5000);
})();
