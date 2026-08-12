import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

import { createStorage, installBrowserEnv, resetBrowserEnv, sampleProducts } from './helpers/browser-env.mjs';

let env;
let quoteStoreModule;
let repository;

beforeEach(async () => {
  env = installBrowserEnv({ url: 'http://localhost/catalog', storage: createStorage() });
  quoteStoreModule = await import('../src/catalog/core/quote-store.js');
  repository = await import('../src/catalog/core/repository.js');
  // storage.js caches whether localStorage works, and each test installs a
  // fresh one — clear the probe so it re-checks against this test's storage.
  const storage = await import('../src/catalog/core/storage.js');
  storage.resetStorageProbe();
});

afterEach(resetBrowserEnv);

const houston = () => repository.getProductsForLocation(sampleProducts(), 'houston');
const roses = () => houston().find((p) => p.id === 'roses-a');
const greens = () => houston().find((p) => p.id === 'greens-b');

test('a valid selection is added', () => {
  const store = quoteStoreModule.createQuoteStore('houston');
  const result = store.addItem(roses(), { variantId: 'freedom_red_50cm', measure: 'stem', quantity: 12 });

  assert.equal(result.ok, true);
  assert.equal(store.getCount(), 1);

  const [item] = store.getItems();
  assert.equal(item.productName, 'Roses A');
  assert.equal(item.variety, 'Freedom');
  assert.equal(item.color, 'Red');
  assert.equal(item.lengthCm, 50);
  assert.equal(item.measure, 'stem');
  assert.equal(item.quantity, 12);
  assert.equal(item.selectedLocation, 'houston');
  assert.equal(item.serviceCenter, 'HOUSTON');
});

test('a quote line never carries pricing', () => {
  const store = quoteStoreModule.createQuoteStore('houston');
  store.addItem(roses(), { variantId: 'freedom_red_50cm', measure: 'stem', quantity: 1 });
  const keys = Object.keys(store.getItems()[0]);
  for (const forbidden of ['price', 'stemPrice', 'bunchPrice', 'unitPrice', 'total', 'subtotal', 'currency', 'discount']) {
    assert.ok(!keys.includes(forbidden), `${forbidden} must not exist on a quote line`);
  }
});

test('a variant that does not exist is rejected', () => {
  const store = quoteStoreModule.createQuoteStore('houston');
  const result = store.addItem(roses(), { variantId: 'not-a-variant', measure: 'stem', quantity: 1 });

  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /available option/i);
  assert.equal(store.getCount(), 0, 'nothing is added when validation fails');
});

test('a measure the variant does not offer is rejected', () => {
  const store = quoteStoreModule.createQuoteStore('houston');
  const result = store.addItem(roses(), { variantId: 'freedom_red_50cm', measure: 'box', quantity: 1 });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /not available/i);
});

test('a missing measure is rejected when the variant offers any', () => {
  const store = quoteStoreModule.createQuoteStore('houston');
  const result = store.addItem(roses(), { variantId: 'freedom_red_50cm', measure: null, quantity: 1 });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /measured/i);
});

test('quantity must be a whole number above zero', () => {
  const store = quoteStoreModule.createQuoteStore('houston');
  for (const quantity of [0, -3, 1.5, Number.NaN]) {
    const result = store.addItem(roses(), { variantId: 'freedom_red_50cm', measure: 'stem', quantity });
    assert.equal(result.ok, false, `quantity ${quantity} must be rejected`);
  }
  assert.equal(store.getCount(), 0);
});

test('adding the same variant again increases the quantity instead of duplicating', () => {
  const store = quoteStoreModule.createQuoteStore('houston');
  store.addItem(roses(), { variantId: 'freedom_red_50cm', measure: 'stem', quantity: 5 });
  store.addItem(roses(), { variantId: 'freedom_red_50cm', measure: 'stem', quantity: 3 });

  assert.equal(store.getCount(), 1);
  assert.equal(store.getItems()[0].quantity, 8);
});

test('different variants of one product are separate lines', () => {
  const store = quoteStoreModule.createQuoteStore('houston');
  store.addItem(roses(), { variantId: 'freedom_red_50cm', measure: 'stem', quantity: 1 });
  store.addItem(roses(), { variantId: 'vendela_white_60cm', measure: 'stem', quantity: 1 });
  assert.equal(store.getCount(), 2);
  assert.equal(store.getTotalQuantity(), 2);
});

test('the selection persists and is restored', async () => {
  const store = quoteStoreModule.createQuoteStore('houston');
  store.addItem(roses(), { variantId: 'freedom_red_50cm', measure: 'stem', quantity: 4 });

  // A new store in the same browser reads back what was stored.
  const restored = quoteStoreModule.createQuoteStore('houston');
  assert.equal(restored.getCount(), 1);
  assert.equal(restored.getItems()[0].quantity, 4);
  assert.equal(restored.getLocation(), 'houston');
});

test('a corrupt stored line is discarded rather than crashing the catalog', async () => {
  env.storage.setItem(
    'esfenix.catalog.quote',
    JSON.stringify({ location: 'houston', items: [{ nonsense: true }, null, 'x'] }),
  );
  const store = quoteStoreModule.createQuoteStore('houston');
  assert.equal(store.getCount(), 0);
});

test('the catalog still works when storage is unavailable', async () => {
  resetBrowserEnv();
  installBrowserEnv({ storage: createStorage({ throwOnWrite: true }) });
  const storage = await import('../src/catalog/core/storage.js');
  storage.resetStorageProbe();

  const store = quoteStoreModule.createQuoteStore('houston');
  const result = store.addItem(roses(), { variantId: 'freedom_red_50cm', measure: 'stem', quantity: 2 });
  assert.equal(result.ok, true, 'adding still works, it simply is not remembered');
  assert.equal(store.getCount(), 1);
});

test('changing location empties the list, because products vary by location', () => {
  const store = quoteStoreModule.createQuoteStore('houston');
  store.addItem(roses(), { variantId: 'freedom_red_50cm', measure: 'stem', quantity: 2 });

  store.setLocation('seattle');
  assert.equal(store.getCount(), 0, 'no mixing of two locations in one request');
  assert.equal(store.getLocation(), 'seattle');
});

test('setting the same location again leaves the list untouched', () => {
  const store = quoteStoreModule.createQuoteStore('houston');
  store.addItem(roses(), { variantId: 'freedom_red_50cm', measure: 'stem', quantity: 2 });
  store.setLocation('houston');
  assert.equal(store.getCount(), 1);
});

test('quantities can be edited and lines removed', () => {
  const store = quoteStoreModule.createQuoteStore('houston');
  store.addItem(roses(), { variantId: 'freedom_red_50cm', measure: 'stem', quantity: 2 });
  const [item] = store.getItems();

  assert.equal(store.setQuantity(item.id, 0).ok, false, 'zero is not a quantity');
  assert.equal(store.getItems()[0].quantity, 2);

  assert.equal(store.setQuantity(item.id, 9).ok, true);
  assert.equal(store.getItems()[0].quantity, 9);

  store.removeItem(item.id);
  assert.equal(store.getCount(), 0);
});

test('reconcile drops lines whose product left the catalog', () => {
  const store = quoteStoreModule.createQuoteStore('houston');
  store.addItem(roses(), { variantId: 'vendela_white_60cm', measure: 'stem', quantity: 1 });
  store.addItem(greens(), { variantId: 'novariety_nocolor_nolength', measure: 'bunch', quantity: 1 });
  assert.equal(store.getCount(), 2);

  // Seattle carries neither of those variants.
  const seattle = repository.getProductsForLocation(sampleProducts(), 'seattle');
  const dropped = store.reconcile(seattle);

  assert.equal(dropped.length, 2);
  assert.equal(store.getCount(), 0);
});

test('reconcile keeps lines that are still listed', () => {
  const store = quoteStoreModule.createQuoteStore('houston');
  store.addItem(roses(), { variantId: 'freedom_red_50cm', measure: 'stem', quantity: 1 });

  const seattle = repository.getProductsForLocation(sampleProducts(), 'seattle');
  assert.deepEqual(store.reconcile(seattle), [], 'Seattle also lists Freedom Red 50 cm');
  assert.equal(store.getCount(), 1);
});

test('reconcile enriches a saved quote line with its current Fresa product id', () => {
  const store = quoteStoreModule.createQuoteStore('houston');
  store.addItem(roses(), { variantId: 'freedom_red_50cm', measure: 'stem', quantity: 1 });
  assert.equal(store.getItems()[0].sourceProductId, null);

  const currentProduct = structuredClone(roses());
  currentProduct.variants.find((variant) => variant.id === 'freedom_red_50cm').sourceProductId =
    '11111111-1111-4111-8111-111111111111';

  assert.deepEqual(store.reconcile([currentProduct]), []);
  assert.equal(store.getItems()[0].sourceProductId, '11111111-1111-4111-8111-111111111111');
});

test('a product with a single unambiguous configuration needs no choice', async () => {
  const { needsVariantChoice } = await import('../src/catalog/core/format.js');
  assert.equal(needsVariantChoice(greens()), false, 'one variant, one measure');
  assert.equal(needsVariantChoice(roses()), true, 'several variants');
});
