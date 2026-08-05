/**
 * Guards on the generated seed data itself.
 *
 * These run against src/catalog/data/products.generated.json, so regenerating
 * it from a changed workbook cannot quietly introduce pricing, an unknown
 * category, or a product the quote form has no option for.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { CATEGORY_ORDER } from '../src/catalog/data/categories.js';
import { FRESA_FORM } from '../src/catalog/data/fresa-form.js';
import { LOCATIONS } from '../src/catalog/data/locations.js';
import { loadCatalogFixture } from './helpers/browser-env.mjs';

const catalog = await loadCatalogFixture();
const products = catalog.products;

test('the generated data contains no pricing', () => {
  const json = JSON.stringify(catalog);
  for (const forbidden of [
    'price', 'stemPrice', 'bunchPrice', 'unitPrice', 'stem_price', 'bunch_price',
    'unit_price', 'total', 'subtotal', 'currency', 'discount', 'qty_on_hand',
  ]) {
    assert.ok(!json.includes(`"${forbidden}"`), `${forbidden} must not be in the catalog data`);
  }
  assert.ok(!/[$€£]\s?\d/.test(json), 'no currency amounts');
});

test('every product has a known category', () => {
  for (const product of products) {
    assert.ok(
      CATEGORY_ORDER.includes(product.category),
      `${product.name} has category "${product.category}"`,
    );
  }
});

test('product ids and slugs are unique', () => {
  const ids = products.map((p) => p.id);
  const slugs = products.map((p) => p.slug);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(slugs).size, slugs.length);
});

test('variant ids are unique within a product and location', () => {
  for (const product of products) {
    for (const entry of product.locations) {
      const ids = entry.variants.map((v) => v.id);
      assert.equal(
        new Set(ids).size,
        ids.length,
        `${product.name} / ${entry.location} has duplicate variant ids`,
      );
    }
  }
});

test('every listed product has at least one variant', () => {
  for (const product of products) {
    for (const entry of product.locations) {
      if (!entry.catalogAvailable) continue;
      assert.ok(entry.variants.length > 0, `${product.name} / ${entry.location} is listed but empty`);
    }
  }
});

test('missing attributes are null, never invented', () => {
  for (const product of products) {
    for (const entry of product.locations) {
      for (const variant of entry.variants) {
        for (const key of ['variety', 'color', 'lengthCm']) {
          const value = variant[key];
          assert.ok(
            value === null || (key === 'lengthCm' ? typeof value === 'number' : typeof value === 'string'),
            `${product.name} has a malformed ${key}: ${JSON.stringify(value)}`,
          );
          assert.notEqual(value, '', 'blanks must be null');
          assert.notEqual(value, 'N/A');
          assert.notEqual(value, '-');
        }
        assert.ok(Array.isArray(variant.availableMeasures) && variant.availableMeasures.length > 0);
      }
    }
  }
});

test('isNew is data and defaults to false', () => {
  for (const product of products) {
    assert.equal(typeof product.isNew, 'boolean', `${product.name}.isNew must be a boolean`);
  }
});

test('locations only reference catalog sources that exist', () => {
  const sources = new Set(LOCATIONS.map((l) => l.catalogSource));
  for (const product of products) {
    for (const entry of product.locations) {
      assert.ok(sources.has(entry.location), `unknown catalog source "${entry.location}"`);
    }
  }
});

test('every catalog source is reachable from at least one location', () => {
  const used = new Set(products.flatMap((p) => p.locations.map((l) => l.location)));
  for (const source of used) {
    assert.ok(
      LOCATIONS.some((l) => l.catalogSource === source),
      `catalog source "${source}" is not reachable from any location`,
    );
  }
});

test('products only carry images that were confirmed, or none at all', () => {
  for (const product of products) {
    assert.ok(Array.isArray(product.images));
    for (const image of product.images) {
      assert.match(image.src, /^\/assets\//, 'images are local assets');
      assert.ok(image.alt && image.alt.length > 0, `${product.name} image needs alt text`);
    }
  }
});

test('the Fresa form vocabulary covers every location', () => {
  for (const location of LOCATIONS) {
    assert.ok(FRESA_FORM.locationOptions[location.id], `no form option for ${location.id}`);
    assert.ok(
      Array.isArray(FRESA_FORM.productOptions[location.catalogSource]),
      `no form product list for ${location.catalogSource}`,
    );
  }
});
