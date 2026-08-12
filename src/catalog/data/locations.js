/**
 * Location configuration — the single place that decides, for each location a
 * visitor can pick:
 *
 *   selectedLocation  what the visitor chose (this file's `id`)
 *   serviceCenter     the branch that will handle the request
 *   catalogSource     which product list to show
 *
 * These are three different things. "Other U.S. location" is served by Houston
 * and shows the Houston catalog, but it is not Houston: the visitor also gives
 * a shipping destination (state, city, ZIP code), which is a fourth thing again.
 *
 * To add or change a location, edit LOCATIONS. Nothing else in the catalog
 * hard-codes a location.
 */

/** @typedef {import('../core/types').LocationConfig} LocationConfig */

/** @type {LocationConfig[]} */
export const LOCATIONS = [
  {
    id: 'houston',
    label: 'Houston, TX',
    serviceCenter: 'HOUSTON',
    catalogSource: 'houston',
    requiresShippingDestination: false,
    note: null,
  },
  {
    id: 'the-woodlands',
    label: 'The Woodlands, TX',
    serviceCenter: 'THE_WOODLANDS',
    catalogSource: 'houston',
    requiresShippingDestination: false,
    // The source data has one Texas product list. The Woodlands is served from
    // it while keeping its own service centre. If Esfenix starts exporting a
    // separate The Woodlands list, add it to scripts/catalog-source.config.mjs
    // and point catalogSource at it.
    note: 'Served from the Texas product list.',
  },
  {
    id: 'seattle',
    label: 'Seattle, WA',
    serviceCenter: 'SEATTLE',
    catalogSource: 'seattle',
    requiresShippingDestination: false,
    note: null,
  },
  {
    id: 'dmv',
    label: 'DMV Area',
    serviceCenter: 'DMV',
    catalogSource: 'dmv',
    requiresShippingDestination: false,
    note: 'Washington DC · Maryland · Virginia',
  },
  {
    id: 'other',
    label: 'Other U.S. location',
    serviceCenter: 'HOUSTON',
    catalogSource: 'houston',
    requiresShippingDestination: true,
    note: 'Handled by our Houston team.',
  },
];

/**
 * selectedLocation -> serviceCenter, as required by the quote payload.
 * @type {Record<string, string>}
 */
export const locationServiceMap = Object.fromEntries(
  LOCATIONS.map((location) => [location.id, location.serviceCenter]),
);

/** selectedLocation -> catalogSource. */
export const locationCatalogMap = Object.fromEntries(
  LOCATIONS.map((location) => [location.id, location.catalogSource]),
);

// Visitors without a saved or URL-selected location start here. This keeps
// the catalog on the Houston-served product list while asking for the actual
// shipping destination in the quote flow.
export const DEFAULT_LOCATION_ID = 'other';

/**
 * @param {string|null|undefined} id
 * @returns {LocationConfig|null}
 */
export function getLocation(id) {
  return LOCATIONS.find((location) => location.id === id) ?? null;
}

/**
 * Resolves any value to a usable location, falling back to the default.
 * @param {string|null|undefined} id
 * @returns {LocationConfig}
 */
export function resolveLocation(id) {
  return getLocation(id) ?? /** @type {LocationConfig} */ (getLocation(DEFAULT_LOCATION_ID));
}

/** @param {string|null|undefined} id */
export function isKnownLocation(id) {
  return getLocation(id) !== null;
}
