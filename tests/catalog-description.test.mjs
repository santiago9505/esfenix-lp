import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCatalogDescription } from '../src/catalog/core/fresa-catalog.js';

test('an empty rich-text description from Fresa is no description', () => {
  assert.equal(sanitizeCatalogDescription('<p></p>'), null);
  assert.equal(sanitizeCatalogDescription('<p><br></p>'), null);
  assert.equal(sanitizeCatalogDescription(' <p>&nbsp;</p> '), null);
});

test('rich-text descriptions keep their words as plain text', () => {
  assert.equal(
    sanitizeCatalogDescription('<p>Grown at altitude in <strong>Ecuador</strong>.</p><p>Long vase life &amp; big heads.</p>'),
    'Grown at altitude in Ecuador. Long vase life & big heads.',
  );
});

test('plain descriptions and price filtering are unchanged', () => {
  assert.equal(sanitizeCatalogDescription('Soft pink garden rose.'), 'Soft pink garden rose.');
  assert.equal(sanitizeCatalogDescription('<p>Stem price: $1.20</p>'), null);
  assert.equal(sanitizeCatalogDescription(null), null);
});
