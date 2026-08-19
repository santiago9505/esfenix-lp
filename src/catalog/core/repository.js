/**
 * Catalog repository — the only module that knows where product data comes
 * from. Everything else asks it questions.
 *
 * Product data comes from the checked-in catalog snapshot. Fresa
 * remains a build-time source through `scripts/generate-fresa-catalog-snapshot.mjs`;
 * the browser never receives a credential or depends on a backend proxy.
 */

import { compareCategories } from '../data/categories.js';
import { LOCATIONS, resolveLocation } from '../data/locations.js';
import { sanitizeCatalogDescription } from './fresa-catalog.js';
import { applyLocalProductImageFallbacks } from './local-image-fallback.js';

/**
 * @typedef {import('./types').Product} Product
 * @typedef {import('./types').ProductVariant} ProductVariant
 * @typedef {import('./types').MeasureType} MeasureType
 */

/**
 * A product as it exists for one selected location: the variants of that
 * location's catalog, already resolved.
 * @typedef {Omit<Product, 'locations'> & {
 *   variants: ProductVariant[],
 *   catalogSource: string,
 * }} LocationProduct
 */

/** @type {Product[]|null} */
let productsCache = null;
/** @type {Promise<Product[]>|null} */
let initialProductsPromise = null;
export const PRODUCT_SNAPSHOT_URL = '/data/catalog-snapshot.json';

/**
 * Loads the bundled product list with read-only reference prices. The browser deliberately stays
 * static-only so the basic Firebase Hosting plan does not need Cloud Functions
 * or a database. Refresh the snapshot during a release when Fresa changes.
 *
 * @param {{
 *   snapshotUrl?: string,
 *   snapshotFetchImpl?: typeof fetch,
 * }} [options]
 * @returns {Promise<Product[]>}
 */
export function loadProducts(options = {}) {
  if (productsCache) return Promise.resolve(productsCache);

  if (initialProductsPromise) return initialProductsPromise;

  initialProductsPromise = loadProductSnapshot(options).finally(() => {
    initialProductsPromise = null;
  });

  return initialProductsPromise;
}

/**
 * @param {{ snapshotUrl?: string, snapshotFetchImpl?: typeof fetch }} options
 */
async function loadProductSnapshot(options) {
  const fetchImpl = options.snapshotFetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('Catalog snapshot fetch is unavailable.');

  const response = await fetchImpl(options.snapshotUrl ?? PRODUCT_SNAPSHOT_URL, {
    // Revalidate on a fresh page load so a deployment cannot keep referencing
    // media files from the previous catalog snapshot. The in-memory repository
    // still guarantees a single request during normal navigation.
    cache: 'no-cache',
  });
  if (!response?.ok) throw new Error('Catalog snapshot is unavailable.');

  const payload = await response.json();
  if (!isProductList(payload?.products)) throw new Error('Catalog snapshot is invalid.');

  productsCache = applyLocalProductImageFallbacks(sanitizeProductDescriptions(payload.products));
  return productsCache;
}

/** @param {Product[]} products */
function sanitizeProductDescriptions(products) {
  return products.map((product) => ({
    ...product,
    description: sanitizeCatalogDescription(product.description),
  }));
}

/** @param {unknown} value */
function isProductList(value) {
  return Array.isArray(value)
    && value.length > 0
    && value.every((product) =>
      product
      && typeof product === 'object'
      && typeof product.id === 'string'
      && typeof product.name === 'string'
      && Array.isArray(product.locations),
    );
}

/** Whether the currently rendered list should be refreshed in the background. */
export function productsNeedRefresh(now = Date.now()) {
  void now;
  return false;
}

/** Clears the in-memory snapshot cache. Used by tests and Retry. */
export function resetProductCache(_options = {}) {
  productsCache = null;
  initialProductsPromise = null;
}

/**
 * Product lists in Fresa may describe a location, a category, or a group. If
 * a list matches one of the configured catalog sources, use the existing
 * location behaviour. Otherwise the single shared Fresa catalog is shown for
 * every selectable location.
 *
 * @param {Product[]} products
 * @param {string} locationId a selectable location id, not a catalog source
 * @returns {LocationProduct[]}
 */
export function getProductsForLocation(products, locationId) {
  const { catalogSource } = resolveLocation(locationId);
  const knownSources = new Set(LOCATIONS.map((location) => location.catalogSource));
  const hasLocationLists = products.some((product) =>
    product.locations?.some((entry) => knownSources.has(entry.location)),
  );

  const list = [];
  for (const product of products) {
    const locationEntry = product.locations?.find((location) => location.location === catalogSource);
    const sharedEntry = product.locations?.find((location) => !knownSources.has(location.location));
    const singleCatalogEntry = product.locations?.[0]
      ? {
          ...product.locations[0],
          variants: product.locations.flatMap((location) => location.variants),
        }
      : null;
    const entry = hasLocationLists ? locationEntry ?? sharedEntry : singleCatalogEntry;
    if (!entry || !entry.catalogAvailable || entry.variants.length === 0) continue;

    const { locations, ...rest } = product;
    list.push({ ...rest, variants: entry.variants, catalogSource });
  }
  return sortProducts(list);
}

/**
 * Category order first, then the catalogue's editorial order. Products that
 * are not in the printed catalogue keep their Fresa position and remain
 * visible after the known sequence.
 * @param {LocationProduct[]} products
 */
function sortProducts(products) {
  return products.sort((a, b) => {
    const byCategory = compareCategories(a.category, b.category);
    if (byCategory !== 0) return byCategory;

    return (a.catalogOrder ?? Number.MAX_SAFE_INTEGER) - (b.catalogOrder ?? Number.MAX_SAFE_INTEGER) ||
      (a.position ?? 0) - (b.position ?? 0) ||
      a.name.localeCompare(b.name);
  });
}

/**
 * @param {LocationProduct[]} products
 * @param {string} slug
 * @returns {LocationProduct|null}
 */
export function findProductBySlug(products, slug) {
  return products.find((product) => product.slug === slug) ?? null;
}

/**
 * Whether a product exists at all, regardless of location. Used to tell
 * "this product is not sold here" apart from "this URL is wrong".
 * @param {Product[]} products
 * @param {string} slug
 */
export function productExistsAnywhere(products, slug) {
  return products.some((product) => product.slug === slug);
}

/**
 * Which of a product's catalogs list it, as selectable location ids.
 * @param {Product[]} products
 * @param {string} slug
 * @returns {string[]} catalog source ids
 */
export function getCatalogSourcesForProduct(products, slug) {
  const product = products.find((p) => p.slug === slug);
  if (!product) return [];
  return product.locations.filter((l) => l.catalogAvailable).map((l) => l.location);
}

/* ------------------------------------------------------------------ */
/* Derived views                                                       */
/* ------------------------------------------------------------------ */

/**
 * The category -> group -> products tree the product page sidebar renders.
 * Built from the data, so it never lists a product the location does not carry.
 *
 * @param {LocationProduct[]} products
 */
export function buildCategoryTree(products) {
  /** @type {Map<string, Map<string, { label: string, order: number, products: LocationProduct[] }>>} */
  const tree = new Map();

  for (const product of products) {
    if (!tree.has(product.category)) tree.set(product.category, new Map());
    const groups = tree.get(product.category);

    const groupId = product.group ?? product.category;
    if (!groups.has(groupId)) {
      groups.set(groupId, {
        label: product.groupLabel ?? '',
        order: product.catalogOrder ?? Number.MAX_SAFE_INTEGER,
        products: [],
      });
    }
    const group = groups.get(groupId);
    group.order = Math.min(group.order, product.catalogOrder ?? Number.MAX_SAFE_INTEGER);
    group.products.push(product);
  }

  return [...tree.entries()]
    .sort(([a], [b]) => compareCategories(a, b))
    .map(([category, groups]) => ({
      category,
      groups: [...groups.entries()]
        .sort(([, a], [, b]) => a.order - b.order || a.label.localeCompare(b.label))
        .map(([id, group]) => ({ id, label: group.label, products: group.products })),
    }));
}

/**
 * The distinct varieties a product offers in the current location, for the
 * sidebar's second level.
 * @param {LocationProduct} product
 * @returns {string[]}
 */
export function getVarieties(product) {
  const seen = new Set();
  for (const variant of product.variants) {
    if (variant.variety) seen.add(variant.variety);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/**
 * Related products for the "Similar products" section.
 *
 * A curated `relatedProductIds` wins outright. Otherwise products are scored by
 * how much they share with the current one, in the priority the brief sets:
 * category, then group/variety family, then colour, then length, then measure.
 * Only products listed in the current location are considered, and the current
 * product is always excluded.
 *
 * @param {LocationProduct} product
 * @param {LocationProduct[]} products all products for the current location
 * @param {number} [limit]
 * @returns {LocationProduct[]}
 */
export function getRelatedProducts(product, products, limit = 6) {
  const pool = products.filter((candidate) => candidate.id !== product.id);

  const curated = product.relatedProductIds ?? [];
  if (curated.length > 0) {
    const byId = new Map(pool.map((candidate) => [candidate.id, candidate]));
    const picked = curated.map((id) => byId.get(id)).filter(Boolean);
    if (picked.length > 0) return picked.slice(0, limit);
  }

  const colors = valueSet(product, 'color');
  const lengths = valueSet(product, 'lengthCm');
  const measures = measureSet(product);

  const scored = pool
    .map((candidate) => {
      let score = 0;
      if (candidate.category === product.category) score += 100;
      if (candidate.group && candidate.group === product.group) score += 50;
      if (intersects(colors, valueSet(candidate, 'color'))) score += 20;
      if (intersects(lengths, valueSet(candidate, 'lengthCm'))) score += 10;
      if (intersects(measures, measureSet(candidate))) score += 5;
      return { candidate, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.candidate.name.localeCompare(b.candidate.name));

  return scored.slice(0, limit).map((entry) => entry.candidate);
}

/**
 * @param {LocationProduct} product
 * @param {'color'|'variety'|'lengthCm'} key
 */
function valueSet(product, key) {
  const set = new Set();
  for (const variant of product.variants) {
    const value = variant[key];
    if (value !== null && value !== undefined) set.add(value);
  }
  return set;
}

/** @param {LocationProduct} product */
function measureSet(product) {
  const set = new Set();
  for (const variant of product.variants) {
    for (const measure of variant.availableMeasures ?? []) set.add(measure);
  }
  return set;
}

/**
 * @param {Set<unknown>} a
 * @param {Set<unknown>} b
 */
function intersects(a, b) {
  for (const value of a) {
    if (b.has(value)) return true;
  }
  return false;
}
