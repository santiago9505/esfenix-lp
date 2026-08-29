/**
 * Catalog application controller.
 *
 * Owns the shared state — location, filters, quote list — and the flows that
 * cross views: changing location, adding a product, and opening the quote form.
 * The two views (catalog-page.js, product-page.js) are given this context and
 * only render.
 *
 * Rendering is a full re-render of the view body on each change. The catalog is
 * a few hundred nodes at most, and this keeps the state model simple and
 * predictable; there is no virtual DOM to reason about.
 */

import { announce, replaceChildren } from './ui/dom.js';
import { createQuoteIntegration } from './core/quote-integration.js';
import {
  buildCategoryTree,
  findProductBySlug,
  getProductsForLocation,
  loadProducts,
  PRODUCT_REFRESH_INTERVAL_MS,
  productExistsAnywhere,
  productsNeedRefresh,
  refreshProductsIfChanged,
} from './core/repository.js';
import { catalogHref, productHref, readFiltersFromUrl, syncUrl } from './core/url-state.js';
import { confirmLocationChange } from './ui/modal.js';
import { createLocationStore } from './core/location-store.js';
import { createQuoteStore, lineId } from './core/quote-store.js';
import { emptyFilters, pruneFilters, toggleFilter } from './core/facets.js';
import { errorState, loadingSkeleton } from './ui/states.js';
import { needsVariantChoice } from './core/format.js';
import { openQuoteSummary } from './ui/quote-summary.js';
import { openVariantPicker } from './ui/variant-picker.js';
import { openProductListPicker } from './ui/product-list-picker.js';
import { renderQuoteFormView } from './ui/quote-form.js';
import { parseRoute } from './core/url-state.js';
import { renderCatalogView } from './catalog-page.js';
import { renderProductView } from './product-page.js';
import { resolveLocation } from './data/locations.js';
import { initReveals } from './ui/site-chrome.js';
import { getClientTimeZone } from './core/timezone.js';

export function createApp({ head, body }) {
  const locationStore = createLocationStore();
  const quoteStore = createQuoteStore(locationStore.getId());
  const integration = createQuoteIntegration();
  const clientTimeZone = getClientTimeZone();

  /** @type {import('./core/types').Product[]} */
  let allProducts = [];
  /** @type {import('./core/repository').LocationProduct[]} */
  let locationProducts = [];
  let filters = emptyFilters();
  let loadError = null;
  let refreshPromise = null;
  let refreshTimer = null;
  /** @type {ReturnType<typeof openQuoteSummary>|null} */
  let summary = null;

  const ctx = {
    get products() {
      return locationProducts;
    },
    get allProducts() {
      return allProducts;
    },
    get filters() {
      return filters;
    },
    get locationId() {
      return locationStore.getId();
    },
    get location() {
      return resolveLocation(locationStore.getId());
    },
    clientTimeZone,
    locationStore,
    quoteStore,
    route: parseRoute(),

    urlState() {
      return { location: locationStore.getId(), filters };
    },

    hrefFor(product) {
      return productHref(product, ctx.urlState());
    },
    catalogHref(withFilters = true) {
      return catalogHref({
        location: locationStore.getId(),
        filters: withFilters ? filters : emptyFilters(),
      });
    },

    categoryTree() {
      return buildCategoryTree(locationProducts);
    },

    /** How many quote lines reference a product. */
    selectedCount(productId) {
      return quoteStore.getItems().filter((item) => item.productId === productId).length;
    },

    onToggleFilter(facetId, value) {
      filters = toggleFilter(filters, facetId, value);
      render();
    },
    onClearFilters() {
      filters = emptyFilters();
      render();
    },
    onSetFilters(next) {
      filters = next;
      render();
    },

    requestLocationChange,
    addProduct,
    openProductPicker,
    openQuote: openSummary,
    startQuoteWithoutProducts,
  };

  /* ---------------------------------------------------------------- */
  /* Location                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Products vary by location, so a location change with a non-empty quote list
   * is a destructive action and is confirmed first.
   * @param {string} nextLocationId
   * @param {{ onCancel?: () => void }} [options]
   */
  function requestLocationChange(nextLocationId, options = {}) {
    if (nextLocationId === locationStore.getId()) return;

    if (quoteStore.isEmpty()) {
      applyLocation(nextLocationId);
      return;
    }

    confirmLocationChange({
      nextLocationLabel: resolveLocation(nextLocationId).label,
      onConfirm() {
        applyLocation(nextLocationId, { clearQuote: true });
        announce(`Location changed to ${resolveLocation(nextLocationId).label}. Quote list cleared.`);
      },
      onCancel: options.onCancel,
    });
  }

  /**
   * @param {string} nextLocationId
   * @param {{ clearQuote?: boolean }} [options]
   */
  function applyLocation(nextLocationId, options = {}) {
    locationStore.setLocation(nextLocationId);
    if (options.clearQuote) quoteStore.setLocation(nextLocationId);
    else quoteStore.setLocation(nextLocationId);

    locationProducts = getProductsForLocation(allProducts, nextLocationId);
    // Keep whatever still applies rather than silently showing an empty grid.
    filters = pruneFilters(locationProducts, filters);
    summary?.close();
    summary = null;
    render();
  }

  /* ---------------------------------------------------------------- */
  /* Quote list                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * @param {import('./core/repository').LocationProduct} product
   * @param {{
   *   initial?: Record<string, any>,
   *   render?: boolean,
   *   openSummary?: boolean,
   *   onAdded?: () => void,
   * }} [options]
   */
  function addProduct(product, options = {}) {
    const complete = () => {
      announce(`${product.name} added to your quote list.`);
      options.onAdded?.();
      if (options.render !== false) render();
      if (options.openSummary !== false) openSummary();
    };

    if (!needsVariantChoice(product) && !options.initial) {
      const variant = product.variants[0];
      const measures = variant.availableMeasures ?? [];
      const result = quoteStore.addItem(product, {
        variantId: variant.id,
        measure: measures[0] ?? null,
        quantity: 1,
      });
      if (result.ok) {
        complete();
      }
      return;
    }

    openVariantPicker({
      product,
      initial: options.initial,
      onAdd(selection) {
        const result = quoteStore.addItem(product, selection);
        if (result.ok) {
          complete();
        }
      },
    });
  }

  /**
   * Opens the compact product list without leaving the current quote step.
   * Product additions intentionally do not re-render the whole app or open the
   * quote summary; the picker refreshes its own selected state and the quote
   * step refreshes when the picker closes.
   *
   * @param {{ onClose?: () => void }} [options]
   */
  function openProductPicker(options = {}) {
    return openProductListPicker({
      products: locationProducts,
      locationLabel: ctx.location.label,
      selectedCount: (productId) => ctx.selectedCount(productId),
      onAdd(product, onAdded) {
        addProduct(product, {
          render: false,
          openSummary: false,
          onAdded,
        });
      },
      onClose: options.onClose,
    });
  }

  function openSummary() {
    if (summary) {
      summary.close();
      summary = null;
      return;
    }

    summary = openQuoteSummary({
      items: quoteStore.getItems(),
      locationId: locationStore.getId(),
      onSetQuantity(id, quantity) {
        quoteStore.setQuantity(id, quantity);
        summary?.update(quoteStore.getItems());
      },
      onRemove(id) {
        quoteStore.removeItem(id);
        summary?.update(quoteStore.getItems());
        render();
      },
      onEdit(item) {
        const product = locationProducts.find((entry) => entry.id === item.productId);
        if (!product) return;
        openVariantPicker({
          product,
          initial: {
            variety: item.variety,
            color: item.color,
            lengthCm: item.lengthCm,
            measure: item.measure,
            quantity: item.quantity,
          },
          onAdd(selection) {
            // Editing replaces the original line rather than adding a second.
            quoteStore.removeItem(item.id);
            quoteStore.addItem(product, selection);
            summary?.update(quoteStore.getItems());
            render();
          },
        });
      },
      onClear() {
        quoteStore.clear();
        summary?.update(quoteStore.getItems());
        render();
      },
      onContinue: openQuoteFormScreen,
      onClose() {
        summary = null;
      },
    });
  }

  /* ---------------------------------------------------------------- */
  /* Quote flows                                                       */
  /* ---------------------------------------------------------------- */

  /** Flow 1 — the visitor asks for a quote without selecting products. */
  function startQuoteWithoutProducts() {
    openQuoteFormScreen();
  }

  /** Flow 2 — the visitor continues with the products they selected. */
  async function continueToQuote() {
    const items = quoteStore.getItems();
    if (items.length === 0) return;

    // Re-validate against the current catalog before handing anything over.
    const dropped = quoteStore.reconcile(locationProducts);
    if (dropped.length > 0) {
      summary?.update(quoteStore.getItems());
      summary?.setStatus(
        `${dropped.length} product${dropped.length === 1 ? '' : 's'} ${
          dropped.length === 1 ? 'is' : 'are'
        } no longer listed for this location and ${dropped.length === 1 ? 'was' : 'were'} removed.`,
        'error',
      );
      render();
      return;
    }

    openQuoteFormScreen();
  }

  /** Opens the internal multi-step quote request screen. */
  function openQuoteFormScreen() {
    summary?.close();
    summary = null;

    const catalogUrl = new URL(ctx.catalogHref(), window.location.origin);
    const nextPath = `/catalog/quote${catalogUrl.search}`;
    if (`${window.location.pathname}${window.location.search}` !== nextPath) {
      window.history.pushState({ quote: true }, '', nextPath);
    }
    render();
  }

  /** Returns to the catalog while keeping the current location and filters. */
  function closeQuoteFormScreen() {
    window.history.pushState({}, '', ctx.catalogHref());
    render();
  }

  /** Hands the completed internal form to the Fresa quote adapter. */
  function submitQuoteForm(payload) {
    return integration.start(payload);
  }

  function lookupClient(email) {
    return integration.lookupClient(email);
  }

  /* ---------------------------------------------------------------- */
  /* Rendering                                                         */
  /* ---------------------------------------------------------------- */

  function render() {
    syncUrl(ctx.urlState());

    if (loadError) {
      replaceChildren(body, [errorState({ message: loadError.message, onRetry: () => start() })]);
      return;
    }

    const route = parseRoute();
    ctx.route = route;

    const view =
      route.view === 'quote'
        ? renderQuoteFormView(ctx, {
            onBack: closeQuoteFormScreen,
            onOpenProductPicker: openProductPicker,
            onLookupClient: lookupClient,
            onSubmit: submitQuoteForm,
          })
          : route.view === 'product'
            ? renderProductView(ctx, route)
            : renderCatalogView(ctx);

    replaceChildren(head, view.head ? [view.head] : []);
    replaceChildren(body, view.body);
    initReveals(body);
  }

  /* ---------------------------------------------------------------- */
  /* Bootstrap                                                         */
  /* ---------------------------------------------------------------- */

  async function start() {
    loadError = null;
    replaceChildren(body, [loadingSkeleton()]);

    try {
      allProducts = await loadProducts();
    } catch (error) {
      loadError = error;
      render();
      return;
    }

    locationProducts = getProductsForLocation(allProducts, locationStore.getId());
    filters = readFiltersFromUrl(locationProducts);

    // A stored quote list belongs to the location it was built in. If the URL
    // asks for a different one, that is the same decision as changing location
    // by hand, so it gets the same confirmation instead of silently mixing.
    const quoteLocation = quoteStore.getLocation();
    if (!quoteStore.isEmpty() && quoteLocation !== locationStore.getId()) {
      const requested = locationStore.getId();
      confirmLocationChange({
        nextLocationLabel: resolveLocation(requested).label,
        onConfirm() {
          quoteStore.setLocation(requested);
          render();
        },
        onCancel() {
          locationStore.setLocation(quoteLocation);
          locationProducts = getProductsForLocation(allProducts, quoteLocation);
          filters = pruneFilters(locationProducts, filters);
          render();
        },
      });
    }

    // Drop lines whose product left the catalog since they were added.
    quoteStore.reconcile(locationProducts);

    render();
    bindGlobalQuoteCtas();
    bindCatalogRefresh();
  }

  async function refreshCatalog(forceCheck = false) {
    if (document.hidden || refreshPromise || (!forceCheck && !productsNeedRefresh())) return;

    refreshPromise = refreshProductsIfChanged({ forceCheck });
    try {
      const result = await refreshPromise;
      if (!result.changed) return;

      allProducts = result.products;
      locationProducts = getProductsForLocation(allProducts, locationStore.getId());
      filters = pruneFilters(locationProducts, filters);
      quoteStore.reconcile(locationProducts);
      summary?.update(quoteStore.getItems());
      render();
    } catch (error) {
      // A background failure must never replace a working live catalog or its
      // bundled fallback with an error state. The next interval retries.
      console.warn('Could not refresh the live Fresa catalog.', error);
    } finally {
      refreshPromise = null;
    }
  }

  function bindCatalogRefresh() {
    if (refreshTimer) return;
    refreshTimer = window.setInterval(() => {
      void refreshCatalog();
    }, PRODUCT_REFRESH_INTERVAL_MS);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void refreshCatalog(true);
    });
  }

  /**
   * The site-wide "Request a quote" buttons always lead to the catalog quote
   * form. The selected products stay in the shared local wishlist.
   */
  function bindGlobalQuoteCtas() {
    for (const node of document.querySelectorAll('[data-quote-cta]')) {
      node.addEventListener('click', (event) => {
        event.preventDefault();
        openQuoteFormScreen();
      });
    }

    for (const node of document.querySelectorAll('[data-quote-cart]')) {
      node.addEventListener('click', (event) => {
        event.preventDefault();
        openSummary();
      });
    }

    const updateCount = () => {
      for (const node of document.querySelectorAll('[data-quote-count]')) {
        const count = quoteStore.getCount();
        node.textContent = count > 0 ? String(count) : '';
        node.hidden = count === 0;
      }
    };
    quoteStore.subscribe(updateCount);
    updateCount();
  }

  window.addEventListener('popstate', () => {
    locationProducts = getProductsForLocation(allProducts, locationStore.getId());
    filters = readFiltersFromUrl(locationProducts);
    render();
  });

  return { start, render, ctx };
}
