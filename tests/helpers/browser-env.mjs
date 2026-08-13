/**
 * The smallest browser surface the catalog's state modules touch: localStorage,
 * location and history.
 *
 * The stores are plain modules with no DOM dependency beyond persistence and
 * the URL, so this is enough to test them under `node --test` without pulling
 * in a headless browser. Modules that read the environment at import time are
 * loaded with `await import()` after `installBrowserEnv()` has run.
 */

/** An in-memory Storage that behaves like the real one, including throwing. */
export function createStorage({ throwOnWrite = false } = {}) {
  const map = new Map();
  return {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem(k, v) {
      if (throwOnWrite) throw new Error('QuotaExceededError');
      map.set(k, String(v));
    },
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    _map: map,
  };
}

/**
 * @param {{ url?: string, storage?: ReturnType<typeof createStorage>, sessionStorage?: ReturnType<typeof createStorage> }} [options]
 */
export function installBrowserEnv(options = {}) {
  const url = new URL(options.url ?? 'http://localhost/catalog');
  const storage = options.storage ?? createStorage();
  const sessionStorage = options.sessionStorage ?? createStorage();

  const location = {
    get href() {
      return url.toString();
    },
    get pathname() {
      return url.pathname;
    },
    get search() {
      return url.search;
    },
    get origin() {
      return url.origin;
    },
  };

  const history = {
    state: null,
    replaceState(state, _title, nextUrl) {
      this.state = state;
      const resolved = new URL(nextUrl, url);
      url.pathname = resolved.pathname;
      url.search = resolved.search;
    },
    pushState(state, title, nextUrl) {
      this.replaceState(state, title, nextUrl);
    },
  };

  const listeners = new Map();

  const win = {
    localStorage: storage,
    sessionStorage,
    location,
    history,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  };

  globalThis.window = win;
  globalThis.localStorage = storage;
  globalThis.sessionStorage = sessionStorage;

  return {
    window: win,
    storage,
    sessionStorage,
    /** @param {string} next */
    setUrl(next) {
      const resolved = new URL(next, url);
      url.pathname = resolved.pathname;
      url.search = resolved.search;
    },
    currentUrl: () => `${url.pathname}${url.search}`,
  };
}

export function resetBrowserEnv() {
  delete globalThis.window;
  delete globalThis.localStorage;
  delete globalThis.sessionStorage;
}

/** Loads the generated catalog data without going through the app's loader. */
export async function loadCatalogFixture() {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const path = fileURLToPath(new URL('../../src/catalog/data/products.generated.json', import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * A small hand-built catalog. Tests that assert on filtering behaviour use this
 * rather than the real data, so they describe the rule instead of the current
 * contents of Esfenix's price list.
 */
export function sampleProducts() {
  return [
    {
      id: 'roses-a',
      slug: 'roses-a',
      name: 'Roses A',
      category: 'roses',
      group: 'ecuadorian-roses',
      groupLabel: 'Ecuadorian Roses',
      images: [],
      isNew: false,
      locations: [
        {
          location: 'houston',
          catalogAvailable: true,
          variants: [
            { id: 'freedom_red_50cm', variety: 'Freedom', color: 'Red', lengthCm: 50, availableMeasures: ['stem'] },
            { id: 'freedom_red_60cm', variety: 'Freedom', color: 'Red', lengthCm: 60, availableMeasures: ['stem'] },
            { id: 'vendela_white_60cm', variety: 'Vendela', color: 'White', lengthCm: 60, availableMeasures: ['stem'] },
          ],
        },
        {
          location: 'seattle',
          catalogAvailable: true,
          variants: [
            { id: 'freedom_red_50cm', variety: 'Freedom', color: 'Red', lengthCm: 50, availableMeasures: ['stem'] },
          ],
        },
      ],
    },
    {
      id: 'greens-b',
      slug: 'greens-b',
      name: 'Greens B',
      category: 'foliage',
      group: 'greenery',
      groupLabel: 'Greenery',
      images: [],
      isNew: true,
      locations: [
        {
          location: 'houston',
          catalogAvailable: true,
          variants: [
            { id: 'novariety_nocolor_nolength', variety: null, color: null, lengthCm: null, availableMeasures: ['bunch'] },
          ],
        },
      ],
    },
    {
      id: 'flower-c',
      slug: 'flower-c',
      name: 'Flower C',
      category: 'other-flowers',
      group: 'other-flowers',
      groupLabel: 'Other Flowers',
      images: [],
      isNew: false,
      locations: [
        {
          location: 'houston',
          catalogAvailable: true,
          variants: [
            { id: 'novariety_white_nolength', variety: null, color: 'White', lengthCm: null, availableMeasures: ['stem', 'bunch'] },
            { id: 'novariety_red_nolength', variety: null, color: 'Red', lengthCm: null, availableMeasures: ['bunch'] },
          ],
        },
      ],
    },
  ];
}
