/**
 * Persistent draft for the multi-step quote form.
 *
 * The quote list already has its own storage. This draft keeps the visitor's
 * progress and entered form values alongside it, but deliberately excludes
 * transient request state and the eventual result.
 */

import { readSession, removeSession, writeSession } from './session-storage.js';
import { DEFAULT_COUNTRY, COUNTRY_CALLING_CODES } from '../data/country-calling-codes.js';

const STORAGE_KEY = 'quote-draft';
const MAX_STEP = 5;
const LOOKUP_STATES = new Set(['idle', 'checking', 'found', 'not-found', 'unavailable']);

/** @param {unknown} value */
function text(value, maxLength = 2000) {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
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
function country(value) {
  return COUNTRY_CALLING_CODES.some((entry) => entry.code === value) ? value : DEFAULT_COUNTRY;
}

/** @param {unknown} value */
function contact(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    firstName: text(source.firstName, 80),
    lastName: text(source.lastName, 80),
    phone: text(source.phone, 40),
    company: text(source.company, 120),
  };
}

/** @param {unknown} value */
function delivery(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    dateTime: text(source.dateTime, 64),
    address: text(source.address, 160),
    city: text(source.city, 80),
    state: text(source.state, 80),
    zipCode: text(source.zipCode, 20),
  };
}

/**
 * @typedef {object} QuoteDraft
 * @property {number} step
 * @property {string} email
 * @property {boolean} recognized
 * @property {boolean} vip
 * @property {'idle'|'checking'|'found'|'not-found'|'unavailable'} clientLookup
 * @property {string} phoneCountry
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
  const stored = readSession(STORAGE_KEY, null);
  if (!stored || typeof stored !== 'object') return null;

  return {
    step: step(stored.step),
    email: text(stored.email, 254),
    recognized: stored.recognized === true,
    vip: stored.vip === true,
    clientLookup: lookupState(stored.clientLookup),
    phoneCountry: country(stored.phoneCountry),
    contact: contact(stored.contact),
    orderType: stored.orderType === 'Pickup' ? 'Pickup' : 'Delivery',
    delivery: delivery(stored.delivery),
    notes: text(stored.notes, 2000),
  };
}

/**
 * Stores only the fields that can be resumed after a page restart.
 *
 * @param {Partial<QuoteDraft>} draft
 */
export function writeQuoteDraft(draft) {
  writeSession(STORAGE_KEY, {
    step: step(draft.step),
    email: text(draft.email, 254),
    recognized: draft.recognized === true,
    vip: draft.vip === true,
    clientLookup: lookupState(draft.clientLookup),
    phoneCountry: country(draft.phoneCountry),
    contact: contact(draft.contact),
    orderType: draft.orderType === 'Pickup' ? 'Pickup' : 'Delivery',
    delivery: delivery(draft.delivery),
    notes: text(draft.notes, 2000),
  });
}

/** Removes the draft after a quote request succeeds. */
export function clearQuoteDraft() {
  removeSession(STORAGE_KEY);
}
