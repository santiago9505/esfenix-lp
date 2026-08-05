/**
 * localStorage access that never throws.
 *
 * Storage can be unavailable (private browsing, disabled cookies, quota) and a
 * catalog that cannot remember a selection should still work, so every failure
 * degrades to "nothing was stored".
 */

const PREFIX = 'esfenix.catalog.';

/** @returns {Storage|null} */
function storage() {
  try {
    const test = `${PREFIX}__probe`;
    window.localStorage.setItem(test, '1');
    window.localStorage.removeItem(test);
    return window.localStorage;
  } catch {
    return null;
  }
}

let cached;
function get() {
  if (cached === undefined) cached = storage();
  return cached;
}

export function isAvailable() {
  return get() !== null;
}

/**
 * @template T
 * @param {string} key
 * @param {T} fallback
 * @returns {T}
 */
export function read(key, fallback) {
  const store = get();
  if (!store) return fallback;
  try {
    const raw = store.getItem(PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * @param {string} key
 * @param {unknown} value
 */
export function write(key, value) {
  const store = get();
  if (!store) return;
  try {
    store.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* Quota or serialization failure: the catalog works without persistence. */
  }
}

/** @param {string} key */
export function remove(key) {
  const store = get();
  if (!store) return;
  try {
    store.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

/** Test hook: forget whether storage was available. */
export function resetStorageProbe() {
  cached = undefined;
}
