/**
 * Catalog repository — the only module that knows where product data comes
 * from. Everything else asks it questions.
 *
 * The checked-in snapshot provides the first paint without waiting for an
 * external service. Fresa's public, field-scoped integration then refreshes
 * that data in the background, so speed never trades away freshness.
 */

import { compareCategories } from '../data/categories.js';
import { LOCATIONS, resolveLocation } from '../data/locations.js';
import {
  fetchCatalogPages,
  inheritImagesAcrossStemLengths,
  normalizeCatalog,
  sanitizeCatalogDescription,
} from './fresa-catalog.js';
import {
  applyLocalProductImageFallbacks,
  LOCAL_PRODUCT_IMAGE_FALLBACK_PRODUCT_IDS,
} from './local-image-fallback.js';
import {
  LIVE_CATALOG_POLL_INTERVAL_MS,
  LIVE_CATALOG_SIGNED_URL_REFRESH_MS,
  LIVE_CATALOG_URL,
} from '../data/live-catalog-config.js';
import { resolveSalesMeasures } from './sales-measures.js';

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
let productsCacheSource = 'none';
let liveRevision = null;
let lastLiveLoadAt = 0;
let nextRevisionCheckAt = 0;
export const PRODUCT_SNAPSHOT_URL = '/data/catalog-snapshot.json';
export const PRODUCT_REFRESH_INTERVAL_MS = LIVE_CATALOG_POLL_INTERVAL_MS;

/**
 * Loads the bundled snapshot for the first paint. The app checks Fresa in the
 * background after rendering and replaces this data only when the live source
 * is available. If the snapshot itself is unavailable, the live endpoint is a
 * last-resort fallback so the storefront can still recover.
 *
 * @param {{
 *   force?: boolean,
 *   liveUrl?: string,
 *   liveFetchImpl?: typeof fetch,
 *   snapshotUrl?: string,
 *   snapshotFetchImpl?: typeof fetch,
 * }} [options]
 * @returns {Promise<Product[]>}
 */
export function loadProducts(options = {}) {
  if (productsCache && options.force !== true) return Promise.resolve(productsCache);

  if (initialProductsPromise) return initialProductsPromise;

  initialProductsPromise = loadInitialProducts(options).finally(() => {
    initialProductsPromise = null;
  });

  return initialProductsPromise;
}

async function loadInitialProducts(options) {
  try {
    return await loadProductSnapshot(options);
  } catch (snapshotError) {
    const liveUrl = resolveLiveUrl(options);
    if (!liveUrl) throw snapshotError;

    console.warn('Bundled catalog snapshot unavailable; loading Fresa directly.', snapshotError);
    return loadLiveProducts({ ...options, liveUrl });
  }
}

/**
 * Checks a lightweight Fresa revision and reloads the full catalog only when
 * data changed or its signed media URLs are close to expiring.
 *
 * @param {{
 *   forceCheck?: boolean,
 *   now?: number,
 *   liveUrl?: string,
 *   liveFetchImpl?: typeof fetch,
 * }} [options]
 */
export async function refreshProductsIfChanged(options = {}) {
  const now = Number(options.now ?? Date.now());
  const liveUrl = resolveLiveUrl(options);
  if (!liveUrl || (!options.forceCheck && now < nextRevisionCheckAt)) {
    return { changed: false, products: productsCache ?? [] };
  }

  nextRevisionCheckAt = now + LIVE_CATALOG_POLL_INTERVAL_MS;
  const fetchImpl = options.liveFetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') return { changed: false, products: productsCache ?? [] };

  const revision = await fetchLiveRevision(liveUrl, fetchImpl);
  const signedUrlsNeedRefresh = productsCacheSource === 'live'
    && now - lastLiveLoadAt >= LIVE_CATALOG_SIGNED_URL_REFRESH_MS;
  const changed = productsCacheSource !== 'live'
    || revision !== liveRevision
    || signedUrlsNeedRefresh;
  if (!changed) return { changed: false, products: productsCache ?? [] };

  const products = await loadLiveProducts({
    ...options,
    liveUrl,
    knownRevision: revision,
    now,
  });
  return { changed: true, products };
}

function resolveLiveUrl(options) {
  return String(options.liveUrl === undefined ? LIVE_CATALOG_URL : options.liveUrl ?? '').trim();
}

async function loadLiveProducts(options) {
  const fetchImpl = options.liveFetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('Live catalog fetch is unavailable.');

  const [payload, revision] = await Promise.all([
    fetchCatalogPages({
      apiUrl: options.liveUrl,
      fetchImpl,
      // The public integration accepts 1,000 records per page. This keeps the
      // live storefront to two catalog requests at its current size instead
      // of seven sequential round trips.
      pageLimit: 1000,
    }),
    options.knownRevision
      ? Promise.resolve(options.knownRevision)
      : fetchLiveRevision(options.liveUrl, fetchImpl),
  ]);
  const products = prepareProducts(normalizeCatalog(filterActiveProducts(payload)));
  if (!isProductList(products)) throw new Error('Live Fresa catalog is invalid.');

  productsCache = products;
  productsCacheSource = 'live';
  liveRevision = revision;
  lastLiveLoadAt = Number(options.now ?? Date.now());
  nextRevisionCheckAt = lastLiveLoadAt + LIVE_CATALOG_POLL_INTERVAL_MS;
  return productsCache;
}

async function fetchLiveRevision(liveUrl, fetchImpl) {
  const url = new URL(
    liveUrl,
    typeof window === 'undefined' || !window.location?.href
      ? 'http://localhost/'
      : window.location.href,
  );
  url.searchParams.set('mode', 'revision');
  url.searchParams.delete('offset');
  url.searchParams.delete('limit');

  const response = await fetchImpl(url.toString(), {
    headers: { Accept: 'application/json' },
    cache: 'no-cache',
  });
  if (!response?.ok) throw new Error('Live Fresa catalog revision is unavailable.');
  const payload = await response.json();
  const revision = String(payload?.revision ?? '').trim();
  if (!payload?.success || !revision || String(payload?.source?.name ?? '').trim() !== 'Landing Page') {
    throw new Error('Live Fresa catalog revision is invalid.');
  }
  return revision;
}

function filterActiveProducts(payload) {
  const catalog = payload?.catalog ?? {};
  const columns = Array.isArray(catalog.columns) ? catalog.columns : [];
  const products = Array.isArray(catalog.products) ? catalog.products : [];
  const activeColumnByList = new Map();

  for (const column of columns) {
    const label = [column?.field_name, column?.field_key, column?.key]
      .map((value) => String(value ?? '').trim().toLowerCase())
      .join(' ');
    if (!/(^|\s|_)active($|\s|_)/.test(label)) continue;
    const listId = String(column?.list_id ?? '').trim();
    const key = String(column?.key ?? '').trim();
    if (listId && key) activeColumnByList.set(listId, key);
  }

  if (activeColumnByList.size === 0) return payload;
  return {
    ...payload,
    catalog: {
      ...catalog,
      products: products.filter((product) => {
        const key = activeColumnByList.get(String(product?.listId ?? '').trim());
        return key ? isActiveValue(product?.fields?.[key]) : false;
      }),
    },
  };
}

function isActiveValue(value) {
  if (value === true || value === 1) return true;
  return ['true', '1', 'yes', 'si', 'sí', 'active', 'activa'].includes(
    String(value ?? '').trim().toLowerCase(),
  );
}

/**
 * @param {{ snapshotUrl?: string, snapshotFetchImpl?: typeof fetch }} options
 */
async function loadProductSnapshot(options) {
  const fetchImpl = options.snapshotFetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('Catalog snapshot fetch is unavailable.');

  const response = await fetchImpl(options.snapshotUrl ?? PRODUCT_SNAPSHOT_URL, {
    // Respect the snapshot's short HTTP cache so a preload from the landing
    // page can be reused immediately. Fresa still refreshes it in the
    // background, while hashed media URLs make cached snapshot images stable.
    cache: 'default',
  });
  if (!response?.ok) throw new Error('Catalog snapshot is unavailable.');

  const payload = await response.json();
  if (!isProductList(payload?.products)) throw new Error('Catalog snapshot is invalid.');

  productsCache = prepareProducts(payload.products);
  productsCacheSource = 'snapshot';
  liveRevision = null;
  lastLiveLoadAt = 0;
  nextRevisionCheckAt = Date.now() + LIVE_CATALOG_POLL_INTERVAL_MS;
  return productsCache;
}

function prepareProducts(products) {
  return applyLocalProductImageFallbacks(
    normalizePublicSalesMeasures(
      stripPublicPrices(sanitizeProductDescriptions(inheritImagesAcrossStemLengths(products))),
    ),
    {
      enabled: true,
      productIds: LOCAL_PRODUCT_IMAGE_FALLBACK_PRODUCT_IDS,
    },
  );
}

function normalizePublicSalesMeasures(products) {
  return products.map((product) => ({
    ...product,
    locations: (product.locations ?? []).map((location) => ({
      ...location,
      variants: (location.variants ?? []).map((variant) => ({
        ...variant,
        availableMeasures: resolveSalesMeasures(product.category, variant.availableMeasures),
      })),
    })),
  }));
}

function stripPublicPrices(products) {
  return products.map((product) => ({
    ...product,
    locations: (product.locations ?? []).map((location) => ({
      ...location,
      variants: (location.variants ?? []).map(({ prices: _prices, ...variant }) => variant),
    })),
  }));
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
  return Boolean(LIVE_CATALOG_URL) && now >= nextRevisionCheckAt;
}

/** Clears the in-memory snapshot cache. Used by tests and Retry. */
export function resetProductCache(_options = {}) {
  productsCache = null;
  initialProductsPromise = null;
  productsCacheSource = 'none';
  liveRevision = null;
  lastLiveLoadAt = 0;
  nextRevisionCheckAt = 0;
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
    const locationImages = imagesForVariants(entry.variants);
    list.push({
      ...rest,
      // A location without an uploaded image stays blank. Do not borrow a
      // confirmed photo from another Fresa list just because the product name
      // matches.
      images: locationImages,
      variants: entry.variants,
      catalogSource,
    });
  }
  return sortProducts(list);
}

/**
 * Product cards are location-scoped. A real upload in another catalog source
 * must not make this location appear to have a photo it does not have.
 * @param {Array<Record<string, any>>} variants
 */
function imagesForVariants(variants) {
  const seen = new Set();
  return (variants ?? []).flatMap((variant) => variant.images ?? []).filter((image) => {
    const src = String(image?.src ?? '').trim();
    if (!src) return false;
    const key = `${image?.id ?? ''}|${src}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
