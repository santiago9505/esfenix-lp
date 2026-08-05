import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadProducts,
  productsNeedRefresh,
  resetProductCache,
} from '../src/catalog/core/repository.js';
import { resetStorageProbe } from '../src/catalog/core/storage.js';

class MemoryStorage {
  #values = new Map();
  getItem(key) { return this.#values.has(key) ? this.#values.get(key) : null; }
  setItem(key, value) { this.#values.set(key, String(value)); }
  removeItem(key) { this.#values.delete(key); }
}

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

test('renders the bundled snapshot immediately and marks it for background refresh', async () => {
  globalThis.window = { localStorage: new MemoryStorage() };
  resetStorageProbe();
  resetProductCache();

  const products = await loadProducts({
    snapshotFetchImpl: async () => ({
      ok: true,
      async json() { return { version: 1, products: [normalizedProduct('snapshot')] }; },
    }),
  });

  assert.equal(products[0].id, 'snapshot');
  assert.equal(products[0].description, null, 'snapshot price descriptions are hidden before rendering');
  assert.equal(productsNeedRefresh(), true);

  resetProductCache();
  resetStorageProbe();
  delete globalThis.window;
});

test('persists a live catalog for warm loads inside the revalidation window', async () => {
  globalThis.window = { localStorage: new MemoryStorage() };
  resetStorageProbe();
  resetProductCache();

  const live = await loadProducts({
    force: true,
    apiUrl: 'https://fresa.example/api/integrations/lists/catalog',
    apiKey: 'catalog-key',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          success: true,
          source: { id: 'landing', name: 'Landing Page' },
          columns: [{ list_id: 'flowers', key: 'type_product', field_name: 'type_product', field_type: 'select' }],
          records: [{
            id: 'live',
            listId: 'flowers',
            listName: 'Products',
            name: 'Live product',
            fields: { type_product: 'Other Flowers' },
          }],
          page: { offset: 0, limit: 1000, totalCount: 1, hasMore: false, nextOffset: null },
        };
      },
    }),
  });

  assert.equal(live[0].id, 'live');
  assert.equal(productsNeedRefresh(), false);

  resetProductCache({ persistent: false });
  const warm = await loadProducts({
    snapshotFetchImpl: async () => { throw new Error('snapshot should not be requested'); },
  });
  assert.equal(warm[0].id, 'live');

  resetProductCache();
  resetStorageProbe();
  delete globalThis.window;
});
