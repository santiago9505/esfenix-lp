/**
 * Public sales presentations follow the product kind, not every populated
 * accounting price column. Flower records also carry a `unit_price`, but that
 * value must never turn Unit into a customer-facing option.
 */

const FLORAL_CATEGORIES = new Set(['roses', 'other-flowers', 'foliage']);

/**
 * @param {string|null|undefined} category
 * @param {Array<import('./types').MeasureType>} detectedMeasures
 * @returns {Array<import('./types').MeasureType>}
 */
export function resolveSalesMeasures(category, detectedMeasures = []) {
  if (!FLORAL_CATEGORIES.has(category)) return ['unit'];

  const measures = new Set(detectedMeasures);
  const floral = ['stem', 'bunch'].filter((measure) => measures.has(measure));
  if (floral.length > 0) return floral;

  // Preserve sparse/legacy data that has neither a stem nor bunch signal.
  return [...measures];
}
