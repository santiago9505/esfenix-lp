/**
 * Short-lived session storage for form state that may contain personal data.
 * Values disappear when the tab closes and also expire after 30 minutes.
 */

const PREFIX = 'esfenix.session.';
const DEFAULT_TTL_MS = 30 * 60_000;
let cached;

function storage() {
  try {
    const store = window.sessionStorage;
    const probe = `${PREFIX}__probe`;
    store.setItem(probe, '1');
    store.removeItem(probe);
    return store;
  } catch {
    return null;
  }
}

function get() {
  if (cached === undefined) cached = storage();
  return cached;
}

export function readSession(key, fallback) {
  const store = get();
  if (!store) return fallback;
  try {
    const raw = store.getItem(PREFIX + key);
    if (raw === null) return fallback;
    const entry = JSON.parse(raw);
    if (!entry || !Number.isFinite(entry.expiresAt) || Date.now() >= entry.expiresAt) {
      store.removeItem(PREFIX + key);
      return fallback;
    }
    return entry.value;
  } catch {
    return fallback;
  }
}

export function writeSession(key, value, ttlMs = DEFAULT_TTL_MS) {
  const store = get();
  if (!store) return;
  try {
    store.setItem(PREFIX + key, JSON.stringify({
      expiresAt: Date.now() + Math.max(1, ttlMs),
      value,
    }));
  } catch {
    // The form remains usable in memory if session storage is unavailable.
  }
}

export function removeSession(key) {
  try {
    get()?.removeItem(PREFIX + key);
  } catch {
    // Ignore unavailable storage.
  }
}

export function resetSessionStorageProbe() {
  cached = undefined;
}
