/**
 * A product card in the catalog grid.
 *
 * The whole card opens the product page, via one real link whose ::after
 * covers the card — so there is a single tab stop and a single announced link,
 * rather than a div with a click handler. "Add to quote" sits above that layer
 * and stops propagation, so choosing a product never navigates by accident.
 *
 * Cards show no price, no price range and no "request price" — the catalog has
 * no pricing at any layer.
 *
 * The card stays deliberately quiet: photograph, category, name. The full
 * breakdown of varieties, colours, lengths and presentations lives on the
 * product page, where there is room to read it.
 */

import { getCategoryLabel } from '../data/categories.js';
import { el, productMedia } from './dom.js';

/**
 * @param {{
 *   product: import('../core/repository').LocationProduct,
 *   href: string,
 *   selectedCount?: number,
 *   onAdd: (product: import('../core/repository').LocationProduct) => void,
 *   eager?: boolean,
 * }} options
 */
export function productCard(options) {
  const { product } = options;
  const primary = product.images?.find((image) => image.isPrimary) ?? product.images?.[0] ?? null;
  const selected = options.selectedCount ?? 0;

  return el('article', { class: 'cat-card fx-pop' }, [
    el('div', { class: 'cat-card-media' }, [
      productMedia(primary, {
        label: product.name,
        className: 'cat-card-img',
        width: 640,
        height: 480,
        eager: options.eager,
      }),
      product.isNew ? el('span', { class: 'cat-badge-new', text: 'New' }) : null,
    ]),

    el('div', { class: 'cat-card-body' }, [
      el('span', { class: 'cat-card-cat', text: getCategoryLabel(product.category) }),

      el('h3', { class: 'cat-card-title' }, [
        el('a', { class: 'cat-card-link', href: options.href, text: product.name }),
      ]),

      product.variety ? el('p', { class: 'cat-card-variety', text: product.variety }) : null,

      el('div', { class: 'cat-card-actions' }, [
        el('button', {
          type: 'button',
          class: 'btn btn-light cat-card-add',
          text: selected > 0 ? `Added · ${selected}` : 'Add to quote',
          'aria-label': `Add to quote: ${product.name}`,
          'data-selected': selected > 0 ? 'true' : null,
          onClick(event) {
            event.preventDefault();
            event.stopPropagation();
            options.onAdd(product);
          },
        }),
        el('a', { class: 'tlink cat-card-details', href: options.href, tabindex: '-1' }, [
          'View details ',
          el('span', { class: 'arr', text: '›' }),
        ]),
      ]),
    ]),
  ]);
}
