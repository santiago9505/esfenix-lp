/**
 * The location selector, shown in the catalog header, on the product page and
 * in the quote summary.
 *
 * Changing location while products are selected is guarded: products vary by
 * location, so the visitor is asked before the quote list is cleared. That
 * confirmation lives in ui/location-change-modal.js; this component only asks
 * the caller for permission via `onRequestChange`.
 */

import { LOCATIONS, resolveLocation } from '../data/locations.js';
import { el } from './dom.js';

let idCounter = 0;

/**
 * @param {{
 *   locationId: string,
 *   onRequestChange: (locationId: string) => void,
 *   label?: string,
 *   compact?: boolean,
 *   describeServiceCenter?: boolean,
 * }} options
 */
export function locationSelect(options) {
  const id = `cat-location-${++idCounter}`;
  const current = resolveLocation(options.locationId);

  const select = el(
    'select',
    {
      id,
      class: 'cat-select',
      onChange(event) {
        const next = event.currentTarget.value;
        if (next === options.locationId) return;
        // Revert immediately; the caller re-renders with the new value only
        // once the change is actually allowed.
        event.currentTarget.value = options.locationId;
        options.onRequestChange(next);
      },
    },
    LOCATIONS.map((location) =>
      el('option', {
        value: location.id,
        selected: location.id === options.locationId,
        text: location.label,
      }),
    ),
  );

  const note = options.describeServiceCenter !== false ? serviceCenterNote(current) : null;

  return el('div', { class: `cat-location ${options.compact ? 'cat-location-compact' : ''}` }, [
    el('label', { class: 'cat-location-label', for: id, text: options.label ?? 'Your location' }),
    el('div', { class: 'cat-select-wrap' }, [select]),
    note,
  ]);
}

/** @param {import('../core/types').LocationConfig} location */
function serviceCenterNote(location) {
  const parts = [];
  if (location.requiresShippingDestination) parts.push('Handled by our Houston team.');
  else if (location.note) parts.push(location.note);
  if (parts.length === 0) return null;
  return el('p', { class: 'cat-location-note', text: parts.join(' ') });
}

/**
 * The state / city / ZIP fields that "Other U.S. location" needs.
 *
 * The catalog itself does not need an address to show products — this is
 * collected so the request reaches the right team, and it is never put in a
 * URL. It is submitted with the quote payload only.
 *
 * @param {{
 *   destination: import('../core/types').ShippingDestination|null,
 *   onChange: (destination: import('../core/types').ShippingDestination) => void,
 *   errors?: string[],
 * }} options
 */
export function shippingDestinationFields(options) {
  const base = ++idCounter;
  const value = options.destination ?? { state: '', city: '', zipCode: '' };

  const read = (root) => ({
    state: root.querySelector('[data-field="state"]').value.trim(),
    city: root.querySelector('[data-field="city"]').value.trim(),
    zipCode: root.querySelector('[data-field="zipCode"]').value.trim(),
  });

  /** @param {{ field: string, label: string, autocomplete: string, inputmode?: string }} field */
  const textField = (field) => {
    const id = `cat-${field.field}-${base}`;
    return el('div', { class: 'cat-field' }, [
      el('label', { for: id, text: field.label }),
      el('input', {
        id,
        type: 'text',
        'data-field': field.field,
        value: value[field.field] ?? '',
        autocomplete: field.autocomplete,
        inputmode: field.inputmode,
        onInput(event) {
          options.onChange(read(event.currentTarget.closest('.cat-destination')));
        },
      }),
    ]);
  };

  return el('div', { class: 'cat-destination' }, [
    el('p', {
      class: 'cat-destination-intro',
      text: 'Tell us where your order would ship so the right team can help you.',
    }),
    el('div', { class: 'cat-destination-grid' }, [
      textField({ field: 'state', label: 'State', autocomplete: 'address-level1' }),
      textField({ field: 'city', label: 'City', autocomplete: 'address-level2' }),
      textField({
        field: 'zipCode',
        label: 'ZIP Code',
        autocomplete: 'postal-code',
        inputmode: 'numeric',
      }),
    ]),
    options.errors?.length
      ? el(
          'ul',
          { class: 'cat-field-errors', role: 'alert' },
          options.errors.map((error) => el('li', { text: error })),
        )
      : null,
  ]);
}
