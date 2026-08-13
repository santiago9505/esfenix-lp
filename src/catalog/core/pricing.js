/**
 * Internal catalog pricing.
 *
 * Prices are used only for order-type eligibility. They are intentionally kept
 * outside the public product model and outside QuotePayload, which remains a
 * quote request rather than a checkout payload.
 */

export const DELIVERY_MINIMUM_CENTS = 15_000;

const PRICE_KEYS_BY_MEASURE = {
  stem: 'stem',
  bunch: 'bunch',
  unit: 'unit',
  pack: 'pack',
  box: 'box',
};

// The map is keyed by the stable Fresa variant id so grouping/merging and
// location projections can safely clone variant objects without losing price
// metadata or exposing it through JSON.stringify().
const pricesByVariantId = new Map();

/**
 * @param {{ id?: unknown }} variant
 * @param {Record<string, unknown>} prices
 */
export function rememberVariantPrices(variant, prices) {
  const id = String(variant?.id ?? '').trim();
  if (!id) return;

  // A later Fresa refresh may turn a populated metric into an empty one.
  // Remove the previous value before storing the current response.
  pricesByVariantId.delete(id);

  const normalized = {};
  for (const measure of Object.keys(PRICE_KEYS_BY_MEASURE)) {
    const cents = priceToCents(prices?.[measure]);
    if (cents !== null) normalized[measure] = cents;
  }

  if (Object.keys(normalized).length > 0) pricesByVariantId.set(id, normalized);
}

/**
 * @param {{ id?: unknown }|null|undefined} variant
 * @param {string|null|undefined} measure
 * @returns {number|null} price in cents, or null when that metric is absent
 */
export function getVariantPriceCents(variant, measure) {
  const id = String(variant?.id ?? '').trim();
  const key = PRICE_KEYS_BY_MEASURE[String(measure ?? '').trim().toLowerCase()];
  if (!id || !key) return null;
  return pricesByVariantId.get(id)?.[key] ?? null;
}

/**
 * Calculates the internal order total. A line without a price for its selected
 * metric makes delivery ineligible because the $150 threshold cannot be
 * proven safely.
 *
 * @param {Array<{ productId?: string, variety?: string|null, color?: string|null, lengthCm?: number|null, measure?: string|null, quantity?: number }>} items
 * @param {Array<{ id?: string, variants?: Array<Record<string, any>> }>} products
 */
export function getQuotePricing(items = [], products = []) {
  const productsById = new Map(products.map((product) => [product?.id, product]));
  let totalCents = 0;
  const unknownItems = [];

  for (const item of items) {
    const product = productsById.get(item?.productId);
    const variant = product?.variants?.find((candidate) =>
      (candidate.variety ?? null) === (item?.variety ?? null) &&
      (candidate.color ?? null) === (item?.color ?? null) &&
      (candidate.lengthCm ?? null) === (item?.lengthCm ?? null),
    );
    const unitPriceCents = getVariantPriceCents(variant, item?.measure);
    const quantity = Number.isInteger(item?.quantity) && item.quantity > 0 ? item.quantity : 0;

    if (unitPriceCents === null || quantity === 0) {
      unknownItems.push({
        productId: item?.productId ?? null,
        productName: item?.productName ?? null,
        measure: item?.measure ?? null,
      });
      continue;
    }
    totalCents += unitPriceCents * quantity;
  }

  const calculatedProgress = Math.min(100, Math.floor((totalCents / DELIVERY_MINIMUM_CENTS) * 100));
  // An incomplete price set can never unlock Delivery. Keep the visual
  // progress below 100% until every selected line has been confirmed.
  const deliveryProgress = unknownItems.length > 0
    ? Math.min(99, calculatedProgress)
    : calculatedProgress;

  return {
    totalCents,
    hasUnknownPricing: unknownItems.length > 0,
    unknownItems,
    // Keep the progress percentage separate from the total so the UI can show
    // proximity to the threshold without exposing any amount to the visitor.
    deliveryProgress,
    deliveryAllowed: unknownItems.length === 0 && totalCents >= DELIVERY_MINIMUM_CENTS,
  };
}

/** @param {unknown} value @returns {number|null} */
export function priceToCents(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return null;

  const normalized = String(value).trim().replace(/[$€£\s]/g, '').replace(/,/g, '');
  if (!normalized) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
}
