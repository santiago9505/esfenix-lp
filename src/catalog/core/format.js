/**
 * Presentation helpers.
 *
 * A product can carry hundreds of variants, so these reduce them to the
 * distinct values worth showing — and always from the data, so a product with
 * no colours contributes no colour row rather than a placeholder.
 */

/**
 * @typedef {import('./repository').LocationProduct} LocationProduct
 * @typedef {import('./types').ProductVariant} ProductVariant
 */

const MEASURE_LABELS = {
  stem: 'stem',
  bunch: 'bunch',
  unit: 'unit',
  pack: 'pack',
  box: 'box',
};

/**
 * @param {ProductVariant[]} variants
 * @param {'variety'|'color'} key
 * @returns {string[]}
 */
export function distinctValues(variants, key) {
  const set = new Set();
  for (const variant of variants) {
    const value = variant[key];
    if (value) set.add(value);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/**
 * @param {ProductVariant[]} variants
 * @returns {number[]}
 */
export function distinctLengths(variants) {
  const set = new Set();
  for (const variant of variants) {
    if (variant.lengthCm !== null && variant.lengthCm !== undefined) set.add(variant.lengthCm);
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * @param {ProductVariant[]} variants
 * @returns {string[]}
 */
export function distinctMeasures(variants) {
  const order = ['stem', 'bunch', 'unit', 'pack', 'box'];
  const set = new Set();
  for (const variant of variants) {
    for (const measure of variant.availableMeasures ?? []) set.add(measure);
  }
  return order.filter((measure) => set.has(measure));
}

/** @param {string[]} items */
export function listSentence(items) {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * A single line describing one quote item's options: "Freedom · Red · 60 cm · Bunch".
 * @param {import('./types').QuoteItem} item
 */
export function describeQuoteItem(item) {
  const parts = [];
  if (item.variety) parts.push(item.variety);
  if (item.color) parts.push(item.color);
  if (item.lengthCm !== null && item.lengthCm !== undefined) parts.push(`${item.lengthCm} cm`);
  if (item.measure) parts.push(capitalize(MEASURE_LABELS[item.measure] ?? item.measure));
  return parts.join(' · ');
}

/**
 * @param {ProductVariant} variant
 */
export function describeVariant(variant) {
  const parts = [];
  if (variant.variety) parts.push(variant.variety);
  if (variant.color) parts.push(variant.color);
  if (variant.lengthCm !== null && variant.lengthCm !== undefined) parts.push(`${variant.lengthCm} cm`);
  for (const [key, value] of Object.entries(variant.attributes ?? {})) {
    parts.push(describeAttribute(key, value));
  }
  return parts.join(' · ') || 'Standard';
}

/**
 * @param {string} key
 * @param {string|number|boolean} value
 */
export function describeAttribute(key, value) {
  if (key === 'stemsPerBunch') return `${value} stems per bunch`;
  if (key === 'origin') return `Origin: ${value}`;
  // Fall back to a readable rendering of whatever the data carries.
  const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
  return `${label}: ${value}`;
}

/** @param {string} value */
export function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Whether a product needs the visitor to choose before it can be added.
 * A product with exactly one variant and at most one measure is unambiguous.
 *
 * @param {LocationProduct} product
 */
export function needsVariantChoice(product) {
  if (product.variants.length !== 1) return true;
  return (product.variants[0].availableMeasures ?? []).length > 1;
}
