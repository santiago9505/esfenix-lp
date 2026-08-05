/**
 * The category sidebar on the product page: categories, the groups inside them
 * (Ecuadorian Roses, Garden Roses, …), their products, and each product's
 * varieties.
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
import { getVarieties } from '../core/repository.js';
import { slugify } from '../core/slug.js';

/**
 * @param {{
 *   tree: ReturnType<typeof import('../core/repository').buildCategoryTree>,
 *   currentProductId?: string|null,
 *   currentCategory?: string|null,
 *   currentVariety?: string|null,
 *   hrefFor: (product: import('../core/repository').LocationProduct) => string,
 *   varietyHrefFor?: (product: import('../core/repository').LocationProduct, variety: string) => string,
 *   catalogHref: string,
 * }} options
 */
export function categoryNav(options) {
  const present = new Set(options.tree.map((branch) => branch.category));

  return el('nav', { class: 'cat-sidenav', 'aria-label': 'Product categories' }, [
    el('a', { class: 'cat-sidenav-all', href: options.catalogHref, text: 'All products' }),

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
          ? el('p', { class: 'cat-sidenav-group-label', text: group.label })
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
  const varieties = isCurrent ? getVarieties(product) : [];

  return el('li', {}, [
    el('a', {
      class: 'cat-sidenav-product',
      href: options.hrefFor(product),
      'aria-current': isCurrent ? 'page' : null,
      text: product.name,
    }),

    // Varieties are only listed for the product being viewed: a rose family can
    // have 70 of them, and printing every one under every product would bury
    // the navigation.
    isCurrent && varieties.length > 0 && options.varietyHrefFor
      ? el(
          'ul',
          { class: 'cat-sidenav-varieties' },
          varieties.map((variety) =>
            el('li', {}, [
              el('a', {
                href: options.varietyHrefFor(product, variety),
                'aria-current': slugify(variety) === slugify(options.currentVariety ?? '') ? 'true' : null,
                text: variety,
              }),
            ]),
          ),
        )
      : null,
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
