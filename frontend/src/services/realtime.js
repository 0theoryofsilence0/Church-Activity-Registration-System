// Simple SSE client for the app. Connects to /api/events and dispatches
// custom DOM events for other modules to respond to.
import { push as pushToast } from './ui.js';
import { auth, logout } from './auth.js';

let es = null;
let reconnectTimer = null;

function start(url = '/api/events') {
  if (es) return;
  tryConnect(url);
}

function tryConnect(url) {
  if (es) return;
  try {
    es = new EventSource(url, { withCredentials: true });
  } catch (e) {
    scheduleReconnect(url);
    return;
  }

  es.onopen = () => {
    // console.log('SSE connected');
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  };

  es.onmessage = (ev) => {
    // generic message
    document.dispatchEvent(new CustomEvent('realtime:message', { detail: ev.data }));
  };

  // custom named events
  es.addEventListener('teams:updated', (ev) => {
    const data = parseSafe(ev.data);
    document.dispatchEvent(new CustomEvent('realtime:teams:updated', { detail: data }));
    pushToast({ type: 'info', title: 'Teams updated', message: `Teams were updated on another device.`, actionLabel: 'Load', action: () => document.dispatchEvent(new CustomEvent('realtime:load-remote-teams')) });
  });
  es.addEventListener('teams:cleared', (ev) => {
    const data = parseSafe(ev.data);
    document.dispatchEvent(new CustomEvent('realtime:teams:cleared', { detail: data }));
    pushToast({ type: 'info', title: 'Teams cleared', message: `Teams were cleared on another device.`, actionLabel: 'Load', action: () => document.dispatchEvent(new CustomEvent('realtime:load-remote-teams')) });
  });
  es.addEventListener('campers:created', (ev) => {
    const data = parseSafe(ev.data);
    document.dispatchEvent(new CustomEvent('realtime:campers:created', { detail: data }));
  });
  es.addEventListener('campers:updated', (ev) => {
    const data = parseSafe(ev.data);
    document.dispatchEvent(new CustomEvent('realtime:campers:updated', { detail: data }));
  });
  es.addEventListener('campers:deleted', (ev) => {
    const data = parseSafe(ev.data);
    document.dispatchEvent(new CustomEvent('realtime:campers:deleted', { detail: data }));
  });
  es.addEventListener('settings:updated', (ev) => {
    const data = parseSafe(ev.data);
    document.dispatchEvent(new CustomEvent('realtime:settings:updated', { detail: data }));
    pushToast({ type: 'info', title: 'Settings updated', message: `App settings were updated.` });
  });
  es.addEventListener('session:invalidated', (ev) => {
    const data = parseSafe(ev.data) || {};
    // if the invalidation affects the currently logged-in user, notify UI to show modal
    if (auth && auth.user && auth.user.username === data.username) {
      pushToast({ type: 'info', title: 'Session replaced', message: 'Your session was replaced by another login.' });
      // notify the app so it can show a modal and then log out when user confirms
      document.dispatchEvent(new CustomEvent('realtime:session-invalidated', { detail: data }));
    }
  });

  es.onerror = (err) => {
    // try to reconnect
    try { es.close(); } catch (e) {}
    es = null;
    scheduleReconnect(url);
  };
}

function scheduleReconnect(url) {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    tryConnect(url);
  }, 3000);
}

function stop() {
  if (es) {
    try { es.close(); } catch (e) {}
    es = null;
  }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
}

function parseSafe(s) {
  try { return JSON.parse(s); } catch { return s; }
}

export default { start, stop };
