/**
 * Builds the payload handed to the quote integration.
 *
 * Two audiences, one object:
 *
 *  - `products`, `selectedLocation`, `serviceCenter`, `delivery`… describe the
 *    request in the catalog's own vocabulary, for storage and for any future
 *    integration.
 *  - `fresa` restates the same request using the values the Fresa form
 *    actually offers, so a prefill can be applied field by field with no
 *    further translation.
 *
 * There is no pricing anywhere in here, by construction: quote lines carry no
 * price to begin with, and `assertNoPricing` re-checks before the payload
 * leaves the browser.
 */

import { QUOTE_SOURCE, QUOTE_SOURCE_NO_PRODUCTS } from '../data/quote-config.js';
import {
  fresaFormUrl,
  fresaLocationLabel,
  resolveFresaProductForItem,
  unrepresentedDetails,
} from './fresa-mapping.js';
import { locationServiceMap, resolveLocation } from '../data/locations.js';
import { formatInternationalPhone } from '../data/country-calling-codes.js';
import { describeQuoteItem } from './format.js';

/**
 * @typedef {import('./types').QuoteItem} QuoteItem
 * @typedef {import('./types').ShippingDestination} ShippingDestination
 * @typedef {import('./types').QuotePayload} QuotePayload
 */

/** Location id -> the uppercase code used in the payload. */
function locationCode(locationId) {
  return String(locationId ?? '').toUpperCase().replace(/-/g, '_');
}

/**
 * @param {{
 *   locationId: string,
 *   items?: QuoteItem[],
 *   shippingDestination?: ShippingDestination|null,
 *   email?: string,
 *   contact?: { firstName?: string, lastName?: string, phone?: string, company?: string }|null,
 *   phoneCountryCode?: string,
 *   vip?: boolean,
 *   orderType?: string|null,
 *   delivery?: { address?: string, city?: string, state?: string, zipCode?: string, dateTime?: string, timeZone?: string, slot?: { date?: string, start?: string, end?: string, capacity?: number } }|null,
 *   notes?: string,
 * }} input
 * @returns {QuotePayload & { fresa: object }}
 */
export function buildQuotePayload(input) {
  const items = input.items ?? [];
  const location = resolveLocation(input.locationId);
  const destination = input.shippingDestination ?? null;

  /** @type {QuotePayload} */
  const payload = {
    source: items.length > 0 ? QUOTE_SOURCE : QUOTE_SOURCE_NO_PRODUCTS,
    selectedLocation: locationCode(location.id),
    serviceCenter: locationServiceMap[location.id] ?? location.serviceCenter,
    email: String(input.email ?? '').trim(),
    vip: input.vip === true,
    products: items.map((item) => ({
      productId: item.productId,
      ...(item.sourceProductName ? { sourceProductName: item.sourceProductName } : {}),
      ...(item.sku ? { sku: item.sku } : {}),
      productName: item.productName,
      category: item.category,
      variety: item.variety ?? null,
      color: item.color ?? null,
      lengthCm: item.lengthCm ?? null,
      quantity: item.quantity,
      measure: item.measure ?? null,
    })),
    orderType: String(input.orderType ?? '').trim() || null,
    delivery: {
      address: String(input.delivery?.address ?? '').trim(),
      city: String(input.delivery?.city ?? destination?.city ?? '').trim(),
      state: String(input.delivery?.state ?? destination?.state ?? '').trim(),
      zipCode: String(input.delivery?.zipCode ?? destination?.zipCode ?? '').trim(),
    },
    notes: input.notes ?? '',
  };

  if (input.contact) {
    payload.contact = {
      firstName: String(input.contact.firstName ?? '').trim(),
      lastName: String(input.contact.lastName ?? '').trim(),
      phone: input.phoneCountryCode
        ? formatInternationalPhone(input.phoneCountryCode, input.contact.phone)
        : String(input.contact.phone ?? '').trim(),
      company: String(input.contact.company ?? '').trim(),
    };
  }
  if (input.delivery?.dateTime) {
    payload.deliveryDateTime = String(input.delivery.dateTime).trim();
  }
  if (input.delivery?.timeZone) {
    const timeZone = String(input.delivery.timeZone).trim();
    payload.deliveryTimeZone = timeZone;
    payload.delivery.timeZone = timeZone;
  }
  if (input.delivery?.slot && typeof input.delivery.slot === 'object') {
    const slot = {
      date: String(input.delivery.slot.date ?? '').trim(),
      start: String(input.delivery.slot.start ?? '').trim(),
      end: String(input.delivery.slot.end ?? '').trim(),
      capacity: Number(input.delivery.slot.capacity) || 2,
    };
    if (slot.date && slot.start && slot.end) {
      payload.deliverySlot = slot;
      payload.delivery.slot = slot;
    }
  }

  return { ...payload, fresa: buildFresaBlock(items, location, payload) };
}

/**
 * Restates the request in the form's own terms.
 *
 * The form's product rows are {Producto, Quantity} only, so two catalog lines
 * that resolve to the same option — 60 cm roses in red and in white — become
 * one row with the summed quantity, and the breakdown moves into the notes
 * rather than being lost.
 *
 * @param {QuoteItem[]} items
 * @param {import('./types').LocationConfig} location
 * @param {QuotePayload} payload
 */
function buildFresaBlock(items, location, payload) {
  /** @type {Map<string, { product: string, sourceProductId: string|null, sourceProductName: string|null, sku: string|null, quantity: number, measure: string|null, details: string[] }>} */
  const rows = new Map();
  /** @type {Array<{ item: QuoteItem, tried: string[] }>} */
  const unmapped = [];

  for (const item of items) {
    const { option, candidates } = resolveFresaProductForItem(item);
    if (!option) {
      unmapped.push({ item, tried: candidates });
      continue;
    }
    const measure = String(item.measure ?? '').trim().toLowerCase() || null;
    const sourceProductId = String(item.sourceProductId ?? '').trim() || null;
    const sourceProductName = String(item.sourceProductName ?? '').trim() || null;
    const sku = String(item.sku ?? '').trim() || null;
    // Fresa validates product rows by their public product option and rejects
    // repeated product ids. A catalog product can still have several selected
    // variants, so keep those as separate lines in the catalog payload but
    // merge them here. The variant/colour/measure breakdown is preserved in
    // the seller notes below.
    const rowKey = option;
    if (!rows.has(rowKey)) rows.set(rowKey, {
      product: option,
      sourceProductId,
      sourceProductName,
      sku,
      quantity: 0,
      measure,
      details: [],
    });
    const row = rows.get(rowKey);
    row.quantity += item.quantity;
    row.sourceProductId ??= sourceProductId;
    row.sourceProductName ??= sourceProductName;
    row.sku ??= sku;
    row.measure ??= measure;

    const extra = unrepresentedDetails(item);
    if (extra.length > 0) row.details.push(`${item.quantity} × ${extra.join(', ')}`);
  }

  return {
    formUrl: fresaFormUrl(),
    // Step 2 — Ubicacion
    location: fresaLocationLabel(location.id),
    // Step 2 — repeating {Producto, Quantity} rows
    products: [...rows.values()].map((row) => ({
      product: row.product,
      quantity: row.quantity,
      measure: row.measure,
      ...(row.sourceProductId ? { sourceProductId: row.sourceProductId } : {}),
      ...(row.sourceProductName ? { sourceProductName: row.sourceProductName } : {}),
      ...(row.sku ? { sku: row.sku } : {}),
    })),
    // Step 3 — Type of Order. The catalog does not ask; the visitor picks it.
    orderType: payload.orderType,
    // Step 4 — Delivery information
    delivery: {
      ...payload.delivery,
      ...(payload.deliveryDateTime ? { dateTime: payload.deliveryDateTime } : {}),
    },
    // Step 5 — Notes for the seller
    notes: buildNotes(items, location, rows, unmapped, payload.notes),
    /** Lines the form has no option for. Surfaced so they can be fixed. */
    unmappedProducts: unmapped.map(({ item, tried }) => ({
      productName: item.productName,
      detail: describeQuoteItem(item),
      quantity: item.quantity,
      tried,
    })),
  };
}

/**
 * Composes "Notes for the seller" so nothing the form cannot represent is lost:
 * variety, colour, measure, and any product missing from the form's list.
 *
 * @param {QuoteItem[]} items
 * @param {import('./types').LocationConfig} location
 * @param {Map<string, { product: string, quantity: number, measure: string|null, details: string[] }>} rows
 * @param {Array<{ item: QuoteItem, tried: string[] }>} unmapped
 * @param {string} extraNotes
 */
function buildNotes(items, location, rows, unmapped, extraNotes) {
  if (items.length === 0) return extraNotes ?? '';

  const lines = [`Selected from the Esfenix online catalog — ${location.label}.`, ''];

  for (const row of rows.values()) {
    if (row.details.length === 0) continue;
    lines.push(`${row.product}: ${row.details.join('; ')}`);
  }

  if (unmapped.length > 0) {
    lines.push('', 'Also requested (not listed in this form):');
    for (const { item } of unmapped) {
      const detail = describeQuoteItem(item);
      lines.push(`- ${item.quantity} × ${item.productName}${detail ? ` (${detail})` : ''}`);
    }
  }

  if (extraNotes) lines.push('', extraNotes);

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * A plain-text version of the request, offered as a copyable fallback when the
 * form cannot be opened. No prices, by the same rule as everything else.
 *
 * @param {ReturnType<typeof buildQuotePayload>} payload
 */
export function buildQuoteSummaryText(payload) {
  const lines = ['Esfenix — quote request', `Location: ${payload.fresa.location ?? payload.selectedLocation}`];
  if (payload.serviceCenter) lines.push(`Handled by: ${payload.serviceCenter}`);

  const { city, state, zipCode } = payload.delivery;
  if (city || state || zipCode) lines.push(`Ships to: ${[city, state, zipCode].filter(Boolean).join(', ')}`);

  if (payload.products.length > 0) {
    lines.push('', 'Selected products:');
    for (const product of payload.products) {
      const detail = [
        product.variety,
        product.color,
        product.lengthCm !== null ? `${product.lengthCm} cm` : null,
        product.measure,
      ]
        .filter(Boolean)
        .join(' · ');
      lines.push(`- ${product.quantity} × ${product.productName}${detail ? ` (${detail})` : ''}`);
    }
  }

  lines.push('', 'This is a quote request. No payment will be collected.');
  return lines.join('\n');
}

/** Field names that must never appear in a payload. */
const PRICING_KEYS = [
  'price',
  'stemPrice',
  'bunchPrice',
  'unitPrice',
  'total',
  'subtotal',
  'currency',
  'pricingLocation',
  'discount',
  'tax',
  'taxes',
  'shippingCost',
];

/**
 * Throws if a payload has picked up anything money-shaped. Cheap insurance on
 * the one object that leaves the browser.
 *
 * @param {unknown} payload
 */
export function assertNoPricing(payload) {
  const json = JSON.stringify(payload ?? {});
  const found = PRICING_KEYS.filter((key) => json.includes(`"${key}"`));
  if (found.length > 0) {
    throw new Error(`Quote payload contains pricing field(s): ${found.join(', ')}`);
  }
  return true;
}
