/**
 * Public sales presentations follow the product kind, not every populated
 * accounting price column. Flower records also carry a `unit_price`, but that
 * value must never turn Unit into a customer-facing option.
 */

const FLORAL_CATEGORIES = new Set(['roses', 'other-flowers', 'foliage']);

/**
 * @param {string|null|undefined} category
 * @param {Array<import('./types').MeasureType>} detectedMeasures
 * @param {{ hasStemPrice?: boolean|null }} [options]
 * @returns {Array<import('./types').MeasureType>}
 */
export function resolveSalesMeasures(category, detectedMeasures = [], options = {}) {
  if (!FLORAL_CATEGORIES.has(category)) return ['unit'];

  const measures = new Set(detectedMeasures);
  const hasStemPrice = options.hasStemPrice;

  // When the source exposes stem_price, its populated/blank state is the
  // authority. A stem-priced flower is also sold by bunch; otherwise the
  // flower is sold only by bunch.
  if (typeof hasStemPrice === 'boolean') {
    return hasStemPrice ? ['stem', 'bunch'] : ['bunch'];
  }

  // Static snapshots intentionally contain no prices. Their prior normalized
  // measures (or the source sales_unit when prices are unavailable) retain
  // enough information to apply the same presentation rule.
  if (measures.has('stem')) return ['stem', 'bunch'];
  if (measures.has('bunch')) return ['bunch'];

  // Preserve sparse/legacy data that has neither a stem nor bunch signal.
  return [...measures];
}
