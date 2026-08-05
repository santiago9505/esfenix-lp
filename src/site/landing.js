/**
 * Landing-page wiring for interactions that also exist in the catalog.
 *
 * The wishlist is persisted by the shared quote store, so a selection made in
 * the catalog remains available when the visitor returns to the landing page.
 * The landing page only owns the drawer here; product configuration still
 * lives in the catalog, which keeps the existing validation rules in one place.
 */

import { createQuoteStore } from '../catalog/core/quote-store.js';
import { openQuoteSummary } from '../catalog/ui/quote-summary.js';

const quoteStore = createQuoteStore('other');
let summary = null;

function updateWishlistCount(count = quoteStore.getCount()) {
  for (const node of document.querySelectorAll('[data-quote-count]')) {
    node.textContent = count > 0 ? String(count) : '';
    node.hidden = count === 0;
  }
}

function closeSummary() {
  summary?.close();
  summary = null;
}

function goToQuoteForm() {
  closeSummary();
  window.location.assign('/catalog/quote');
}

function openWishlist() {
  if (summary) {
    closeSummary();
    return;
  }

  summary = openQuoteSummary({
    items: quoteStore.getItems(),
    locationId: quoteStore.getLocation(),
    title: 'Wishlist',
    description: 'Your selected products are saved here while you browse Esfenix.',
    onSetQuantity(id, quantity) {
      quoteStore.setQuantity(id, quantity);
    },
    onRemove(id) {
      quoteStore.removeItem(id);
    },
    onEdit() {
      window.location.assign('/catalog');
    },
    onClear() {
      quoteStore.clear();
    },
    onContinue: goToQuoteForm,
    onClose() {
      summary = null;
    },
  });
}

function bindLandingCtas() {
  for (const node of document.querySelectorAll('[data-quote-cta]')) {
    node.addEventListener('click', (event) => {
      event.preventDefault();
      goToQuoteForm();
    });
  }

  for (const node of document.querySelectorAll('[data-quote-cart]')) {
    node.addEventListener('click', (event) => {
      event.preventDefault();
      openWishlist();
    });
  }
}

quoteStore.subscribe((state) => {
  updateWishlistCount(state.items.length);
  summary?.update(state.items);
});

updateWishlistCount();
bindLandingCtas();
