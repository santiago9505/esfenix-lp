/**
 * The /catalog list view: location selector, filters, product grid and the
 * states around them.
 *
 * Returns nodes; all state changes go back through the app controller.
 */

import { AVAILABILITY_NOTE, availabilityNote, emptyState } from './ui/states.js';
import { CATEGORIES, getCategory } from './data/categories.js';
import { breadcrumbs } from './ui/breadcrumbs.js';
import { buildFacets, countActiveFilters, filterProducts } from './core/facets.js';
import { el } from './ui/dom.js';
import { filterPanel, filterTrigger, openFilterDrawer, updateDrawer } from './ui/filters.js';
import { locationSelect, shippingDestinationFields } from './ui/location-select.js';
import { productCard } from './ui/product-card.js';

/**
 * @param {ReturnType<typeof import('./app.js').createApp>['ctx']} ctx
 */
export function renderCatalogView(ctx) {
  const facets = buildFacets(ctx.products, ctx.filters);
  const results = filterProducts(ctx.products, ctx.filters);
  const activeCount = countActiveFilters(ctx.filters);

  return {
    head: el('div', {}, [
      breadcrumbs([{ label: 'Home', href: '/' }, { label: 'Catalog' }]),
      el('header', { class: 'cat-head-block' }, [
        el('span', { class: 'eyebrow', text: 'Build your selection' }),
        el('h1', { text: 'Explore the catalog' }),
        el('p', {
          text: 'Start with a category, open a product family, then choose the exact variety and format for your location.',
        }),
      ]),
    ]),

    body: [
      el('div', { class: 'wrap' }, [
        toolbar(ctx, results.length, activeCount, facets),
        el('div', { class: 'cat-layout' }, [
          el('aside', { class: 'cat-sidebar' }, [
            filterPanel({
              facets,
              filters: ctx.filters,
              resultCount: results.length,
              onToggle: ctx.onToggleFilter,
              onClearAll: ctx.onClearFilters,
              idPrefix: 'desktop',
            }),
          ]),
          el('div', { class: 'cat-results' }, [
            categoryChips(ctx),
            results.length > 0 ? grid(ctx, results) : emptyPanel(ctx),
            results.length > 0 ? availabilityNote(AVAILABILITY_NOTE) : null,
          ]),
        ]),
      ]),
    ],
  };
}

/**
 * @param {any} ctx
 * @param {number} resultCount
 * @param {number} activeCount
 * @param {import('./core/types').Facet[]} facets
 */
function toolbar(ctx, resultCount, activeCount, facets) {
  const destination = ctx.location.requiresShippingDestination
    ? shippingDestinationFields({
        destination: ctx.locationStore.getShippingDestination(),
        onChange: (value) => ctx.locationStore.setShippingDestination(value),
      })
    : null;

  return el('div', { class: 'cat-toolbar' }, [
    el('div', { class: 'cat-toolbar-row' }, [
      locationSelect({
        locationId: ctx.locationId,
        onRequestChange: (next) => ctx.requestLocationChange(next),
      }),

      el('div', { class: 'cat-toolbar-meta' }, [
        el('p', {
          class: 'cat-count',
          role: 'status',
          text: `${resultCount} product${resultCount === 1 ? '' : 's'}`,
        }),
        filterTrigger({
          activeCount,
          onOpen: () => openDrawer(ctx),
        }),
      ]),
    ]),
    destination,
  ]);
}

/** Opens the mobile filter drawer and keeps it in sync as options are tapped. */
function openDrawer(ctx) {
  const drawer = openFilterDrawer({
    render(host) {
      paint(host);
    },
    onClearAll() {
      ctx.onClearFilters();
      paint(drawer.host);
    },
  });

  function paint(host) {
    const facets = buildFacets(ctx.products, ctx.filters);
    const results = filterProducts(ctx.products, ctx.filters);
    updateDrawer(
      host,
      el('div', {}, [
        el('p', {
          class: 'cat-drawer-count',
          role: 'status',
          text: `${results.length} product${results.length === 1 ? '' : 's'} match`,
        }),
        filterPanel({
          facets,
          filters: ctx.filters,
          resultCount: results.length,
          onToggle(facetId, value) {
            ctx.onToggleFilter(facetId, value);
            paint(host);
          },
          onClearAll() {
            ctx.onClearFilters();
            paint(host);
          },
          idPrefix: 'drawer',
        }),
      ]),
    );
  }
}

/**
 * Category shortcuts. Rendered from the category configuration rather than
 * from the data, so Supplies stays visible and can present itself even though
 * it has no products yet.
 */
function categoryChips(ctx) {
  const counts = new Map();
  for (const product of ctx.products) {
    counts.set(product.category, (counts.get(product.category) ?? 0) + 1);
  }

  return el('section', { class: 'cat-browse', 'aria-labelledby': 'cat-browse-title' }, [
    el('div', { class: 'cat-browse-head' }, [
      el('span', { class: 'eyebrow', text: 'Browse by type' }),
      el('h2', { id: 'cat-browse-title', text: 'Start with a category' }),
      el('p', { text: 'You will choose the exact variety and format on the product page.' }),
    ]),
    el(
      'div',
      { class: 'cat-chips', role: 'group', 'aria-label': 'Categories' },
      [
        el('button', {
          type: 'button',
          class: 'cat-chip',
          'aria-pressed': String(ctx.filters.category.length === 0),
          onClick: () => ctx.onSetFilters({ ...ctx.filters, category: [] }),
        }, [
          el('span', { text: 'All types' }),
          el('span', { class: 'cat-chip-count', text: String(ctx.products.length) }),
        ]),
        ...CATEGORIES.map((category) => {
      const selected = ctx.filters.category.includes(category.id);
      const count = counts.get(category.id) ?? 0;
      return el('button', {
        type: 'button',
        class: 'cat-chip',
        'aria-pressed': String(selected),
        onClick: () => ctx.onToggleFilter('category', category.id),
      }, [
        el('span', { text: category.label }),
        count > 0 ? el('span', { class: 'cat-chip-count', text: String(count) }) : null,
      ]);
        }),
      ],
    ),
  ]);
}

/**
 * @param {any} ctx
 * @param {import('./core/repository').LocationProduct[]} products
 */
function grid(ctx, products) {
  return el(
    'div',
    { class: 'cat-grid' },
    products.map((product, index) =>
      productCard({
        product,
        href: ctx.hrefFor(product),
        selectedCount: ctx.selectedCount(product.id),
        onAdd: (target) => ctx.addProduct(target),
        eager: index < 4,
      }),
    ),
  );
}

/**
 * What to show when nothing matches.
 *
 * When the visitor has narrowed to a single category that simply has no
 * catalog yet — Supplies today — the category introduces itself and offers a
 * way to ask for it, instead of pretending products exist.
 */
function emptyPanel(ctx) {
  const [only] = ctx.filters.category;
  const category = ctx.filters.category.length === 1 ? getCategory(only) : null;

  if (category && category.emptyCta && !ctx.products.some((p) => p.category === category.id)) {
    return el('section', { class: 'cat-category-intro' }, [
      el('div', { class: 'cat-category-intro-media ph', 'data-img': true, 'data-src': category.image.src, 'data-label': category.label }),
      el('div', { class: 'cat-category-intro-body' }, [
        el('span', { class: 'eyebrow', text: category.label }),
        el('h2', { text: category.description }),
        el('p', { text: category.emptyMessage }),
        el('button', {
          type: 'button',
          class: 'btn btn-primary',
          text: category.emptyCta,
          onClick: () => ctx.startQuoteWithoutProducts(),
        }),
      ]),
    ]);
  }

  return emptyState({
    actions: [
      { label: 'Clear filters', onClick: ctx.onClearFilters, variant: 'primary' },
      {
        label: 'Change location',
        onClick() {
          document.querySelector('.cat-location select')?.focus();
        },
      },
      { label: 'Request product availability', onClick: () => ctx.startQuoteWithoutProducts() },
    ],
  });
}
