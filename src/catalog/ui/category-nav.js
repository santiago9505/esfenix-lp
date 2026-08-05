/**
 * The category sidebar on the product page: categories, the groups inside them
 * (Ecuadorian Roses, Garden Roses, …), and their product families.
 *
 * The whole tree is built from the products the selected location actually
 * carries, so it never offers a route to something that is not there. The
 * current category and product are marked with aria-current, and the branch
 * containing the current product opens by default.
 *
 * On mobile the same markup becomes a collapsible accordion — see catalog.css.
 */

import { CATEGORIES, getCategoryLabel } from '../data/categories.js';
import { el } from './dom.js';

/**
 * @param {{
 *   tree: ReturnType<typeof import('../core/repository').buildCategoryTree>,
 *   currentProductId?: string|null,
 *   currentCategory?: string|null,
 *   hrefFor: (product: import('../core/repository').LocationProduct) => string,
 *   catalogHref: string,
 * }} options
 */
export function categoryNav(options) {
  const present = new Set(options.tree.map((branch) => branch.category));

  return el('nav', { class: 'cat-sidenav', 'aria-label': 'Product categories' }, [
    el('a', { class: 'cat-sidenav-all', href: options.catalogHref }, [
      el('span', { text: 'All products' }),
      el('span', { class: 'cat-sidenav-all-arrow', 'aria-hidden': 'true', text: '→' }),
    ]),

    ...CATEGORIES.filter((category) => present.has(category.id)).map((category) => {
      const branch = options.tree.find((entry) => entry.category === category.id);
      const isCurrent = category.id === options.currentCategory;

      return categorySection({
        id: category.id,
        label: category.label,
        groups: branch?.groups ?? [],
        open: isCurrent,
        isCurrent,
        options,
      });
    }),
  ]);
}

/**
 * @param {{
 *   id: string,
 *   label: string,
 *   groups: Array<{ id: string, label: string, products: any[] }>,
 *   open: boolean,
 *   isCurrent: boolean,
 *   options: any,
 * }} config
 */
function categorySection(config) {
  const bodyId = `cat-nav-${config.id}`;

  const toggle = el(
    'button',
    {
      type: 'button',
      class: 'cat-sidenav-cat',
      'aria-expanded': String(config.open),
      'aria-controls': bodyId,
      'aria-current': config.isCurrent ? 'true' : null,
      onClick(event) {
        const expanded = event.currentTarget.getAttribute('aria-expanded') === 'true';
        event.currentTarget.setAttribute('aria-expanded', String(!expanded));
        body.hidden = expanded;
      },
    },
    [
      el('span', { text: config.label }),
      el('span', { class: 'cat-sidenav-chevron', 'aria-hidden': 'true', text: '›' }),
    ],
  );

  // A category whose products all sit in one group (Other Flowers, Greenery)
  // does not need a group heading repeating the category name.
  const showGroupLabels = config.groups.length > 1;

  const body = el(
    'div',
    { class: 'cat-sidenav-body', id: bodyId, hidden: !config.open },
    config.groups.map((group) =>
      el('div', { class: 'cat-sidenav-group' }, [
        showGroupLabels && group.label
          ? el('div', { class: 'cat-sidenav-group-head' }, [
              el('p', { class: 'cat-sidenav-group-label', text: group.label }),
              el('span', {
                class: 'cat-sidenav-group-count',
                text: group.products.length === 1
                  ? '1 family'
                  : `${group.products.length} products`,
              }),
            ])
          : null,
        el(
          'ul',
          { class: 'cat-sidenav-products' },
          group.products.map((product) => productItem(product, config.options)),
        ),
      ]),
    ),
  );

  return el('section', { class: 'cat-sidenav-section' }, [toggle, body]);
}

/**
 * @param {import('../core/repository').LocationProduct} product
 * @param {any} options
 */
function productItem(product, options) {
  const isCurrent = product.id === options.currentProductId;

  return el('li', {}, [
    el('a', {
      class: 'cat-sidenav-product',
      href: options.hrefFor(product),
      'aria-current': isCurrent ? 'page' : null,
      text: product.name,
    }),

  ]);
}

/**
 * The mobile entry point for the sidebar.
 * @param {{ label: string, onOpen: () => void }} options
 */
export function categoryNavTrigger(options) {
  return el('button', {
    type: 'button',
    class: 'btn btn-light cat-sidenav-trigger',
    text: options.label,
    onClick: options.onOpen,
  });
}

/** @param {string|null|undefined} category */
export function categoryLabel(category) {
  return getCategoryLabel(category);
}
