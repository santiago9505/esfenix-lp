/**
 * A product card in the catalog grid.
 *
 * The whole card opens the product page, via one real link whose ::after
 * covers the card — so there is a single tab stop and a single announced link,
 * rather than a div with a click handler. "Add to quote" sits above that layer
 * and stops propagation, so choosing a product never navigates by accident.
 *
 * The card stays deliberately quiet: photograph, category, name. The full
 * breakdown of varieties, colours, lengths and presentations lives on the
 * product page, where there is room to read it.
 */

import { getCategoryLabel } from '../data/categories.js';
import { el, firstUsableImage, productMedia } from './dom.js';

/** @param {import('../core/repository').LocationProduct} product */
function productOptionSummary(product) {
  const varieties = new Set();
  const colors = new Set();
  const lengths = new Set();

  for (const variant of product.variants ?? []) {
    if (variant.variety) varieties.add(variant.variety);
    if (variant.color) colors.add(variant.color);
    if (variant.lengthCm !== null && variant.lengthCm !== undefined) lengths.add(variant.lengthCm);
  }

  const parts = [];
  if (varieties.size > 0) parts.push(`${varieties.size} ${varieties.size === 1 ? 'variety' : 'varieties'}`);
  if (colors.size > 0) parts.push(`${colors.size} ${colors.size === 1 ? 'color' : 'colors'}`);
  if (lengths.size > 0) parts.push(`${lengths.size} stem ${lengths.size === 1 ? 'length' : 'lengths'}`);

  if (parts.length > 0) return parts.join(' · ');
  if ((product.variants ?? []).length > 1) return `${product.variants.length} available options`;
  return 'See available formats';
}

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
  const primary = firstUsableImage(product.images);
  const selected = options.selectedCount ?? 0;

  // Catalog results are useful content, not decorative reveals. Keeping cards
  // visible from their first DOM paint avoids an animation/observer delay.
  return el('article', { class: 'cat-card' }, [
    el('div', { class: 'cat-card-media' }, [
      productMedia(primary, {
        label: product.name,
        className: 'cat-card-img',
        width: 480,
        height: 360,
        eager: options.eager,
      }),
      product.isNew ? el('span', { class: 'cat-badge-new', text: 'New' }) : null,
    ]),

    el('div', { class: 'cat-card-body' }, [
      el('span', { class: 'cat-card-cat', text: getCategoryLabel(product.category) }),

      el('h3', { class: 'cat-card-title' }, [
        el('a', { class: 'cat-card-link', href: options.href, text: product.name }),
      ]),

      el('p', { class: 'cat-card-variety', text: productOptionSummary(product) }),

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
          'See options ',
          el('span', { class: 'arr', text: '›' }),
        ]),
      ]),
    ]),
  ]);
}
