import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadProducts,
  productsNeedRefresh,
  resetProductCache,
} from '../src/catalog/core/repository.js';

function normalizedProduct(id) {
  return {
    id,
    name: `Product ${id}`,
    slug: `product-${id}`,
    description: 'Product $12.50',
    category: 'other-flowers',
    locations: [{ location: 'houston', catalogAvailable: true, variants: [] }],
  };
}

test('loads the checked-in snapshot and never schedules a remote refresh', async () => {
  resetProductCache();

  const products = await loadProducts({
    snapshotFetchImpl: async () => ({
      ok: true,
      async json() { return { version: 1, products: [normalizedProduct('snapshot')] }; },
    }),
  });

  assert.equal(products[0].id, 'snapshot');
  assert.equal(products[0].description, null, 'snapshot price descriptions are hidden before rendering');
  assert.equal(productsNeedRefresh(), false);
  resetProductCache();
});

test('force-like options cannot switch the browser to a remote catalog', async () => {
  resetProductCache();

  const products = await loadProducts({
    force: true,
    apiUrl: 'https://example.invalid/api/catalog',
    apiKey: 'must-not-be-used',
    fetchImpl: async () => { throw new Error('remote catalog must never be requested'); },
    snapshotFetchImpl: async () => ({
      ok: true,
      async json() { return { version: 1, products: [normalizedProduct('static')] }; },
    }),
  });

  assert.equal(products[0].id, 'static');
  assert.equal(productsNeedRefresh(), false);
  resetProductCache();
});
