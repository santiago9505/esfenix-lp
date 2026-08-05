/**
 * The catalog's non-content states: loading, empty, error, and the note about
 * availability that appears wherever products are listed.
 */

import { el } from './dom.js';

/** The line the brief requires wherever availability could be misread. */
export const AVAILABILITY_NOTE = 'Product availability will be confirmed by our team.';
export const PRODUCT_AVAILABILITY_NOTE =
  'Final product availability will be confirmed by our team.';
export const CATALOG_AVAILABILITY_LABEL = "Available in this location's catalog.";
export const NO_PAYMENT_NOTE = 'This is a quote request. No payment will be collected.';

/** @param {number} [cards] */
export function loadingSkeleton(cards = 6) {
  return el('div', { class: 'cat-skeleton', role: 'status', 'aria-live': 'polite' }, [
    el('span', { class: 'cat-sr', text: 'Loading the catalog…' }),
    el('div', { class: 'cat-skeleton-bar' }),
    el(
      'div',
      { class: 'cat-skeleton-grid' },
      Array.from({ length: cards }, () => el('div', { class: 'cat-skeleton-card' })),
    ),
  ]);
}

/**
 * @param {{
 *   title?: string,
 *   message?: string,
 *   actions?: Array<{ label: string, onClick: () => void, variant?: 'primary'|'light' }>,
 * }} options
 */
export function emptyState(options = {}) {
  return el('div', { class: 'cat-state cat-state-empty' }, [
    el('h2', { text: options.title ?? 'No products found' }),
    el('p', { text: options.message ?? 'Try changing your filters or select another location.' }),
    options.actions?.length
      ? el(
          'div',
          { class: 'cat-state-actions' },
          options.actions.map((action) =>
            el('button', {
              type: 'button',
              class: `btn ${action.variant === 'primary' ? 'btn-primary' : 'btn-light'}`,
              text: action.label,
              onClick: action.onClick,
            }),
          ),
        )
      : null,
  ]);
}

/**
 * @param {{ message?: string, onRetry?: () => void }} options
 */
export function errorState(options = {}) {
  return el('div', { class: 'cat-state cat-state-error', role: 'alert' }, [
    el('h2', { text: 'We could not load the catalog' }),
    el('p', {
      text:
        options.message ??
        'Something went wrong on our side. Please try again, or contact our team and we will help you directly.',
    }),
    options.onRetry
      ? el(
          'div',
          { class: 'cat-state-actions' },
          [
            el('button', {
              type: 'button',
              class: 'btn btn-primary',
              text: 'Try again',
              onClick: options.onRetry,
            }),
          ],
        )
      : null,
  ]);
}

/** A short, non-blocking inline message. */
export function inlineMessage(message, tone = 'info') {
  return el('p', {
    class: `cat-inline cat-inline-${tone}`,
    role: tone === 'error' ? 'alert' : 'status',
    text: message,
  });
}

/** The availability disclaimer shown under product listings. */
export function availabilityNote(text = AVAILABILITY_NOTE) {
  return el('p', { class: 'cat-note', text });
}
