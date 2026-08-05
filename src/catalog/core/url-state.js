/**
 * Two-way binding between the catalog's state and the URL.
 *
 * The location and the active filters live in the query string so a filtered
 * catalog can be linked, bookmarked and shared:
 *
 *   /catalog?location=seattle&category=roses&color=white&length=60
 *
 * Values are slugs, never raw labels, and are resolved back against the data
 * on read — an unknown slug is dropped rather than producing a filter that
 * matches nothing.
 *
 * Personal data is never put in the URL. See core/quote-integration.js.
 */

import { CATEGORY_ORDER } from '../data/categories.js';
import { emptyFilters } from './facets.js';
import { isKnownLocation } from '../data/locations.js';
import { slugify } from './slug.js';

/** Query parameter name per facet. */
const PARAM_BY_FACET = {
  category: 'category',
  variety: 'variety',
  color: 'color',
  lengthCm: 'length',
  measure: 'measure',
};

export const LOCATION_PARAM = 'location';

/**
 * @param {URLSearchParams} params
 * @param {string} name
 * @returns {string[]}
 */
function readList(params, name) {
  const raw = params.get(name);
  if (!raw) return [];
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * @param {URLSearchParams} [params]
 * @returns {string|null}
 */
export function readLocationFromUrl(params = new URLSearchParams(window.location.search)) {
  const value = params.get(LOCATION_PARAM);
  return value && isKnownLocation(value) ? value : null;
}

/**
 * Reads filters, resolving slugs against the values the data actually has.
 *
 * @param {import('./repository').LocationProduct[]} products
 * @param {URLSearchParams} [params]
 * @returns {import('./types').FilterState}
 */
export function readFiltersFromUrl(products, params = new URLSearchParams(window.location.search)) {
  const filters = emptyFilters();

  const known = collectValues(products);

  for (const [facet, param] of Object.entries(PARAM_BY_FACET)) {
    const slugs = readList(params, param);
    if (slugs.length === 0) continue;

    if (facet === 'lengthCm') {
      filters.lengthCm = slugs
        .map(Number)
        .filter((n) => Number.isFinite(n) && known.lengthCm.has(n));
      continue;
    }

    const bySlug = known[facet];
    filters[facet] = slugs.map((slug) => bySlug.get(slug)).filter((value) => value !== undefined);
  }

  return filters;
}

/**
 * Indexes every value present in the data by its slug, so URL slugs resolve
 * back to the exact stored value ("hot-pink" -> "Hot Pink").
 * @param {import('./repository').LocationProduct[]} products
 */
function collectValues(products) {
  /** @type {{category: Map<string,string>, variety: Map<string,string>, color: Map<string,string>, measure: Map<string,string>, lengthCm: Set<number>}} */
  const known = {
    category: new Map(),
    variety: new Map(),
    color: new Map(),
    measure: new Map(),
    lengthCm: new Set(),
  };

  // Categories are a fixed taxonomy, so they come from configuration rather
  // than from the data: `?category=supplies` has to survive even though
  // Supplies has no products yet and would otherwise never appear here.
  for (const category of CATEGORY_ORDER) known.category.set(slugify(category), category);

  for (const product of products) {
    for (const variant of product.variants) {
      if (variant.variety) known.variety.set(slugify(variant.variety), variant.variety);
      if (variant.color) known.color.set(slugify(variant.color), variant.color);
      if (variant.lengthCm !== null && variant.lengthCm !== undefined) {
        known.lengthCm.add(variant.lengthCm);
      }
      for (const measure of variant.availableMeasures ?? []) {
        known.measure.set(slugify(measure), measure);
      }
    }
  }
  return known;
}

/**
 * Serializes state into a query string.
 * @param {{ location: string, filters: import('./types').FilterState }} state
 * @returns {string} including the leading "?", or "" when there is nothing to encode
 */
export function buildQueryString({ location, filters }) {
  const params = new URLSearchParams();
  if (location) params.set(LOCATION_PARAM, location);

  for (const [facet, param] of Object.entries(PARAM_BY_FACET)) {
    const values = filters?.[facet] ?? [];
    if (values.length === 0) continue;
    const slugs = values.map((value) => (facet === 'lengthCm' ? String(value) : slugify(value)));
    params.set(param, slugs.join(','));
  }

  const query = params.toString();
  return query ? `?${query}` : '';
}

/**
 * Replaces the current history entry with the given state. Uses replaceState so
 * adjusting filters does not fill the back button with intermediate states;
 * navigating between pages still pushes normally.
 *
 * @param {{ location: string, filters: import('./types').FilterState }} state
 * @param {string} [pathname]
 */
export function syncUrl(state, pathname = window.location.pathname) {
  const url = `${pathname}${buildQueryString(state)}`;
  if (url !== `${window.location.pathname}${window.location.search}`) {
    window.history.replaceState(window.history.state, '', url);
  }
}

/**
 * Builds a link to a product page that carries the current location and
 * filters, so going back keeps the visitor where they were.
 *
 * @param {{ category: string, slug: string }} product
 * @param {{ location: string, filters?: import('./types').FilterState }} state
 */
export function productHref(product, state) {
  const query = buildQueryString({ location: state.location, filters: state.filters ?? emptyFilters() });
  return `/catalog/${product.category}/${product.slug}${query}`;
}

/**
 * Builds a link back to the catalog list.
 * @param {{ location: string, filters?: import('./types').FilterState }} state
 */
export function catalogHref(state) {
  return `/catalog${buildQueryString({ location: state.location, filters: state.filters ?? emptyFilters() })}`;
}

/**
 * Parses `/catalog`, `/catalog/<category>` and `/catalog/<category>/<slug>`.
 * @param {string} [pathname]
 * @returns {{ view: 'list'|'product'|'quote', category: string|null, slug: string|null }}
 */
export function parseRoute(pathname = window.location.pathname) {
  const parts = pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  // parts[0] is always "catalog" — the route only exists under it.
  const category = parts[1] ?? null;
  const slug = parts[2] ?? null;
  if (category === 'quote' && !slug) return { view: 'quote', category, slug: null };
  return { view: slug ? 'product' : 'list', category, slug };
}
