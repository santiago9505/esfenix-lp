/**
 * The quote summary panel for the products selected by the visitor.
 *
 * Vocabulary is deliberate throughout — quote list, selected products, request
 * a quote. Never cart, checkout or order total. There is no price, no subtotal
 * and no shipping cost anywhere in this component, and it says plainly that no
 * payment is involved.
 */

import { describeQuoteItem } from '../core/format.js';
import { el, productMedia, replaceChildren } from './dom.js';
import { getCategoryLabel } from '../data/categories.js';
import { NO_PAYMENT_NOTE, inlineMessage } from './states.js';
import { openModal } from './modal.js';
import { resolveLocation } from '../data/locations.js';

/**
 * @typedef {import('../core/types').QuoteItem} QuoteItem
 */

/**
 * Legacy quote-bar renderer kept private for compatibility with older imports.
 * anything in it.
 *
 * @param {{ count: number, totalQuantity: number, onOpen: () => void }} options
 */
export function quoteBar(options) {
  if (options.count === 0) return null;

  const label = `Request quote · ${options.count} product${options.count === 1 ? '' : 's'}`;

  return el('div', { class: 'cat-quotebar', role: 'region', 'aria-label': 'Quote list' }, [
    el('div', { class: 'cat-quotebar-inner' }, [
      el('p', { class: 'cat-quotebar-text' }, [
        el('strong', { text: `${options.count} product${options.count === 1 ? '' : 's'} selected` }),
        el('span', {
          class: 'cat-quotebar-sub',
          text: `${options.totalQuantity} unit${options.totalQuantity === 1 ? '' : 's'} in total`,
        }),
      ]),
      el('button', {
        type: 'button',
        class: 'btn btn-primary cat-quotebar-cta',
        text: label,
        onClick: options.onOpen,
      }),
    ]),
  ]);
}

/**
 * Opens the quote summary. A right-hand drawer on desktop, full screen on
 * mobile — both from the same markup, switched in CSS.
 *
 * @param {{
 *   items: QuoteItem[],
 *   locationId: string,
 *   onSetQuantity: (id: string, quantity: number) => void,
 *   onRemove: (id: string) => void,
 *   onEdit: (item: QuoteItem) => void,
 *   onClear: () => void,
 *   onContinue: () => Promise<void>|void,
 *   title?: string,
 *   description?: string,
 *   onChangeLocation?: () => void,
 *   locationSelectNode?: Node|null,
 * }} options
 */
export function openQuoteSummary(options) {
  const body = el('div', { class: 'cat-quote-body' });
  const status = el('div', { class: 'cat-quote-status', 'aria-live': 'polite' });

  const continueButton = el('button', {
    type: 'button',
    class: 'btn btn-primary',
    text: 'Continue to quote form',
    async onClick() {
      continueButton.disabled = true;
      continueButton.textContent = 'Opening…';
      try {
        await options.onContinue();
      } finally {
        continueButton.disabled = false;
      continueButton.textContent = 'Continue to quote form';
      }
    },
  });

  const clearButton = el('button', {
    type: 'button',
    class: 'cat-clear',
    text: 'Clear selection',
    onClick: () => options.onClear(),
  });

  const modal = openModal({
    title: options.title ?? 'Quote summary',
    description:
      options.description ??
      'Review your selected products here, then complete the quote request step by step.',
    variant: 'drawer-right',
    content: [body, status],
    footer: [continueButton, clearButton],
  });

  /**
   * @param {QuoteItem[]} items
   */
  function render(items) {
    const location = resolveLocation(options.locationId);

    if (items.length === 0) {
      replaceChildren(body, [
        el('div', { class: 'cat-quote-empty' }, [
          el('p', { text: 'Your quote list is empty.' }),
          el('p', {
            class: 'cat-note',
            text: 'Add products from the catalog and they will appear here.',
          }),
        ]),
      ]);
      continueButton.disabled = true;
      return;
    }

    continueButton.disabled = false;

    replaceChildren(body, [
      el('div', { class: 'cat-quote-meta' }, [
        el('dl', {}, [
          el('dt', { text: 'Location' }),
          el('dd', { text: location.label }),
          el('dt', { text: 'Handled by' }),
          el('dd', { text: serviceCenterLabel(location.serviceCenter) }),
        ]),
        options.locationSelectNode ?? null,
      ]),

      el(
        'ul',
        { class: 'cat-quote-items' },
        items.map((item) => quoteRow(item, options)),
      ),

      el('p', { class: 'cat-note', text: NO_PAYMENT_NOTE }),
    ]);
  }

  render(options.items);

  return {
    ...modal,
    /** @param {QuoteItem[]} items */
    update(items) {
      render(items);
    },
    /** @param {string} message @param {'info'|'error'} tone */
    setStatus(message, tone = 'info') {
      replaceChildren(status, message ? [inlineMessage(message, tone)] : []);
    },
    /** @param {Node[]} nodes */
    setStatusNodes(nodes) {
      replaceChildren(status, nodes);
    },
  };
}

/** @param {string} code */
function serviceCenterLabel(code) {
  return String(code)
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * @param {QuoteItem} item
 * @param {{
 *   onSetQuantity: (id: string, quantity: number) => void,
 *   onRemove: (id: string) => void,
 *   onEdit: (item: QuoteItem) => void,
 *   imageFor?: (item: QuoteItem) => ({ src: string, alt: string }|null),
 * }} options
 */
function quoteRow(item, options) {
  const detail = describeQuoteItem(item);
  const image = options.imageFor?.(item) ?? null;

  const quantityInput = el('input', {
    type: 'number',
    min: '1',
    step: '1',
    inputmode: 'numeric',
    class: 'cat-qty-input',
    value: String(item.quantity),
    'aria-label': `Quantity for ${item.productName}`,
    onChange(event) {
      const parsed = Number.parseInt(event.currentTarget.value, 10);
      if (!Number.isFinite(parsed) || parsed < 1) {
        event.currentTarget.value = String(item.quantity);
        return;
      }
      options.onSetQuantity(item.id, parsed);
    },
  });

  return el('li', { class: 'cat-quote-item' }, [
    productMedia(image, { label: item.productName, className: 'cat-quote-thumb', width: 96, height: 96 }),

    el('div', { class: 'cat-quote-item-body' }, [
      el('span', { class: 'cat-quote-item-cat', text: getCategoryLabel(item.category) }),
      el('p', { class: 'cat-quote-item-name', text: item.productName }),
      detail ? el('p', { class: 'cat-quote-item-detail', text: detail }) : null,

      el('div', { class: 'cat-quote-item-controls' }, [
        el('div', { class: 'cat-qty cat-qty-sm' }, [
          el('button', {
            type: 'button',
            class: 'cat-qty-btn',
            'aria-label': `Decrease quantity for ${item.productName}`,
            text: '−',
            onClick: () => options.onSetQuantity(item.id, Math.max(1, item.quantity - 1)),
          }),
          quantityInput,
          el('button', {
            type: 'button',
            class: 'cat-qty-btn',
            'aria-label': `Increase quantity for ${item.productName}`,
            text: '+',
            onClick: () => options.onSetQuantity(item.id, item.quantity + 1),
          }),
        ]),

        el('button', {
          type: 'button',
          class: 'cat-linkbtn',
          text: 'Edit',
          onClick: () => options.onEdit(item),
        }),
        el('button', {
          type: 'button',
          class: 'cat-linkbtn cat-linkbtn-danger',
          text: 'Remove',
          onClick: () => options.onRemove(item.id),
        }),
      ]),
    ]),
  ]);
}
