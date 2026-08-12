/**
 * Translates catalog products into the values the Fresa quote form expects.
 *
 * The form asks for a location, then repeating rows of {Producto, Quantity}
 * drawn from a fixed per-location list. It has no colour, variety, length or
 * measure field of its own — length and colour are folded into the product
 * label ("Ecuadorian Roses - 60cm", "Peony - white").
 *
 * So a quote line becomes:
 *   Producto  -> the matching option label from that location's list
 *   Quantity  -> the line quantity
 * and everything the form cannot represent (variety, colour, measure, stem
 * length for non-rose products) is written into "Notes for the seller" instead
 * of being dropped.
 */

import { FRESA_FORM } from '../data/fresa-form.js';
import { FRESA_PRODUCT_ALIASES } from '../data/fresa-product-aliases.js';
import { resolveCatalogFamily } from '../data/catalog-taxonomy.js';
import { locationCatalogMap } from '../data/locations.js';

/**
 * @typedef {import('./types').ProductVariant} ProductVariant
 * @typedef {import('./types').QuoteItem} QuoteItem
 */

/** @param {string} value */
function normalize(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** @param {string} value */
function slug(value) {
  return normalize(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** @type {Map<string, Map<string, string>>} */
const indexBySource = new Map();

/**
 * @param {string} catalogSource
 * @returns {Map<string, string>} normalized label -> exact label
 */
function optionIndex(catalogSource) {
  if (!indexBySource.has(catalogSource)) {
    const options = FRESA_FORM.productOptions[catalogSource] ?? [];
    indexBySource.set(catalogSource, new Map(options.map((option) => [normalize(option), option])));
  }
  return indexBySource.get(catalogSource);
}

/** The form's label for a selected location, e.g. "TX - HOUSTON". */
export function fresaLocationLabel(locationId) {
  return FRESA_FORM.locationOptions[locationId] ?? null;
}

export function fresaFormUrl() {
  return FRESA_FORM.formUrl;
}

/**
 * Resolves the form option for one product variant.
 *
 * @param {string} locationId a selectable location id
 * @param {{ id: string, name: string }} product
 * @param {ProductVariant} variant
 * @returns {{ option: string|null, candidates: string[] }}
 */
export function resolveFresaProduct(locationId, product, variant) {
  const catalogSource = locationCatalogMap[locationId] ?? locationId;
  const index = optionIndex(catalogSource);

  const family = resolveCatalogFamily(product.name);
  const canonicalName = family?.groupLabel ?? product.name;
  const alias = [product.id, family?.group, slug(product.name), slug(canonicalName)]
    .filter(Boolean)
    .map((key) => FRESA_PRODUCT_ALIASES[key])
    .find(Boolean);
  const candidates = alias ? alias(variant) : [];

  // Grouped families can still map to length-qualified Fresa options. Keep
  // several harmless label shapes because the form vocabulary may use either
  // `Product 60`, `Product 60cm`, or `Product - 60cm`.
  if (variant.lengthCm !== null && variant.lengthCm !== undefined) {
    candidates.push(`${canonicalName} ${variant.lengthCm}`);
    candidates.push(`${canonicalName} ${variant.lengthCm}cm`);
    candidates.push(`${canonicalName} - ${variant.lengthCm}cm`);
    candidates.push(`${product.name} ${variant.lengthCm}`);
    candidates.push(`${product.name} ${variant.lengthCm}cm`);
    candidates.push(`${product.name} - ${variant.lengthCm}cm`);
  }
  candidates.push(canonicalName);
  candidates.push(product.name);

  for (const candidate of candidates) {
    const match = index.get(normalize(candidate));
    if (match) return { option: match, candidates };
  }
  return { option: null, candidates };
}

/**
 * Resolves the form option for a quote line.
 *
 * A QuoteItem is flat, so this rebuilds the minimal variant shape the alias
 * rules need. Attributes are not carried on quote lines, which is why lines
 * that depend on them (Canadian-grown Lisianthus, 20-stem Leather Leaf) resolve
 * to the default option and state the difference in the notes.
 *
 * @param {QuoteItem} item
 * @returns {{ option: string|null, candidates: string[] }}
 */
export function resolveFresaProductForItem(item) {
  return resolveFresaProduct(
    item.selectedLocation,
    { id: item.productId, name: item.productName },
    {
      id: item.id,
      variety: item.variety,
      color: item.color,
      lengthCm: item.lengthCm,
      availableMeasures: item.measure ? [item.measure] : [],
    },
  );
}

/**
 * Everything about a line the form has no field for. Goes into the notes so it
 * still reaches the seller.
 *
 * @param {QuoteItem} item
 * @returns {string[]}
 */
export function unrepresentedDetails(item) {
  const details = [];
  if (item.variety) details.push(`variety ${item.variety}`);
  if (item.color) details.push(`color ${item.color}`);
  // Length is only part of the option label for roses; for anything else the
  // form cannot express it.
  if (item.lengthCm !== null && item.lengthCm !== undefined && item.category !== 'roses') {
    details.push(`${item.lengthCm} cm`);
  }
  if (item.measure) details.push(`by ${item.measure}`);
  return details;
}
