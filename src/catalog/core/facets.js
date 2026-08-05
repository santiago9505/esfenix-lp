/**
 * Filtering and facet computation.
 *
 * Two rules drive everything here:
 *
 *  - Filters are cumulative and evaluated per variant. Colour "White" plus
 *    length 60 means one variant that is both, not a white variant and a
 *    separate 60 cm variant.
 *  - Facets are computed from the products that match every *other* active
 *    filter, so the options shown are always reachable and a facet never
 *    renders empty or with dead options.
 */

import { CATEGORY_ORDER, getCategoryLabel } from '../data/categories.js';

/**
 * @typedef {import('./types').FilterState} FilterState
 * @typedef {import('./types').Facet} Facet
 * @typedef {import('./repository').LocationProduct} LocationProduct
 */

/** Facet order is the order the brief specifies. */
export const FACET_DEFINITIONS = [
  { id: 'category', label: 'Type product', level: 'product' },
  { id: 'variety', label: 'Variety', level: 'variant' },
  { id: 'color', label: 'Color', level: 'variant' },
  { id: 'lengthCm', label: 'Stem length', level: 'variant' },
  { id: 'measure', label: 'Available as', level: 'variant' },
];

const MEASURE_LABELS = {
  stem: 'Stem',
  bunch: 'Bunch',
  unit: 'Unit',
  pack: 'Pack',
  box: 'Box',
};

/** @returns {FilterState} */
export function emptyFilters() {
  return { category: [], variety: [], color: [], lengthCm: [], measure: [] };
}

/** @param {FilterState} filters */
export function countActiveFilters(filters) {
  return Object.values(filters).reduce((sum, values) => sum + values.length, 0);
}

/** @param {FilterState} filters */
export function hasActiveFilters(filters) {
  return countActiveFilters(filters) > 0;
}

/**
 * Does one variant satisfy the variant-level filters?
 * @param {import('./types').ProductVariant} variant
 * @param {FilterState} filters
 * @param {string} [ignore] facet id to leave out, when computing that facet
 */
function variantMatches(variant, filters, ignore) {
  if (ignore !== 'variety' && filters.variety.length > 0) {
    if (!variant.variety || !filters.variety.includes(variant.variety)) return false;
  }
  if (ignore !== 'color' && filters.color.length > 0) {
    if (!variant.color || !filters.color.includes(variant.color)) return false;
  }
  if (ignore !== 'lengthCm' && filters.lengthCm.length > 0) {
    if (variant.lengthCm === null || variant.lengthCm === undefined) return false;
    if (!filters.lengthCm.includes(variant.lengthCm)) return false;
  }
  if (ignore !== 'measure' && filters.measure.length > 0) {
    const measures = variant.availableMeasures ?? [];
    if (!filters.measure.some((measure) => measures.includes(measure))) return false;
  }
  return true;
}

/**
 * The variants of a product that satisfy the current filters.
 * @param {LocationProduct} product
 * @param {FilterState} filters
 * @param {string} [ignore]
 */
export function matchingVariants(product, filters, ignore) {
  return product.variants.filter((variant) => variantMatches(variant, filters, ignore));
}

/**
 * @param {LocationProduct} product
 * @param {FilterState} filters
 * @param {string} [ignore]
 */
function productMatches(product, filters, ignore) {
  if (ignore !== 'category' && filters.category.length > 0) {
    if (!filters.category.includes(product.category)) return false;
  }
  return matchingVariants(product, filters, ignore).length > 0;
}

/**
 * @param {LocationProduct[]} products
 * @param {FilterState} filters
 * @returns {LocationProduct[]}
 */
export function filterProducts(products, filters) {
  return products.filter((product) => productMatches(product, filters));
}

/**
 * Builds the facets to render.
 *
 * A facet is omitted entirely when it has no options — which is what makes
 * Variety disappear for products with no varieties, Stem length disappear for
 * products with no lengths, and so on, without any of that being hard-coded.
 *
 * @param {LocationProduct[]} products all products for the location
 * @param {FilterState} filters
 * @returns {Facet[]}
 */
export function buildFacets(products, filters) {
  const facets = [];

  for (const definition of FACET_DEFINITIONS) {
    // Everything that survives the *other* filters is what this facet may offer.
    const pool = products.filter((product) => productMatches(product, filters, definition.id));

    /** @type {Map<string|number, number>} */
    const counts = new Map();

    for (const product of pool) {
      if (definition.id === 'category') {
        counts.set(product.category, (counts.get(product.category) ?? 0) + 1);
        continue;
      }

      // Count each product once per distinct value, not once per variant.
      const values = new Set();
      for (const variant of matchingVariants(product, filters, definition.id)) {
        if (definition.id === 'measure') {
          for (const measure of variant.availableMeasures ?? []) values.add(measure);
        } else {
          const value = variant[definition.id];
          if (value !== null && value !== undefined) values.add(value);
        }
      }
      for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    }

    // Supplies is intentionally available as a request-only category even
    // before its product list is imported into the catalog data.
    if (definition.id === 'category') counts.set('supplies', counts.get('supplies') ?? 0);

    const selected = filters[definition.id] ?? [];
    const options = [...counts.entries()]
      .map(([value, count]) => ({
        value,
        label: facetLabel(definition.id, value),
        count,
        selected: selected.includes(value),
      }))
      .sort((a, b) => compareOptions(definition.id, a, b));

    if (options.length === 0) continue;
    // A single option that every product shares tells the visitor nothing and
    // cannot narrow anything down, so it is not worth a filter row.
    if (options.length === 1 && !options[0].selected && definition.id !== 'category') continue;

    facets.push({ id: definition.id, label: definition.label, options });
  }

  return facets;
}

/**
 * @param {string} facetId
 * @param {string|number} value
 */
function facetLabel(facetId, value) {
  if (facetId === 'category') return getCategoryLabel(String(value));
  if (facetId === 'measure') return MEASURE_LABELS[value] ?? String(value);
  if (facetId === 'lengthCm') return `${value} cm`;
  return String(value);
}

const MEASURE_ORDER = ['stem', 'bunch', 'unit', 'pack', 'box'];

function compareOptions(facetId, a, b) {
  if (facetId === 'lengthCm') return Number(a.value) - Number(b.value);
  if (facetId === 'measure') {
    return MEASURE_ORDER.indexOf(String(a.value)) - MEASURE_ORDER.indexOf(String(b.value));
  }
  if (facetId === 'category') {
    return CATEGORY_ORDER.indexOf(String(a.value)) - CATEGORY_ORDER.indexOf(String(b.value));
  }
  return a.label.localeCompare(b.label);
}

/**
 * Toggles one value of one facet, returning a new FilterState.
 * @param {FilterState} filters
 * @param {keyof FilterState} facetId
 * @param {string|number} value
 * @returns {FilterState}
 */
export function toggleFilter(filters, facetId, value) {
  const current = filters[facetId] ?? [];
  const next = current.includes(value)
    ? current.filter((entry) => entry !== value)
    : [...current, value];
  return { ...filters, [facetId]: next };
}

/**
 * Drops any selected value that the given products can no longer satisfy.
 * Called after a location change so stale selections do not silently produce
 * an empty result.
 *
 * @param {LocationProduct[]} products
 * @param {FilterState} filters
 * @returns {FilterState}
 */
export function pruneFilters(products, filters) {
  const available = {
    // Categories are configuration, not data: Supplies stays selectable even
    // where it has no products, so it can present itself.
    category: new Set(CATEGORY_ORDER),
    variety: new Set(),
    color: new Set(),
    lengthCm: new Set(),
    measure: new Set(),
  };

  for (const product of products) {
    for (const variant of product.variants) {
      if (variant.variety) available.variety.add(variant.variety);
      if (variant.color) available.color.add(variant.color);
      if (variant.lengthCm !== null && variant.lengthCm !== undefined) {
        available.lengthCm.add(variant.lengthCm);
      }
      for (const measure of variant.availableMeasures ?? []) available.measure.add(measure);
    }
  }

  const pruned = emptyFilters();
  for (const key of Object.keys(pruned)) {
    pruned[key] = (filters[key] ?? []).filter((value) => available[key].has(value));
  }
  return pruned;
}
