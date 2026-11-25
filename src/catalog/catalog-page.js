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
import { locationSelect } from './ui/location-select.js';
import { productCard } from './ui/product-card.js';
import { suppliesShowcase } from './ui/supplies-showcase.js';
import { SUPPLY_ITEMS } from './data/supplies.js';

/**
 * @param {ReturnType<typeof import('./app.js').createApp>['ctx']} ctx
 */
export function renderCatalogView(ctx) {
  const facets = withSuppliesOption(buildFacets(ctx.products, ctx.filters), ctx.offersSupplies);
  const results = filterProducts(ctx.products, ctx.filters);
  const activeCount = countActiveFilters(ctx.filters);
  // Supplies are a showcase, not product cards: they appear on their own when
  // the Supplies category is chosen (the app never mixes it with other
  // categories), and only where the location sells them (Texas list).
  const suppliesOnly = ctx.offersSupplies
    && ctx.filters.category.length === 1
    && ctx.filters.category[0] === 'supplies';
  const showSupplies = suppliesOnly;

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
        // The location picker lives inside the layout grid: on wide screens it
        // heads the filters column and the categories and products start
        // beside it, instead of under an otherwise empty full-width row.
        // With only Supplies chosen the filters have nothing to narrow (they
        // repeat the category chips), so the column steps aside and the
        // showcase spreads across the full width like the printed catalog.
        el('div', { class: `cat-layout${suppliesOnly ? ' is-supplies' : ''}` }, [
          toolbar(ctx, results.length, activeCount, facets, suppliesOnly),
          suppliesOnly ? null : el('aside', { class: 'cat-sidebar' }, [
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
            categoryChips(ctx, results.length, suppliesOnly),
            results.length > 0 ? grid(ctx, results) : showSupplies ? null : emptyPanel(ctx),
            results.length > 0 ? availabilityNote(AVAILABILITY_NOTE) : null,
          ]),
          showSupplies
            ? el('div', { class: 'cat-supplies-host' }, [
                suppliesShowcase({ store: ctx.suppliesInterest, onRequest: () => ctx.requestSuppliesInfo() }),
              ])
            : null,
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
function toolbar(ctx, resultCount, activeCount, facets, suppliesOnly = false) {
  return el('div', { class: 'cat-toolbar' }, [
    el('div', { class: 'cat-toolbar-row' }, [
      locationSelect({
        locationId: ctx.locationId,
        label: 'Catalog location',
        required: true,
        selectionHint: 'Products shown are loaded for this location.',
        onRequestChange: (next) => ctx.requestLocationChange(next),
      }),

      el('div', { class: 'cat-toolbar-meta' }, [
        resultCountText(resultCount, 'cat-count cat-count-toolbar', suppliesOnly),
        filterTrigger({
          activeCount,
          onOpen: () => openDrawer(ctx),
        }),
      ]),
    ]),
  ]);
}

/**
 * The live result count. It is drawn twice, in the toolbar for small screens
 * and at the end of the category chips on wide ones, and CSS hides the copy
 * that does not apply, so only one is ever announced.
 */
function resultCountText(resultCount, className, suppliesOnly = false) {
  return el('p', {
    class: className,
    role: 'status',
    text: suppliesOnly
      ? `${SUPPLY_ITEMS.length} supplies`
      : `${resultCount} product${resultCount === 1 ? '' : 's'}`,
  });
}

/**
 * The Type product filter lists Supplies only where the location sells them,
 * with the number of supplies in the showcase rather than product cards.
 * @param {import('./core/types').Facet[]} facets
 * @param {boolean} offersSupplies
 */
function withSuppliesOption(facets, offersSupplies) {
  return facets.map((facet) => {
    if (facet.id !== 'category') return facet;
    const options = facet.options
      .filter((option) => offersSupplies || option.value !== 'supplies')
      .map((option) => (option.value === 'supplies' ? { ...option, count: SUPPLY_ITEMS.length } : option));
    return { ...facet, options };
  }).filter((facet) => facet.options.length > 0);
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
    const facets = withSuppliesOption(buildFacets(ctx.products, ctx.filters), ctx.offersSupplies);
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
function categoryChips(ctx, resultCount, suppliesOnly = false) {
  const counts = new Map();
  for (const product of ctx.products) {
    counts.set(product.category, (counts.get(product.category) ?? 0) + 1);
  }
  if (ctx.offersSupplies) counts.set('supplies', SUPPLY_ITEMS.length);

  return el('section', { class: 'cat-browse', 'aria-labelledby': 'cat-browse-title' }, [
    el('div', { class: 'cat-browse-head' }, [
      el('span', { class: 'eyebrow', text: 'Browse by type' }),
      el('h2', { id: 'cat-browse-title', text: 'Start with a category' }),
      el('p', { text: 'You will choose the exact variety and format on the product page.' }),
    ]),
    el('div', { class: 'cat-chips-row' }, [
      el('div', { class: 'cat-chips', role: 'group', 'aria-label': 'Categories' }, [
        el('button', {
          type: 'button',
          class: 'cat-chip',
          'aria-pressed': String(ctx.filters.category.length === 0),
          onClick: () => ctx.onSetFilters({ ...ctx.filters, category: [] }),
        }, [
          el('span', { text: 'All types' }),
          el('span', { class: 'cat-chip-count', text: String(ctx.products.length) }),
        ]),
        ...CATEGORIES.filter((category) => category.id !== 'supplies' || ctx.offersSupplies).map((category) => {
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
      ]),
      resultCountText(resultCount, 'cat-count cat-count-chips', suppliesOnly),
    ]),
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
        // Adding from a card does not change the catalog contents. Keep the
        // existing grid mounted so its already-loaded images are preserved.
        onAdd: (target) => ctx.addProduct(target, { render: false }),
        eager: index < 4,
      }),
    ),
  );
}

/**
 * What to show when nothing matches.
 *
 * When the visitor has narrowed to a single category that simply has no
 * catalog yet, the category introduces itself and offers a way to ask for it,
 * instead of pretending products exist. Supplies have their own showcase and
 * only reach this panel where the location does not sell them.
 */
function emptyPanel(ctx) {
  const [only] = ctx.filters.category;
  const category = ctx.filters.category.length === 1 ? getCategory(only) : null;

  // Supplies are only sold from the Texas product list. Elsewhere the category
  // explains that and points to the location picker.
  if (category?.id === 'supplies' && !ctx.offersSupplies) {
    return el('section', { class: 'cat-category-intro' }, [
      el('div', { class: 'cat-category-intro-media ph', 'data-img': true, 'data-src': category.image.src, 'data-label': category.label }),
      el('div', { class: 'cat-category-intro-body' }, [
        el('span', { class: 'eyebrow', text: category.label }),
        el('h2', { text: category.description }),
        el('p', { text: 'Supplies are available for orders served by our Texas team (Houston, The Woodlands and other U.S. locations). Change your location to see them.' }),
        el('button', {
          type: 'button',
          class: 'btn btn-primary',
          text: 'Change location',
          onClick() {
            document.querySelector('.cat-location select')?.focus();
          },
        }),
      ]),
    ]);
  }

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
