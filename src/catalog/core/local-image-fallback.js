/**
 * Curated local photography fallback for the runtime Fresa catalog.
 *
 * Fresa remains the source of truth. Whole-product fallbacks are considered
 * only when the family has no usable Fresa image at all. A narrow allow-list
 * may additionally fill an exact variant that has no upload, without ever
 * replacing photography already supplied by Fresa.
 */

import { LOCAL_PRODUCT_IMAGES } from '../data/local-product-images.js';

/**
 * Kept for backwards compatibility with older imports. The repository opts
 * in explicitly for the curated products that have approved local photos.
 */
export const LOCAL_PRODUCT_IMAGE_FALLBACK_ENABLED = false;

/**
 * Product slugs with approved local photography. Keep this list narrow until
 * each product's local assets have been reviewed against its Fresa catalog.
 */
export const LOCAL_PRODUCT_IMAGE_FALLBACK_PRODUCT_IDS = ['garden-roses'];

/**
 * Products whose real Fresa photography may be supplemented only for exact
 * variants that still have no uploaded image. Existing Fresa images always
 * win; this list never replaces them or shares a nearby variety's photo.
 */
export const LOCAL_VARIANT_IMAGE_FALLBACK_PRODUCT_IDS = ['ec-roses'];

/**
 * Approved category artwork for products that do not have their own photo
 * yet. This is intentionally limited to Supplies: flowers keep showing the
 * photography-pending state unless an exact, reviewed image is available.
 */
export const LOCAL_CATEGORY_IMAGE_FALLBACKS = {
  supplies: {
    id: 'supplies-category-fallback',
    src: '/assets/images/products/supplies.webp',
    alt: 'Floral supplies',
  },
};

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
 * @param {{
 *   enabled?: boolean,
 *   productIds?: Iterable<string>,
 *   variantProductIds?: Iterable<string>,
 *   categoryFallbacks?: Record<string, { id: string, src: string, alt: string }>,
 * }} [options]
 */
export function applyLocalProductImageFallbacks(
  products,
  {
    enabled = LOCAL_PRODUCT_IMAGE_FALLBACK_ENABLED,
    productIds,
    variantProductIds,
    categoryFallbacks = LOCAL_CATEGORY_IMAGE_FALLBACKS,
  } = {},
) {
  if (!enabled) return products;

  const scopedProductIds = productIds ? new Set([...productIds].map((id) => String(id).trim())) : null;
  const scopedVariantProductIds = variantProductIds
    ? new Set([...variantProductIds].map((id) => String(id).trim()))
    : null;

  for (const product of products) {
    const usesWholeProductFallback = matchesProductScope(product, scopedProductIds);
    const usesExactVariantFallback = matchesProductScope(product, scopedVariantProductIds);
    const categoryFallback = categoryFallbacks?.[String(product.category ?? '').trim()] ?? null;
    if (!usesWholeProductFallback && !usesExactVariantFallback && !categoryFallback) continue;

    // Whole-product fallback remains deliberately all-or-nothing. If one
    // variant has a real API image, the broad family fallback stays disabled.
    const canUseWholeProductFallback = usesWholeProductFallback && !hasUsableImage(product.images);
    if (canUseWholeProductFallback) {
      const exactEntries = entriesForProduct(product);
      // The product gallery may use the closest photos from the same rose
      // family as additional context. Variant galleries remain exact-only so
      // a thumbnail identifies one variety.
      const entries = nearestEntries(product, exactEntries);
      if (entries.length > 0) product.images = toImages(entries, product.name);
    }

    // On the product page a selected variant uses its own gallery. Only attach
    // exact local matches: sharing nearby family photos across every variant
    // makes the gallery resolve any clicked thumbnail to the first variant.
    // Exact-variant supplementation is also safe for a partially photographed
    // family such as EC Roses because it never touches an existing API image.
    if (!canUseWholeProductFallback && !usesExactVariantFallback && !categoryFallback) continue;

    for (const location of product.locations ?? []) {
      for (const variant of location.variants ?? []) {
        if (hasUsableImage(variant.images)) continue;
        const variantEntries = entriesForVariant(product, variant);
        if (variantEntries.length > 0) {
          variant.images = toImages(variantEntries, product.name);
          continue;
        }
        if (categoryFallback) variant.images = [toCategoryFallback(categoryFallback, product.name)];
      }
    }

    if (categoryFallback && !hasUsableImage(product.images)) {
      product.images = [toCategoryFallback(categoryFallback, product.name)];
    }
  }

  return products;
}

/** @param {Record<string, any>} product @param {Set<string>|null} scope */
function matchesProductScope(product, scope) {
  if (!scope) return false;
  return scope.has(String(product.id ?? '').trim())
    || scope.has(String(product.slug ?? '').trim());
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

/**
 * @param {{ id: string, src: string, alt: string }} fallback
 * @param {string} productName
 */
function toCategoryFallback(fallback, productName) {
  return {
    ...fallback,
    alt: `${productName} — ${fallback.alt}`,
    isPrimary: true,
    isFallback: true,
  };
}
