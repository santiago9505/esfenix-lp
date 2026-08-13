/**
 * The selected location, and — for "Other U.S. location" — where the order
 * would ship.
 *
 * Three separate ideas, kept separate on purpose:
 *
 *   selectedLocation     what the visitor picked; decides which catalog shows
 *   serviceCenter        derived from it via locationServiceMap; never stored
 *   shippingDestination  the customer's own state / city / ZIP code
 *
 * Resolution order on load: URL parameter, then the last stored choice, then
 * the default. The URL wins so a shared link always shows what it promises.
 */

import { createStore } from './store.js';
import { read, write } from './storage.js';
import { readSession, writeSession } from './session-storage.js';
import { DEFAULT_LOCATION_ID, isKnownLocation, resolveLocation } from '../data/locations.js';
import { readLocationFromUrl } from './url-state.js';

const LOCATION_KEY = 'location';
const DESTINATION_KEY = 'shipping-destination';

/**
 * @typedef {import('./types').ShippingDestination} ShippingDestination
 * @typedef {{ locationId: string, shippingDestination: ShippingDestination|null }} LocationState
 */

/** @param {ShippingDestination|null} value */
function normalizeDestination(value) {
  if (!value || typeof value !== 'object') return null;
  const state = String(value.state ?? '').trim();
  const city = String(value.city ?? '').trim();
  const zipCode = String(value.zipCode ?? '').trim();
  if (!state && !city && !zipCode) return null;
  return { state, city, zipCode };
}

export function createLocationStore() {
  const fromUrl = readLocationFromUrl();
  const stored = read(LOCATION_KEY, null);
  const initialId = fromUrl ?? (isKnownLocation(stored) ? stored : DEFAULT_LOCATION_ID);

  const store = createStore(
    /** @type {LocationState} */ ({
      locationId: initialId,
      shippingDestination: normalizeDestination(readSession(DESTINATION_KEY, null)),
    }),
  );

  store.subscribe((state) => {
    write(LOCATION_KEY, state.locationId);
    writeSession(DESTINATION_KEY, state.shippingDestination);
  });

  return {
    subscribe: store.subscribe,
    getState: store.getState,

    getId() {
      return store.getState().locationId;
    },

    /** The full config: label, service centre, catalog source. */
    get() {
      return resolveLocation(store.getState().locationId);
    },

    getServiceCenter() {
      return resolveLocation(store.getState().locationId).serviceCenter;
    },

    /** @returns {ShippingDestination|null} */
    getShippingDestination() {
      return store.getState().shippingDestination;
    },

    /** Whether the current location still needs a shipping destination. */
    needsShippingDestination() {
      const location = resolveLocation(store.getState().locationId);
      if (!location.requiresShippingDestination) return false;
      const destination = store.getState().shippingDestination;
      return !destination || !destination.state || !destination.city || !destination.zipCode;
    },

    /**
     * @param {string} locationId
     */
    setLocation(locationId) {
      if (!isKnownLocation(locationId)) return;
      const state = store.getState();
      if (state.locationId === locationId) return;

      const next = resolveLocation(locationId);
      store.setState({
        locationId,
        // A destination only means something for "Other U.S. location";
        // picking a branch clears it so it cannot leak into the next request.
        shippingDestination: next.requiresShippingDestination ? state.shippingDestination : null,
      });
    },

    /**
     * @param {ShippingDestination|null} destination
     */
    setShippingDestination(destination) {
      store.setState({ ...store.getState(), shippingDestination: normalizeDestination(destination) });
    },
  };
}
