/**
 * The supplies a visitor wants more information about.
 *
 * Deliberately separate from the quote list: supplies change often and are
 * not always available, so they are never added as products. The selection
 * only travels with the next quote request as a list of names, and is kept in
 * localStorage so it survives moving between the catalog and the form.
 */

import { read, remove, write } from './storage.js';
import { normalizeSupplyIds, supplyLabels } from '../data/supplies.js';

const STORAGE_KEY = 'suppliesInterest.v1';

export function createSuppliesInterestStore() {
  let ids = normalizeSupplyIds(read(STORAGE_KEY, []));
  /** @type {Set<(ids: string[]) => void>} */
  const listeners = new Set();

  function commit(next) {
    ids = normalizeSupplyIds(next);
    if (ids.length > 0) write(STORAGE_KEY, ids);
    else remove(STORAGE_KEY);
    for (const listener of listeners) listener([...ids]);
  }

  return {
    /** @returns {string[]} ids in catalog order */
    getIds() {
      return [...ids];
    },
    /** @returns {string[]} the English names Fresa receives */
    getLabels() {
      return supplyLabels(ids);
    },
    count() {
      return ids.length;
    },
    /** @param {string} id */
    has(id) {
      return ids.includes(id);
    },
    /** @param {string} id */
    toggle(id) {
      commit(ids.includes(id) ? ids.filter((current) => current !== id) : [...ids, id]);
      return ids.includes(id);
    },
    /** @param {string} id */
    remove(id) {
      commit(ids.filter((current) => current !== id));
    },
    /**
     * Chooses or clears several supplies at once (a caption name).
     * @param {string[]} many
     * @param {boolean} selected
     */
    setMany(many, selected) {
      commit(selected ? [...ids, ...many] : ids.filter((current) => !many.includes(current)));
    },
    clear() {
      commit([]);
    },
    /** @param {(ids: string[]) => void} listener */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
