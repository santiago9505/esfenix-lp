import assert from 'node:assert/strict';
import test from 'node:test';

import { FresaCatalogError, fetchCatalogPages, normalizeCatalog } from '../src/catalog/core/fresa-catalog.js';
import { getVariantPriceCents } from '../src/catalog/core/pricing.js';

const columns = [
  { list_id: 'flowers', key: 'classification_01', field_name: 'Categoría', field_type: 'text', is_file: false },
  { list_id: 'flowers', key: 'type_product_field', field_name: 'type_product', field_type: 'select', is_file: false },
  { list_id: 'flowers', key: 'floral_variant', field_name: 'Floral variety', field_type: 'text', is_file: false },
  { list_id: 'flowers', key: 'shade_attr', field_name: 'Color', field_type: 'text', is_file: false },
  { list_id: 'flowers', key: 'stem_size', field_name: 'Stem length', field_type: 'text', is_file: false },
  { list_id: 'flowers', key: 'gallery_field', field_name: 'Gallery', field_type: 'attachments', is_file: true },
  { list_id: 'flowers', key: 'download_field', field_name: 'Technical sheet', field_type: 'attachments', is_file: true },
  { list_id: 'flowers', key: 'price_field', field_name: 'Wholesale amount', field_type: 'currency', is_file: false },
];

test('normalizes Fresa columns and attachments without assuming field keys', () => {
  const products = normalizeCatalog({
    catalog: {
      columns,
      products: [
        {
          id: 'rose-1',
          listId: 'flowers',
          listName: 'Products',
          name: 'Roses',
          description: 'EC ROSES 50 | DMV | 50 cm | Stem $0.84 | Bunch $21.00',
          position: 2,
          fields: {
            classification_01: 'Other Flowers',
            type_product_field: 'Roses',
            floral_variant: 'Freedom',
            shade_attr: 'Red',
            stem_size: '60 cm',
            gallery_field: [
              { id: 'image-1', name: 'freedom.webp', type: 'image/webp', isImage: true, url: 'https://cdn/freedom.webp' },
              { id: 'image-2', name: 'missing.webp', type: 'image/webp', isImage: true, url: null },
            ],
            download_field: [
              { id: 'file-1', name: 'spec.pdf', type: 'application/pdf', isImage: false, url: 'https://cdn/spec.pdf' },
            ],
            price_field: 25000,
          },
        },
        // Different Fresa ids can be variants of the same displayed family.
        {
          id: 'rose-2',
          listId: 'flowers',
          listName: 'Products',
          name: 'Roses',
          position: 3,
          fields: { classification_01: 'Roses', shade_attr: 'White', gallery_field: [] },
        },
      ],
    },
  });

  assert.equal(products.length, 1, 'variant records share one displayed family');
  assert.equal(products[0].category, 'roses');
  assert.deepEqual(products[0].sourceProductIds, ['rose-1', 'rose-2']);
  assert.equal(products[0].locations[0].variants.length, 2);
  assert.equal(products[0].locations[0].variants[0].variety, 'Freedom');
  assert.equal(products[0].locations[0].variants[0].color, 'Red');
  assert.equal(products[0].locations[0].variants[0].lengthCm, 60);
  assert.deepEqual(products[0].locations[0].variants[0].availableMeasures, ['unit']);
  assert.equal(getVariantPriceCents(products[0].locations[0].variants[0], 'unit'), 2_500_000);
  assert.equal(products[0].images[0].src, 'https://cdn/freedom.webp');
  assert.equal(products[0].images[1].src, null, 'missing image URLs become placeholders');
  assert.deepEqual(
    products[0].files.map((file) => file.url),
    ['https://cdn/spec.pdf'],
  );
  assert.ok(!JSON.stringify(products[0]).includes('25000'), 'price is not copied into the view model');
  assert.equal(products[0].name, 'Roses', 'variant suffixes are not shown as separate product names');
  assert.equal(products[0].description, null, 'generated price descriptions stay private');
});

test('uses local flower photography only when Fresa has no usable image', () => {
  const baseProduct = {
    id: 'ecuadorian-roses-60',
    listId: 'flowers',
    listName: 'Products',
    name: 'EC ROSES',
    fields: {
      type_product_field: 'Roses',
      floral_variant: 'Freedom',
      gallery_field: [],
    },
  };

  const local = normalizeCatalog({ catalog: { columns, products: [baseProduct] } })[0];
  assert.match(local.images[0].src, /flowers-fallback\/roses-freedom\.webp$/);
  assert.ok(local.images.length > 1, 'EC ROSES receives several nearby local photos');
  assert.equal(local.images[0].isFallback, true);
  assert.match(local.locations[0].variants[0].images[0].src, /roses-freedom\.webp$/);
  assert.ok(local.locations[0].variants[0].images.length > 1, 'the selected rose variant also has nearby fallback photos');

  const fromApi = normalizeCatalog({
    catalog: {
      columns,
      products: [{
        ...baseProduct,
        fields: {
          ...baseProduct.fields,
          gallery_field: [{ id: 'api-image', name: 'freedom.webp', type: 'image/webp', url: 'https://cdn/freedom.webp' }],
        },
      }],
    },
  })[0];
  assert.equal(fromApi.images[0].src, 'https://cdn/freedom.webp');
  assert.ok(fromApi.images.every((image) => !image.isFallback), 'API photography is never mixed with local fallback');
});

test('groups size suffixes in product names when Fresa has no length column', () => {
  const products = normalizeCatalog({
    catalog: {
      columns: [],
      products: [60, 70, 80].map((length) => ({
        id: `ec-roses-${length}`,
        listId: 'flowers',
        listName: 'Products',
        name: `EC ROSES ${length}`,
        fields: {},
      })),
    },
  });

  assert.equal(products.length, 1);
  assert.equal(products[0].name, 'EC ROSES');
  assert.equal(products[0].slug, 'ec-roses');
  assert.deepEqual(
    products[0].locations[0].variants.map((variant) => variant.lengthCm),
    [60, 70, 80],
  );
});

test('merges equivalent rose families even when Fresa classifies one duplicate incorrectly', () => {
  const products = normalizeCatalog({
    catalog: {
      columns,
      products: [
        {
          id: 'ec-roses-60',
          listId: 'flowers',
          listName: 'Products',
          name: 'EC ROSES 60',
          fields: { type_product_field: 'Roses' },
        },
        {
          id: 'ec-roses-70-other',
          listId: 'flowers',
          listName: 'Products',
          name: 'EC ROSES 70',
          fields: { type_product_field: 'Other Flowers' },
        },
        {
          id: 'garden-roses-50',
          listId: 'flowers',
          listName: 'Products',
          name: 'GARDEN ROSES 50',
          fields: { type_product_field: 'Roses' },
        },
        {
          id: 'garden-roses-60-other',
          listId: 'flowers',
          listName: 'Products',
          name: 'GARDEN ROSES 60',
          fields: { type_product_field: 'Other Flowers' },
        },
      ],
    },
  });

  assert.equal(products.length, 2, 'EC Roses and Garden Roses each render once');

  const ecRoses = products.find((product) => product.name === 'EC ROSES');
  assert.ok(ecRoses);
  assert.equal(ecRoses.category, 'roses');
  assert.equal(ecRoses.groupLabel, 'Ecuadorian Roses');
  assert.deepEqual(ecRoses.sourceProductIds, ['ec-roses-60', 'ec-roses-70-other']);
  assert.deepEqual(
    ecRoses.locations[0].variants.map((variant) => variant.lengthCm),
    [60, 70],
  );

  const gardenRoses = products.find((product) => product.name === 'GARDEN ROSES');
  assert.ok(gardenRoses);
  assert.equal(gardenRoses.category, 'roses');
  assert.equal(gardenRoses.groupLabel, 'Garden Roses');
  assert.deepEqual(gardenRoses.sourceProductIds, ['garden-roses-50', 'garden-roses-60-other']);
});

test('fetches every Fresa page with bearer auth and the required pagination', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    const offset = new URL(url).searchParams.get('offset');
    const product = { id: `product-${offset}`, listId: 'flowers', listName: 'Products', name: `Product ${offset}`, fields: {} };
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          success: true,
          catalog: {
            id: 'landing-page',
            name: 'Landing Page',
            columns: [{ key: 'category', field_name: 'category', field_type: 'select' }],
            products: [product],
            page: offset === '0'
              ? { offset: 0, limit: 1000, totalCount: 2, hasMore: true, nextOffset: 1000 }
              : { offset: 1000, limit: 1000, totalCount: 2, hasMore: false, nextOffset: null },
          },
        };
      },
    };
  };

  const response = await fetchCatalogPages({
    apiUrl: 'https://fresa.example/api/integrations/catalog',
    apiKey: 'test-key',
    fetchImpl,
  });

  assert.deepEqual(
    calls.map((call) => new URL(call.url).search),
    ['?limit=1000&offset=0', '?limit=1000&offset=1000'],
  );
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-key');
  assert.deepEqual(response.catalog.products.map((product) => product.id), ['product-0', 'product-1000']);
});

test('accepts Fresa source responses that expose products as top-level records', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        success: true,
        source: { id: 'landing-page', name: 'Landing Page', updatedAt: '2026-08-03T21:05:50Z' },
        lists: [{ list_id: 'flowers', name: 'Texas' }],
        columns,
        records: [
          {
            id: 'rose-record',
            listId: 'flowers',
            listName: 'Texas',
            name: 'EC ROSES 60',
            fields: {
              classification_01: 'Roses',
              type_product_field: 'Roses',
              stem_size: 60,
            },
          },
        ],
        page: { offset: 0, limit: 250, totalCount: 1, hasMore: false, nextOffset: null },
      };
    },
  });

  const response = await fetchCatalogPages({
    apiUrl: 'https://fresa.example/api/integrations/catalog',
    apiKey: 'test-key',
    fetchImpl,
  });

  assert.equal(response.catalog.name, 'Landing Page');
  assert.equal(response.catalog.products.length, 1);
  assert.equal(response.catalog.products[0].id, 'rose-record');

  const products = normalizeCatalog(response);
  assert.equal(products[0].category, 'roses');
  assert.equal(products[0].locations[0].location, 'houston');
});

test('rejects the active-client source before it can become catalog products', async () => {
  await assert.rejects(
    () => fetchCatalogPages({
      apiUrl: 'https://fresa.example/api/integrations/catalog',
      apiKey: 'catalog-key',
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        async json() {
          return {
            success: true,
            source: { id: 'clients', name: 'Clientes Activos' },
            columns: [
              { key: 'active', field_name: 'activo', field_type: 'checkbox' },
              { key: 'email', field_name: 'email', field_type: 'email' },
            ],
            records: [{
              id: 'client-1',
              listId: 'clients',
              listName: 'Clientes Activos',
              name: 'A customer',
              fields: { active: true, email: 'customer@example.com' },
            }],
            page: { offset: 0, limit: 250, totalCount: 1, hasMore: false, nextOffset: null },
          };
        },
      }),
    }),
    (error) => {
      assert.ok(error instanceof FresaCatalogError);
      assert.match(error.message, /unexpected Fresa data source/i);
      return true;
    },
  );
});
