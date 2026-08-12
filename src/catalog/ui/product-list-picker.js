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
 * Matches every word in a product search against the product's searchable
 * catalog fields. Keeping the matcher independent makes the picker easy to
 * verify without coupling tests to the DOM or modal implementation.
 *
 * @param {import('../core/repository').LocationProduct} product
 * @param {string} query
 */
export function matchesProductSearch(product, query) {
  const terms = normalizeSearch(query).split(' ').filter(Boolean);
  if (terms.length === 0) return true;

  const searchableText = normalizeSearch([
    product.name,
    product.category,
    product.group,
    product.variety,
    product.groupLabel,
    product.description,
    ...((product.variants ?? []).flatMap((variant) => [
      variant.variety,
      variant.color,
      variant.lengthCm,
      ...(variant.availableMeasures ?? []),
    ])),
  ].filter((value) => value !== null && value !== undefined).join(' '));

  return terms.every((term) => searchableText.includes(term));
}

/** @param {unknown} value */
function normalizeSearch(value) {
  return String(value ?? '')
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
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
  // Categories start closed so the visitor can focus on one product family at
  // a time. Keep this state outside render(): adding a product refreshes the
  // rows, but should not collapse the category the visitor is working in.
  const expandedCategories = new Set();
  const searchExpandedCategories = new Set();
  let searchQuery = '';
  let modal = null;

  const results = el('div', { class: 'cat-product-list-results', id: 'cat-product-list-results' });
  const noResults = el('p', {
    class: 'cat-product-list-no-results',
    role: 'status',
    hidden: true,
    text: 'No products match your search.',
  });
  const search = el('input', {
    type: 'search',
    class: 'cat-product-list-search-input',
    placeholder: 'Search products',
    autocomplete: 'off',
    'aria-label': 'Search products',
    'aria-controls': 'cat-product-list-results',
    onInput: (event) => {
      searchQuery = event.currentTarget.value;
      render();
    },
  });

  replaceChildren(host, [
    el('div', { class: 'cat-product-list-search-wrap' }, [
      el('span', { class: 'cat-product-list-search-icon', 'aria-hidden': 'true', text: '⌕' }),
      search,
    ]),
    results,
  ]);

  function render() {
    const normalizedQuery = normalizeSearch(searchQuery);
    const groups = groupProductsByCategory(options.products)
      .map((group) => ({
        ...group,
        products: normalizedQuery
          ? group.products.filter((product) => matchesProductSearch(product, normalizedQuery))
          : group.products,
      }))
      .filter((group) => !normalizedQuery || group.products.length > 0);

    syncSearchExpandedCategories(normalizedQuery, groups);
    replaceChildren(
      results,
      groups.map((group) => groupSection(group)),
    );
    results.append(noResults);
    noResults.hidden = !normalizedQuery || groups.length > 0;
  }

  function syncSearchExpandedCategories(normalizedQuery, groups) {
    if (!normalizedQuery) {
      for (const categoryId of searchExpandedCategories) expandedCategories.delete(categoryId);
      searchExpandedCategories.clear();
      return;
    }

    const matchingIds = new Set(groups.map((group) => group.id));
    for (const categoryId of searchExpandedCategories) {
      if (matchingIds.has(categoryId)) continue;
      expandedCategories.delete(categoryId);
      searchExpandedCategories.delete(categoryId);
    }
    for (const group of groups) {
      if (expandedCategories.has(group.id)) continue;
      expandedCategories.add(group.id);
      searchExpandedCategories.add(group.id);
    }
  }

  function groupSection(group) {
    const bodyId = `cat-product-list-group-${group.id}-body`;
    const headingId = `cat-product-list-group-${group.id}`;
    const isExpanded = expandedCategories.has(group.id);
    const body = el('div', {
      class: 'cat-product-list-group-body',
      id: bodyId,
      hidden: !isExpanded,
    }, [
      group.products.length > 0
        ? el('ul', { class: 'cat-product-list' }, group.products.map(productRow))
        : el('p', {
            class: 'cat-product-list-empty',
            text: 'No products are listed for this location yet.',
          }),
    ]);

    const toggle = el('button', {
      type: 'button',
      class: 'cat-product-list-group-toggle',
      'aria-expanded': String(isExpanded),
      'aria-controls': bodyId,
      onClick: (event) => {
        const expanded = event.currentTarget.getAttribute('aria-expanded') === 'true';
        const nextExpanded = !expanded;
        if (nextExpanded) expandedCategories.add(group.id);
        else expandedCategories.delete(group.id);
        searchExpandedCategories.delete(group.id);
        event.currentTarget.setAttribute('aria-expanded', String(nextExpanded));
        body.hidden = !nextExpanded;
      },
    }, [
      el('span', { class: 'cat-product-list-group-label', text: group.label }),
      el('span', {
        class: 'cat-product-list-group-count',
        text: `${group.products.length} product${group.products.length === 1 ? '' : 's'}`,
      }),
      el('span', { class: 'cat-product-list-group-chevron', 'aria-hidden': 'true', text: '›' }),
    ]);

    return el('section', {
      class: `cat-product-list-group ${group.products.length === 0 ? 'is-empty' : ''}`,
      'aria-labelledby': headingId,
    }, [
      el('h3', { id: headingId, class: 'cat-product-list-group-head' }, [
        toggle,
      ]),
      body,
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
