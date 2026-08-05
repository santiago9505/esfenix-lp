/**
 * The face shown at the top of the quote request screen.
 *
 * The visitor's selected location decides which portrait appears, so the form
 * feels like it is being handled by the team that will actually receive the
 * request. Portraits are keyed by the same ids as `data/locations.js`.
 *
 * Portraits are local square photographs so the quote screen does not depend on
 * a third-party image host or remote availability.
 *
 * A location without its own entry still gets a face — adding a location to
 * LOCATIONS never leaves this screen with a broken image.
 */

import { resolveLocation } from './locations.js';

/** @type {Record<string, string>} */
const PORTRAITS = {
  houston: '/assets/images/advisors/houston-real.webp',
  'the-woodlands': '/assets/images/advisors/the-woodlands-real.webp',
  seattle: '/assets/images/advisors/seattle-real.webp',
  dmv: '/assets/images/advisors/dmv-real.webp',
  other: '/assets/images/advisors/other-real.webp',
};

const PORTRAIT_FILES = Object.values(PORTRAITS);

/**
 * @param {string|null|undefined} locationId
 * @returns {{ src: string, alt: string, locationLabel: string }}
 */
export function resolveAdvisor(locationId) {
  const location = resolveLocation(locationId);
  return {
    src: PORTRAITS[location.id] ?? PORTRAIT_FILES[fallbackIndex(location.id)],
    alt: `Portrait of the Esfenix team for ${location.label}`,
    locationLabel: location.label,
  };
}

/** Stable per id, so the same location always shows the same face. */
function fallbackIndex(id) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) % 9973;
  return hash % PORTRAIT_FILES.length;
}
