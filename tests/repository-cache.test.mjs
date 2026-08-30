import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadProducts,
  productsNeedRefresh,
  refreshProductsIfChanged,
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

function liveCatalogResponse(imageUrl, active = true) {
  const listId = 'list-texas';
  return {
    success: true,
    source: { id: 'integration-esfenix', name: 'Landing Page' },
    lists: [{ list_id: listId, name: 'Texas' }],
    columns: [
      { list_id: listId, key: 'active', field_name: 'active', field_type: 'checkbox' },
      { list_id: listId, key: 'type_product', field_name: 'type_product', field_type: 'select' },
      { list_id: listId, key: 'sales_unit', field_name: 'sales_unit', field_type: 'select' },
      { list_id: listId, key: 'product_image', field_name: 'Product_image', field_type: 'attachments', is_file: true },
    ],
    records: [{
      id: active ? 'live-active' : 'live-inactive',
      listId,
      listName: 'Texas',
      name: active ? 'Live Rose 60' : 'Hidden Rose 60',
      description: 'Stem $9.99',
      position: active ? 1 : 2,
      fields: {
        active,
        type_product: 'Roses',
        sales_unit: 'bunch',
        product_image: [{
          id: `image-${active}`,
          name: 'rose.webp',
          type: 'image/webp',
          isImage: true,
          url: imageUrl,
        }],
      },
    }],
    page: { offset: 0, limit: 200, totalCount: 1, hasMore: false, nextOffset: null },
  };
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
  };
}

test('loads the checked-in snapshot when the live source is disabled', async () => {
  resetProductCache();
  const snapshotProduct = normalizedProduct('snapshot');
  snapshotProduct.images = [
    { id: 'photo-50', src: '/images/rose.webp', url: '/images/rose.webp' },
    { id: 'photo-60', src: '/images/rose.webp', url: '/images/rose.webp' },
  ];
  snapshotProduct.locations[0].variants = [{
    id: 'snapshot-variant',
    availableMeasures: ['bunch', 'unit'],
  }];

  const products = await loadProducts({
    liveUrl: '',
    snapshotFetchImpl: async () => jsonResponse({
      version: 1,
      products: [snapshotProduct],
    }),
  });

  assert.equal(products[0].id, 'snapshot');
  assert.equal(products[0].images.length, 1, 'legacy snapshots do not render repeated photography');
  assert.equal(products[0].description, null, 'snapshot price descriptions are hidden before rendering');
  assert.deepEqual(
    products[0].locations[0].variants[0].availableMeasures,
    ['bunch'],
    'legacy snapshots do not expose their accounting unit as a flower presentation',
  );
  assert.equal(productsNeedRefresh(), false);
  resetProductCache();
});

test('renders the snapshot first, then refreshes live images without exposing prices', async () => {
  resetProductCache();
  let snapshotRequests = 0;
  let liveRequests = 0;

  const products = await loadProducts({
    liveUrl: 'https://fresa.example/api/integrations/lists/esfenix',
    liveFetchImpl: async (url) => {
      liveRequests += 1;
      const request = new URL(url);
      if (request.searchParams.get('mode') === 'revision') {
        return jsonResponse({ success: true, source: { name: 'Landing Page' }, revision: 'revision-1' });
      }
      assert.equal(request.searchParams.get('limit'), '1000');
      const active = liveCatalogResponse('https://storage.example/rose-v1.webp');
      const inactive = liveCatalogResponse('https://storage.example/hidden.webp', false).records[0];
      return jsonResponse({ ...active, records: [...active.records, inactive] });
    },
    snapshotFetchImpl: async () => {
      snapshotRequests += 1;
      return jsonResponse({ products: [normalizedProduct('snapshot')] });
    },
  });

  assert.equal(snapshotRequests, 1);
  assert.equal(liveRequests, 0, 'the first product render never waits for Fresa');
  assert.equal(products[0].id, 'snapshot');

  const refreshed = await refreshProductsIfChanged({
    forceCheck: true,
    liveUrl: 'https://fresa.example/api/integrations/lists/esfenix',
    liveFetchImpl: async (url) => {
      const request = new URL(url);
      if (request.searchParams.get('mode') === 'revision') {
        return jsonResponse({ success: true, source: { name: 'Landing Page' }, revision: 'revision-1' });
      }
      const active = liveCatalogResponse('https://storage.example/rose-v1.webp');
      const inactive = liveCatalogResponse('https://storage.example/hidden.webp', false).records[0];
      return jsonResponse({ ...active, records: [...active.records, inactive] });
    },
  });

  assert.equal(refreshed.changed, true);
  assert.equal(refreshed.products.length, 1);
  assert.equal(refreshed.products[0].id, 'live-active');
  assert.equal(refreshed.products[0].description, null);
  assert.equal(refreshed.products[0].images[0].src, 'https://storage.example/rose-v1.webp');
  assert.equal('prices' in refreshed.products[0].locations[0].variants[0], false);
  resetProductCache();
});

test('recovers from a missing snapshot by loading the live catalog directly', async () => {
  resetProductCache();
  let liveRequests = 0;

  const products = await loadProducts({
    liveUrl: 'https://fresa.example/api/integrations/lists/esfenix',
    snapshotFetchImpl: async () => jsonResponse({}, 503),
    liveFetchImpl: async (url) => {
      liveRequests += 1;
      const request = new URL(url);
      if (request.searchParams.get('mode') === 'revision') {
        return jsonResponse({ success: true, source: { name: 'Landing Page' }, revision: 'revision-recovery' });
      }
      return jsonResponse(liveCatalogResponse('https://storage.example/recovered.webp'));
    },
  });

  assert.equal(products[0].id, 'live-active');
  assert.equal(products[0].images[0].src, 'https://storage.example/recovered.webp');
  assert.equal(liveRequests, 2, 'recovery keeps the full-catalog and lightweight revision requests');
  resetProductCache();
});

test('polls only the revision until Fresa changes, then refreshes the image automatically', async () => {
  resetProductCache();
  let revision = 'revision-1';
  let imageUrl = 'https://storage.example/rose-v1.webp';
  let fullCatalogRequests = 0;
  let revisionRequests = 0;
  const fetchImpl = async (url) => {
    const request = new URL(url);
    if (request.searchParams.get('mode') === 'revision') {
      revisionRequests += 1;
      return jsonResponse({ success: true, source: { name: 'Landing Page' }, revision });
    }
    fullCatalogRequests += 1;
    return jsonResponse(liveCatalogResponse(imageUrl));
  };
  const options = {
    liveUrl: 'https://fresa.example/api/integrations/lists/esfenix',
    liveFetchImpl: fetchImpl,
    snapshotFetchImpl: async () => jsonResponse({ products: [normalizedProduct('snapshot')] }),
  };

  await loadProducts(options);
  assert.equal(fullCatalogRequests, 0, 'initial rendering uses only the local snapshot');

  const initialRefresh = await refreshProductsIfChanged({ ...options, forceCheck: true });
  assert.equal(initialRefresh.changed, true);
  assert.equal(fullCatalogRequests, 1);

  const unchanged = await refreshProductsIfChanged({ ...options, forceCheck: true });
  assert.equal(unchanged.changed, false);
  assert.equal(fullCatalogRequests, 1, 'unchanged revisions do not download or sign the catalog again');

  revision = 'revision-2';
  imageUrl = 'https://storage.example/rose-v2.webp';
  const refreshed = await refreshProductsIfChanged({ ...options, forceCheck: true });
  assert.equal(refreshed.changed, true);
  assert.equal(fullCatalogRequests, 2);
  assert.equal(refreshed.products[0].images[0].src, imageUrl);
  assert.ok(revisionRequests >= 3);
  resetProductCache();
});
