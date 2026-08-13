import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findClientByEmail,
  publicCatalog,
  quotePricing,
} from '../functions/src/fresa-service.js';

function response(body) {
  return {
    ok: true,
    status: 200,
    async json() { return body; },
  };
}

function catalogFixture() {
  return {
    success: true,
    catalog: {
      id: 'catalog-source',
      name: 'Landing Page',
      columns: [
        { list_id: 'flowers', key: 'type_product', field_name: 'type_product', field_type: 'select' },
        { list_id: 'flowers', key: 'stem_price_private', field_name: 'Stem price', field_type: 'currency' },
        { list_id: 'flowers', key: 'internal_email', field_name: 'Internal email', field_type: 'email' },
        { list_id: 'flowers', key: 'gallery', field_name: 'Gallery', field_type: 'attachments', is_file: true },
      ],
      products: [{
        id: 'rose-source-id',
        listId: 'flowers',
        listName: 'Products',
        name: 'Freedom rose',
        description: 'Stem $1.50',
        fields: {
          type_product: 'Roses',
          stem_price_private: '1.50',
          internal_email: 'private@example.com',
          gallery: [
            { id: 'image', name: 'rose.webp', type: 'image/webp', isImage: true, url: 'https://cdn.example/rose.webp' },
            { id: 'unsafe', name: 'unsafe.webp', type: 'image/webp', isImage: true, url: 'http://cdn.example/unsafe.webp' },
          ],
        },
      }],
      page: { hasMore: false, nextOffset: null },
    },
  };
}

test('the public catalog strips private fields and price values but keeps availability', async () => {
  const result = await publicCatalog({
    apiUrl: 'https://fresa.example/catalog-sanitized',
    apiKey: 'private-key',
    integrationId: 'catalog-source',
    fetchImpl: async () => response(catalogFixture()),
  });

  assert.doesNotMatch(result.serialized, /private@example\.com|1\.50|private-key/);
  assert.equal(result.payload.catalog.products[0].description, null);
  assert.equal(result.payload.catalog.products[0].fields.stem_price_private, true);
  assert.equal(result.payload.catalog.products[0].fields.gallery[0].url, 'https://cdn.example/rose.webp');
  assert.equal(result.payload.catalog.products[0].fields.gallery[1].url, null);
  assert.match(result.etag, /^"[A-Za-z0-9_-]+"$/);
});

test('the public catalog preserves independently named roles for every product list', async () => {
  const fixture = catalogFixture();
  fixture.catalog.columns.push(
    { list_id: 'greens', key: 'classification_green', field_name: 'Category', field_type: 'select' },
    { list_id: 'greens', key: 'price_green', field_name: 'Stem price', field_type: 'currency' },
  );
  fixture.catalog.products.push({
    id: 'green-source-id',
    listId: 'greens',
    listName: 'Greens',
    name: 'Ruscus',
    fields: { classification_green: 'Greenery', price_green: '0.75' },
  });

  const result = await publicCatalog({
    apiUrl: 'https://fresa.example/catalog-multiple-lists',
    apiKey: 'private-key',
    integrationId: 'catalog-source',
    fetchImpl: async () => response(fixture),
  });

  const green = result.payload.catalog.products.find((product) => product.id === 'green-source-id');
  assert.equal(green.fields.classification_green, 'Greenery');
  assert.equal(green.fields.price_green, true);
});

test('delivery progress is calculated server-side without returning a total', async () => {
  const pricing = await quotePricing([
    { sourceProductId: 'rose-source-id', measure: 'stem', quantity: 100 },
  ], {
    apiUrl: 'https://fresa.example/catalog-pricing',
    apiKey: 'private-key',
    integrationId: 'catalog-source',
    fetchImpl: async () => response(catalogFixture()),
  });

  assert.deepEqual(pricing, {
    hasUnknownPricing: false,
    deliveryProgress: 100,
    deliveryAllowed: true,
  });
  assert.equal(Object.hasOwn(pricing, 'totalCents'), false);
});

test('client lookup returns only the matching active profile', async () => {
  const profile = await findClientByEmail('CLIENT@example.com', {
    apiUrl: 'https://fresa.example/client-directory',
    apiKey: 'client-key',
    integrationId: 'client-source',
    fetchImpl: async () => response({
      success: true,
      source: { id: 'client-source', name: 'Clientes Activos' },
      columns: [
        { key: 'active', field_name: 'Activo', field_type: 'checkbox' },
        { key: 'email', field_name: 'Email', field_type: 'email' },
        { key: 'first', field_name: 'Nombre contacto', field_type: 'text' },
      ],
      records: [
        { id: 'a', fields: { active: true, email: 'client@example.com', first: 'Ana' } },
        { id: 'b', fields: { active: true, email: 'other@example.com', first: 'Other' } },
      ],
      page: { hasMore: false, nextOffset: null },
    }),
  });

  assert.equal(profile.email, 'client@example.com');
  assert.equal(profile.firstName, 'Ana');
  assert.doesNotMatch(JSON.stringify(profile), /other@example\.com/);
});
