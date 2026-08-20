/**
 * Legacy local photography fallback for the runtime Fresa catalog.
 *
 * Fresa remains the source of truth. Local photos are considered only when a
 * product has no usable Fresa image at all; a single non-empty API image keeps
 * the product exclusively on API photography.
 */

import { LOCAL_PRODUCT_IMAGES } from '../data/local-product-images.js';

/**
 * Kept for backwards compatibility with older imports, but disabled so a
 * missing Fresa upload remains a blank placeholder.
 */
export const LOCAL_PRODUCT_IMAGE_FALLBACK_ENABLED = false;

const LOCAL_KEY_ALIASES = new Map([
  ['candelight', 'candlelight'],
  ['frutteto', 'frutetto'],
  ['pink mondal', 'pink mondial'],
  ['toffe', 'toffee'],
  ['country', 'country garden'],
  ['reeva', 'orange reeva'],
  ['ssilantoi', 'silanoi'],
  ['swwt unique', 'sweet unique'],
  ['super sun', 'supersun'],
  ['charming cornelle', 'charming corneille'],
  ['mastie park', 'mastiek park'],
  ['dolcceto', 'dolceto'],
]);

/**
 * Adds the delivered local images to products that have no usable Fresa
 * image. The input is mutated in place so existing repository references and
 * quote flows remain unchanged.
 *
 * @param {Array<Record<string, any>>} products
 * @param {{ enabled?: boolean }} [options]
 */
export function applyLocalProductImageFallbacks(
  products,
  { enabled = LOCAL_PRODUCT_IMAGE_FALLBACK_ENABLED } = {},
) {
  if (!enabled) return products;

  for (const product of products) {
    // This guard is deliberately product-wide. If one variant has a real API
    // image, local photography must not be mixed into that product's gallery.
    if (hasUsableImage(product.images)) continue;

    const exactEntries = entriesForProduct(product);
    // The product gallery may use the closest photos from the same rose
    // family as additional context. Variant galleries remain exact-only.
    const entries = nearestEntries(product, exactEntries);
    if (entries.length === 0) continue;

    product.images = toImages(entries, product.name);

    // On the product page a selected variant uses its own gallery. Prefer an
    // exact local match, then use a small nearby family set when Fresa did not
    // provide enough detail to identify a variety (for example `EC ROSES 60`).
    for (const location of product.locations ?? []) {
      for (const variant of location.variants ?? []) {
        if (hasUsableImage(variant.images)) continue;
        const variantEntries = entriesForVariant(product, variant);
        const nearbyEntries = nearestEntries(product, variantEntries).slice(0, 8);
        if (nearbyEntries.length > 0) variant.images = toImages(nearbyEntries, product.name);
      }
    }
  }

  return products;
}

/** @param {Record<string, any>} product */
function entriesForProduct(product) {
  const variants = (product.locations ?? []).flatMap((location) => location.variants ?? []);
  const entries = variants.flatMap((variant) => entriesForVariant(product, variant));
  return uniqueEntries(entries);
}

/** @param {Record<string, any>} product */
function nearestEntries(product, exactEntries) {
  const family = localFamilyForProduct(product);
  if (!family) return [];
  const familyEntries = LOCAL_PRODUCT_IMAGES.filter((entry) => entry.family === family);
  return uniqueEntries([...exactEntries, ...familyEntries]);
}

/** @param {Record<string, any>} product @param {Record<string, any>} variant */
function entriesForVariant(product, variant) {
  const family = localFamilyForProduct(product);
  if (!family) return [];

  const keys = new Set(
    [variant.variety, product.variety]
      .map(normalizeLocalKey)
      .filter(Boolean),
  );
  if (keys.size === 0) return [];

  return LOCAL_PRODUCT_IMAGES.filter(
    (entry) => entry.family === family && keys.has(normalizeLocalKey(entry.key)),
  );
}

/** @param {Record<string, any>} product */
function localFamilyForProduct(product) {
  const id = normalizeLocalKey(product.id);
  const name = normalizeLocalKey(product.name);
  const labels = `${id} ${name}`;

  if (labels.includes('garden roses')) return 'garden';
  if (
    /(^| )(?:ec|ecuador|ecuadorian) roses?( |$)/.test(labels) ||
    labels.trim() === 'roses'
  ) return 'standard';
  return null;
}

/** @param {unknown} value */
function normalizeLocalKey(value) {
  const normalized = String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  return LOCAL_KEY_ALIASES.get(normalized) ?? normalized;
}

/** @param {unknown} images */
function hasUsableImage(images) {
  return Array.isArray(images) && images.some((image) => String(image?.src ?? '').trim());
}

/** @param {Array<Record<string, any>>} entries */
function uniqueEntries(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

/** @param {Array<Record<string, any>>} entries @param {string} productName */
function toImages(entries, productName) {
  return entries.map((entry, index) => ({
    id: entry.id,
    src: entry.src,
    alt: `${productName} — ${entry.originalName}`,
    isPrimary: index === 0,
    isFallback: true,
  }));
}
