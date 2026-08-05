/**
 * Compact product selector used from the quote form.
 *
 * The full catalog is intentionally card-based. This picker is a smaller,
 * task-focused view: it keeps the visitor in the quote flow and renders the
 * location's products as four predictable category lists.
 */

import { CATEGORIES } from '../data/categories.js';
import { el, replaceChildren } from './dom.js';
import { openModal } from './modal.js';

/**
 * Groups the products into the four configured top-level categories. Empty
 * categories are kept in the result so the picker always has the same shape.
 *
 * @param {import('../core/repository').LocationProduct[]} products
 * @returns {Array<{ id: string, label: string, products: import('../core/repository').LocationProduct[] }>}
 */
export function groupProductsByCategory(products) {
  const grouped = new Map(CATEGORIES.map((category) => [category.id, []]));

  for (const product of products) {
    const categoryProducts = grouped.get(product.category);
    if (categoryProducts) categoryProducts.push(product);
  }

  return CATEGORIES.map((category) => ({
    id: category.id,
    label: category.label,
    products: grouped.get(category.id) ?? [],
  }));
}

/**
 * Opens the location-aware list picker.
 *
 * @param {{
 *   products: import('../core/repository').LocationProduct[],
 *   locationLabel: string,
 *   selectedCount?: (productId: string) => number,
 *   onAdd: (product: import('../core/repository').LocationProduct, onAdded: () => void) => void,
 *   onClose?: () => void,
 * }} options
 */
export function openProductListPicker(options) {
  const host = el('div', { class: 'cat-product-list-picker' });
  let modal = null;

  function render() {
    replaceChildren(
      host,
      groupProductsByCategory(options.products).map((group) => groupSection(group)),
    );
  }

  function groupSection(group) {
    return el('section', {
      class: `cat-product-list-group ${group.products.length === 0 ? 'is-empty' : ''}`,
      'aria-labelledby': `cat-product-list-group-${group.id}`,
    }, [
      el('div', { class: 'cat-product-list-group-head' }, [
        el('h3', { id: `cat-product-list-group-${group.id}`, text: group.label }),
        el('span', {
          class: 'cat-product-list-group-count',
          text: `${group.products.length} product${group.products.length === 1 ? '' : 's'}`,
        }),
      ]),
      group.products.length > 0
        ? el('ul', { class: 'cat-product-list' }, group.products.map(productRow))
        : el('p', {
            class: 'cat-product-list-empty',
            text: 'No products are listed for this location yet.',
          }),
    ]);
  }

  function productRow(product) {
    const selected = options.selectedCount?.(product.id) ?? 0;
    const details = [
      product.variety,
      product.variants.length > 1 ? `${product.variants.length} available options` : null,
    ].filter(Boolean).join(' · ');

    return el('li', { class: 'cat-product-list-row' }, [
      el('div', { class: 'cat-product-list-copy' }, [
        el('strong', { text: product.name }),
        details ? el('span', { class: 'cat-product-list-detail', text: details }) : null,
        product.isNew ? el('span', { class: 'cat-product-list-new', text: 'New' }) : null,
      ]),
      el('button', {
        type: 'button',
        class: 'btn btn-light cat-product-list-add',
        text: selected > 0 ? `Add another · ${selected}` : 'Add',
        'aria-label': selected > 0
          ? `Add another ${product.name}`
          : `Add ${product.name}`,
        'data-selected': selected > 0 ? 'true' : null,
        onClick: () => options.onAdd(product, render),
      }),
    ]);
  }

  render();

  modal = openModal({
    title: 'Add or edit products',
    description: `Products available in ${options.locationLabel}. Choose a product to add it to your quote list.`,
    content: host,
    footer: [
      el('button', {
        type: 'button',
        class: 'btn btn-primary',
        text: 'Done',
        onClick: () => modal?.close(),
      }),
    ],
    variant: 'sheet',
    onClose: options.onClose,
  });

  return modal;
}
