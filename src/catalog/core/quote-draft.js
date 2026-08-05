/**
 * Persistent draft for the multi-step quote form.
 *
 * The quote list already has its own storage. This draft keeps the visitor's
 * progress and entered form values alongside it, but deliberately excludes
 * transient request state and the eventual result.
 */

import { read, remove, write } from './storage.js';

const STORAGE_KEY = 'quote-draft';
const MAX_STEP = 5;
const LOOKUP_STATES = new Set(['idle', 'checking', 'found', 'not-found', 'unavailable']);

/** @param {unknown} value */
function text(value) {
  return typeof value === 'string' ? value : '';
}

/** @param {unknown} value */
function step(value) {
  return Number.isInteger(value) ? Math.min(Math.max(value, 0), MAX_STEP) : 0;
}

/** @param {unknown} value */
function lookupState(value) {
  return LOOKUP_STATES.has(value) ? value : 'idle';
}

/** @param {unknown} value */
function contact(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    firstName: text(source.firstName),
    lastName: text(source.lastName),
    phone: text(source.phone),
    company: text(source.company),
  };
}

/** @param {unknown} value */
function delivery(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    dateTime: text(source.dateTime),
    address: text(source.address),
    city: text(source.city),
    state: text(source.state),
    zipCode: text(source.zipCode),
  };
}

/**
 * @typedef {object} QuoteDraft
 * @property {number} step
 * @property {string} email
 * @property {boolean} recognized
 * @property {'idle'|'checking'|'found'|'not-found'|'unavailable'} clientLookup
 * @property {{ firstName: string, lastName: string, phone: string, company: string }} contact
 * @property {'Delivery'|'Pickup'} orderType
 * @property {{ dateTime: string, address: string, city: string, state: string, zipCode: string }} delivery
 * @property {string} notes
 */

/**
 * Reads and normalizes the saved draft. Invalid or unavailable storage simply
 * behaves like an empty draft, matching the rest of the catalog state.
 *
 * @returns {QuoteDraft|null}
 */
export function readQuoteDraft() {
  const stored = read(STORAGE_KEY, null);
  if (!stored || typeof stored !== 'object') return null;

  return {
    step: step(stored.step),
    email: text(stored.email),
    recognized: stored.recognized === true,
    clientLookup: lookupState(stored.clientLookup),
    contact: contact(stored.contact),
    orderType: stored.orderType === 'Pickup' ? 'Pickup' : 'Delivery',
    delivery: delivery(stored.delivery),
    notes: text(stored.notes),
  };
}

/**
 * Stores only the fields that can be resumed after a page restart.
 *
 * @param {Partial<QuoteDraft>} draft
 */
export function writeQuoteDraft(draft) {
  write(STORAGE_KEY, {
    step: step(draft.step),
    email: text(draft.email),
    recognized: draft.recognized === true,
    clientLookup: lookupState(draft.clientLookup),
    contact: contact(draft.contact),
    orderType: draft.orderType === 'Pickup' ? 'Pickup' : 'Delivery',
    delivery: delivery(draft.delivery),
    notes: text(draft.notes),
  });
}

/** Removes the draft after a quote request succeeds. */
export function clearQuoteDraft() {
  remove(STORAGE_KEY);
}

