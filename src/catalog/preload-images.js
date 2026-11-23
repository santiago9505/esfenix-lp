/**
 * Runs as a tiny independent head script, before the catalog app or snapshot
 * is ready. Its manifest contains only the first row's stable local URLs.
 * Keep this function self-contained: the build serializes it without imports.
 */
export function preloadCatalogImages(manifest, browser = window, doc = document) {
  const url = new URL(browser.location.href);
  const parts = url.pathname.split('/').filter(Boolean);
  if (!['catalog', 'catalog.html'].includes(parts[0]) || parts.length > 2 || parts[1] === 'quote') return;

  // A deep filter may change the first row. Let the app pick those images
  // instead of spending bandwidth on a speculative, unrelated selection.
  if (['variety', 'color', 'length', 'measure'].some(key => url.searchParams.get(key))) return;

  let stored = null;
  try {
    stored = JSON.parse(browser.localStorage.getItem('esfenix.catalog.location'));
  } catch { /* Storage is optional, just as it is in the catalog. */ }

  const requested = url.searchParams.get('location');
  const location = Object.hasOwn(manifest.locations, requested) ? requested
    : Object.hasOwn(manifest.locations, stored) ? stored : manifest.defaultLocation;
  const group = manifest.groups[manifest.locations[location]];
  const categories = (url.searchParams.get('category') ?? '').split(',').map(value => value.trim());
  const selected = Object.keys(group).filter(key => key !== 'all' && categories.includes(key));
  const sources = selected.length ? selected.flatMap(key => group[key]) : group.all;

  // Slice before dropping missing photos so a placeholder doesn't cause an
  // offscreen card to take the visible row's download priority.
  for (const src of new Set(sources.slice(0, 3).filter(Boolean))) {
    if (doc.querySelector(`link[rel="preload"][as="image"][href="${src}"]`)) continue;
    const link = doc.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.setAttribute('fetchpriority', 'high');
    link.href = src;
    doc.head.append(link);
  }
}
