/**
 * The quote list: the products a visitor has selected, ready to be sent to the
 * quote form.
 *
 * This is not a cart. It holds no prices, no totals and no payment state, and
 * the vocabulary throughout is "quote list" / "selected products".
 *
 * A quote list belongs to exactly one location. Products vary by location, so
 * mixing two locations in one request would produce a quote Esfenix cannot
 * fulfil — `setLocation` therefore either keeps the list (same location) or
 * replaces it wholesale (confirmed change). There is no partial merge.
 */

import { createStore } from './store.js';
import { read, write } from './storage.js';
import { locationServiceMap, resolveLocation } from '../data/locations.js';

/**
 * @typedef {import('./types').QuoteItem} QuoteItem
 * @typedef {import('./types').MeasureType} MeasureType
 * @typedef {import('./repository').LocationProduct} LocationProduct
 * @typedef {{ variantId: string, measure: MeasureType|null, quantity: number }} VariantSelection
 */

const STORAGE_KEY = 'quote';

/**
 * @typedef {{ location: string, items: QuoteItem[] }} QuoteState
 */

/** @param {string} defaultLocation */
function initialState(defaultLocation) {
  const stored = read(STORAGE_KEY, null);
  if (stored && typeof stored.location === 'string' && Array.isArray(stored.items)) {
    return { location: stored.location, items: stored.items.filter(isWellFormed) };
  }
  return { location: defaultLocation, items: [] };
}

/** @param {unknown} item */
function isWellFormed(item) {
  return (
    item &&
    typeof item === 'object' &&
    typeof item.id === 'string' &&
    typeof item.productId === 'string' &&
    Number.isInteger(item.quantity) &&
    item.quantity > 0
  );
}

/**
 * @param {string} defaultLocation
 */
export function createQuoteStore(defaultLocation) {
  const store = createStore(/** @type {QuoteState} */ (initialState(defaultLocation)));

  store.subscribe((state) => write(STORAGE_KEY, state));

  return {
    subscribe: store.subscribe,
    getState: store.getState,

    /** @returns {QuoteItem[]} */
    getItems() {
      return store.getState().items;
    },

    /** The location this quote list belongs to. */
    getLocation() {
      return store.getState().location;
    },

    getCount() {
      return store.getState().items.length;
    },

    /** Total selected units across all lines, for the "3 products" label. */
    getTotalQuantity() {
      return store.getState().items.reduce((sum, item) => sum + item.quantity, 0);
    },

    isEmpty() {
      return store.getState().items.length === 0;
    },

    /**
     * @param {string} productId
     * @param {string} variantId
     * @param {MeasureType|null} measure
     */
    findLine(productId, variantId, measure) {
      const id = lineId(productId, variantId, measure);
      return store.getState().items.find((item) => item.id === id) ?? null;
    },

    /**
     * Adds a validated line. Adding the same variant and measure again
     * increases the quantity instead of creating a duplicate row.
     *
     * @param {LocationProduct} product
     * @param {VariantSelection} selection
     * @returns {{ ok: true, item: QuoteItem } | { ok: false, errors: string[] }}
     */
    addItem(product, selection) {
      const state = store.getState();
      const validation = validateSelection(product, selection);
      if (!validation.ok) return validation;

      const { variant } = validation;
      const measure = selection.measure ?? null;
      const id = lineId(product.id, variant.id, measure);

      /** @type {QuoteItem} */
      const item = {
        id,
        productId: product.id,
        productName: product.name,
        category: product.category,
        selectedLocation: state.location,
        serviceCenter: locationServiceMap[state.location] ?? resolveLocation(state.location).serviceCenter,
        variety: variant.variety ?? null,
        color: variant.color ?? null,
        lengthCm: variant.lengthCm ?? null,
        measure,
        quantity: selection.quantity,
      };

      const existing = state.items.find((entry) => entry.id === id);
      const items = existing
        ? state.items.map((entry) =>
            entry.id === id ? { ...entry, quantity: entry.quantity + selection.quantity } : entry,
          )
        : [...state.items, item];

      store.setState({ ...state, items });
      return { ok: true, item: items.find((entry) => entry.id === id) };
    },

    /**
     * @param {string} id
     * @param {number} quantity
     * @returns {{ ok: boolean, errors?: string[] }}
     */
    setQuantity(id, quantity) {
      if (!Number.isInteger(quantity) || quantity < 1) {
        return { ok: false, errors: ['Quantity must be a whole number greater than zero.'] };
      }
      const state = store.getState();
      store.setState({
        ...state,
        items: state.items.map((item) => (item.id === id ? { ...item, quantity } : item)),
      });
      return { ok: true };
    },

    /** @param {string} id */
    removeItem(id) {
      const state = store.getState();
      store.setState({ ...state, items: state.items.filter((item) => item.id !== id) });
    },

    clear() {
      store.setState({ ...store.getState(), items: [] });
    },

    /**
     * Points the quote list at a location.
     *
     * Same location: nothing changes. Different location: the list is cleared,
     * because its lines describe products from the previous location's catalog.
     * Callers are expected to have confirmed this with the visitor first —
     * see ui/location-change-modal.js.
     *
     * @param {string} location
     */
    setLocation(location) {
      const state = store.getState();
      if (state.location === location) return;
      store.setState({ location, items: [] });
    },

    /**
     * Re-checks every line against the current catalog and drops the ones that
     * no longer exist. Used after the data reloads.
     *
     * @param {LocationProduct[]} products
     * @returns {QuoteItem[]} the removed lines
     */
    reconcile(products) {
      const state = store.getState();
      const byId = new Map(products.map((product) => [product.id, product]));

      const kept = [];
      const dropped = [];
      for (const item of state.items) {
        const product = byId.get(item.productId);
        const stillValid =
          product &&
          product.variants.some(
            (variant) =>
              (variant.variety ?? null) === item.variety &&
              (variant.color ?? null) === item.color &&
              (variant.lengthCm ?? null) === item.lengthCm &&
              (item.measure === null || (variant.availableMeasures ?? []).includes(item.measure)),
          );
        (stillValid ? kept : dropped).push(item);
      }

      if (dropped.length > 0) store.setState({ ...state, items: kept });
      return dropped;
    },
  };
}

/**
 * @param {string} productId
 * @param {string} variantId
 * @param {MeasureType|null} measure
 */
export function lineId(productId, variantId, measure) {
  return `${productId}__${variantId}__${measure ?? 'nomeasure'}`;
}

/**
 * Validates a selection against the product as it exists in the current
 * location's catalog. Nothing reaches the quote list without passing here.
 *
 * @param {LocationProduct} product
 * @param {VariantSelection} selection
 * @returns {{ ok: true, variant: import('./types').ProductVariant } | { ok: false, errors: string[] }}
 */
export function validateSelection(product, selection) {
  const errors = [];

  if (!product || !Array.isArray(product.variants) || product.variants.length === 0) {
    return { ok: false, errors: ['This product is not available in the selected location.'] };
  }

  const variant = product.variants.find((entry) => entry.id === selection?.variantId);
  if (!variant) {
    errors.push('Select an available option for this product.');
  }

  const quantity = selection?.quantity;
  if (!Number.isInteger(quantity) || quantity < 1) {
    errors.push('Quantity must be a whole number greater than zero.');
  }

  if (variant) {
    const measures = variant.availableMeasures ?? [];
    if (measures.length > 0) {
      if (!selection.measure) errors.push('Choose how you want this product measured.');
      else if (!measures.includes(selection.measure)) {
        errors.push('That measure is not available for this option.');
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, variant };
}

/**
 * Finds the variant matching a variety/colour/length choice.
 *
 * @param {LocationProduct} product
 * @param {{ variety?: string|null, color?: string|null, lengthCm?: number|null }} choice
 * @returns {import('./types').ProductVariant|null}
 */
export function findVariant(product, choice) {
  return (
    product.variants.find(
      (variant) =>
        (variant.variety ?? null) === (choice.variety ?? null) &&
        (variant.color ?? null) === (choice.color ?? null) &&
        (variant.lengthCm ?? null) === (choice.lengthCm ?? null),
    ) ?? null
  );
}
