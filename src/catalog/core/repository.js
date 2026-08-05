/**
 * Catalog repository — the only module that knows where product data comes
 * from. Everything else asks it questions.
 *
 * Product data comes from Fresa at runtime. Keeping that decision here means
 * the views, filters and quote list do not need to know the remote response shape.
 */

import { compareCategories } from '../data/categories.js';
import { LOCATIONS, resolveLocation } from '../data/locations.js';
import {
  FRESA_CATALOG_REVALIDATE_MS,
  loadFresaCatalog,
  normalizeCatalog,
  resetFresaCatalogCache,
} from './fresa-catalog.js';
import { read, remove, write } from './storage.js';
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
let productsCachedAt = 0;
let productsAreSnapshot = false;
/** @type {Promise<Product[]>|null} */
let initialProductsPromise = null;
/** @type {Promise<Product[]>|null} */
let remoteProductsPromise = null;

const PRODUCT_CACHE_VERSION = 1;
const PRODUCT_CACHE_KEY = 'products.live.v1';
export const PRODUCT_SNAPSHOT_URL = '/data/catalog-snapshot.json';

/**
 * Loads the best immediately available product list. A fresh browser cache is
 * preferred; first-time visitors receive the bundled price-free snapshot so
 * the page can render without waiting for the full Fresa directory. The app
 * revalidates snapshots in the background through `force: true`.
 *
 * @param {{
 *   force?: boolean,
 *   snapshotUrl?: string,
 *   snapshotFetchImpl?: typeof fetch,
 *   apiUrl?: string,
 *   apiKey?: string,
 *   fetchImpl?: typeof fetch,
 * }} [options]
 * @returns {Promise<Product[]>}
 */
export function loadProducts(options = {}) {
  if (options.force) return loadRemoteProducts(options);
  if (productsCache) return Promise.resolve(productsCache);

  const persisted = readPersistedProducts();
  if (persisted) return Promise.resolve(rememberProducts(persisted.products, persisted.savedAt));
  if (initialProductsPromise) return initialProductsPromise;

  initialProductsPromise = loadProductSnapshot(options)
    .catch(() => loadRemoteProducts(options))
    .finally(() => {
      initialProductsPromise = null;
    });

  return initialProductsPromise;
}

/** Loads and persists the current live response from Fresa. */
function loadRemoteProducts(options) {
  if (remoteProductsPromise) return remoteProductsPromise;

  remoteProductsPromise = loadFresaCatalog(options)
    .then(normalizeCatalog)
    .then((products) => {
      const savedAt = Date.now();
      const remembered = rememberProducts(products, savedAt);
      write(PRODUCT_CACHE_KEY, {
        version: PRODUCT_CACHE_VERSION,
        savedAt,
        products: remembered,
      });
      return remembered;
    })
    .catch((error) => {
      // Let the next call retry rather than caching the failure forever.
      throw error;
    })
    .finally(() => {
      remoteProductsPromise = null;
    });

  return remoteProductsPromise;
}

/**
 * @param {{ snapshotUrl?: string, snapshotFetchImpl?: typeof fetch }} options
 */
async function loadProductSnapshot(options) {
  const fetchImpl = options.snapshotFetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('Catalog snapshot fetch is unavailable.');

  const response = await fetchImpl(options.snapshotUrl ?? PRODUCT_SNAPSHOT_URL, {
    cache: 'force-cache',
  });
  if (!response?.ok) throw new Error('Catalog snapshot is unavailable.');

  const payload = await response.json();
  if (!isProductList(payload?.products)) throw new Error('Catalog snapshot is invalid.');

  productsAreSnapshot = true;
  productsCachedAt = 0;
  productsCache = applyLocalProductImageFallbacks(payload.products);
  return productsCache;
}

function readPersistedProducts() {
  const entry = read(PRODUCT_CACHE_KEY, null);
  const savedAt = Number(entry?.savedAt);
  const isFresh = Number.isFinite(savedAt)
    && savedAt > 0
    && Date.now() - savedAt < FRESA_CATALOG_REVALIDATE_MS;

  if (entry?.version !== PRODUCT_CACHE_VERSION || !isFresh || !isProductList(entry?.products)) {
    if (entry !== null) remove(PRODUCT_CACHE_KEY);
    return null;
  }
  return { savedAt, products: entry.products };
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

/** @param {Product[]} products @param {number} savedAt */
function rememberProducts(products, savedAt) {
  productsCache = products;
  productsCachedAt = savedAt;
  productsAreSnapshot = false;
  return productsCache;
}

/** Whether the currently rendered list should be refreshed in the background. */
export function productsNeedRefresh(now = Date.now()) {
  return productsAreSnapshot
    || productsCachedAt <= 0
    || now - productsCachedAt >= FRESA_CATALOG_REVALIDATE_MS;
}

/** Clears both product and remote response caches. Used by tests and Retry. */
export function resetProductCache({ persistent = true } = {}) {
  productsCache = null;
  productsCachedAt = 0;
  productsAreSnapshot = false;
  initialProductsPromise = null;
  remoteProductsPromise = null;
  resetFresaCatalogCache();
  if (persistent) remove(PRODUCT_CACHE_KEY);
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
