import { reactive, ref, computed } from "vue";

// Simple toast store
const toasts = reactive([]);
let nextId = 1;
// Toasts created while loader is visible are queued here and flushed when
// the loader hides so the toast appears after the overlay is dismissed.
const pendingToasts = [];

function pushToast(type, message, title) {
  const id = nextId++;
  const t = { id, type: type || "info", message: message || "", title: title || (type === "error" ? "Error" : "") };
  // If a loading overlay is visible, queue the toast to show after loading
  // finishes. This prevents toasts appearing underneath or while the overlay
  // is visible.
  if (loadingCount.value > 0) {
    pendingToasts.push(t);
    return id;
  }

  toasts.push(t);

  // auto-dismiss after 4.5s
  setTimeout(() => {
    const idx = toasts.findIndex((x) => x.id === id);
    if (idx !== -1) toasts.splice(idx, 1);
  }, 4500);

  return id;
}

// New push API that accepts action callbacks and options
function push(opts) {
  const { type = "info", message = "", title = "", actionLabel, action } = opts || {};
  const id = nextId++;
  const t = { id, type, message, title, actionLabel, action, _timer: null };
  const schedule = (toast) => {
    // schedule auto-dismiss after 4.5s
    toast._timer = setTimeout(() => {
      const idx = toasts.findIndex((x) => x.id === toast.id);
      if (idx !== -1) toasts.splice(idx, 1);
    }, 4500);
  };

  if (loadingCount.value > 0) {
    pendingToasts.push(t);
    return id;
  }

  toasts.push(t);
  schedule(t);
  return id;
}

function success(message, title = "Success") {
  return pushToast("success", message, title);
}
function error(message, title = "Error") {
  return pushToast("error", message, title);
}
function info(message, title = "Notice") {
  return pushToast("info", message, title);
}

function dismiss(id) {
  // Remove from visible toasts
  const idx = toasts.findIndex((t) => t.id === id);
  if (idx !== -1) {
    const t = toasts.splice(idx, 1)[0];
    // clear any pending timer
    if (t && t._timer) clearTimeout(t._timer);
    return;
  }
  // Remove from pending toasts as well
  const pIdx = pendingToasts.findIndex((t) => t.id === id);
  if (pIdx !== -1) pendingToasts.splice(pIdx, 1);
}

// Loading overlay state (global)
const loadingCount = ref(0);
const loadingMessage = ref("");
const loadingProgress = ref(null); // null = indeterminate, number 0-100 = percent

const loadingVisible = computed(() => loadingCount.value > 0);

function showLoading(msg) {
  loadingCount.value++;
  if (msg) loadingMessage.value = msg;
  loadingProgress.value = null;
}

function hideLoading() {
  loadingCount.value = Math.max(0, loadingCount.value - 1);
  if (loadingCount.value === 0) {
    loadingMessage.value = "";
    loadingProgress.value = null;
    // Flush any toasts that were queued while loading was active
    if (pendingToasts.length > 0) {
      // Move each pending toast into the visible list and attach auto-dismiss
      pendingToasts.forEach((t) => {
        toasts.push(t);
        // attach auto-dismiss for queued toasts
        t._timer = setTimeout(() => {
          const idx = toasts.findIndex((x) => x.id === t.id);
          if (idx !== -1) toasts.splice(idx, 1);
        }, 4500);
      });
      pendingToasts.length = 0;
    }
  }
}

function setLoadingProgress(p) {
  // accept 0-100 or null
  loadingProgress.value = p == null ? null : Math.max(0, Math.min(100, Number(p)));
}

// Minimal withLoading wrapper for API calls. Keeps API-compatible signature
// with older code that sometimes calls withLoading(fn, msg) or withLoading(msg, fn)
// The wrapped function will receive a reporter function as its first argument
// which it may call to update progress: reporter(percent)
async function withLoading(a, b) {
  let fn = null;
  let msg = null;
  if (typeof a === "function") {
    fn = a;
    msg = b;
  } else {
    msg = a;
    fn = b;
  }
  if (!fn) throw new Error("withLoading called without function");

  // Show overlay if message provided (or even if not — we use it as feedback)
  if (msg) showLoading(msg);
  else showLoading("");

  // reporter function to update progress
  const reporter = (p) => setLoadingProgress(p);

  // Minimum visible time to avoid flicker for very fast actions (ms)
  const MIN_VISIBLE_MS = 2000;
  const start = Date.now();
  try {
    // call fn with reporter so callers can update progress if desired
    const result = await fn(reporter);
    return result;
  } finally {
    // Ensure the overlay stays visible for at least MIN_VISIBLE_MS
    const elapsed = Date.now() - start;
    if (elapsed < MIN_VISIBLE_MS) {
      await new Promise((res) => setTimeout(res, MIN_VISIBLE_MS - elapsed));
    }
    hideLoading();
  }
}

export { toasts, success, error, info, dismiss, withLoading, loadingVisible, loadingMessage, loadingProgress, showLoading, hideLoading, setLoadingProgress };
export { push };
