import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveSalesMeasures } from '../src/catalog/core/sales-measures.js';
import { applyFresaOrderableMeasures } from '../src/catalog/core/fresa-orderable-measures.js';
import { validateSelection } from '../src/catalog/core/quote-store.js';

test('normalizes legacy snapshot measures to the customer-facing presentation', () => {
  assert.deepEqual(resolveSalesMeasures('roses', ['stem', 'bunch', 'unit']), ['stem', 'bunch']);
  assert.deepEqual(resolveSalesMeasures('other-flowers', ['bunch', 'unit']), ['bunch']);
  assert.deepEqual(resolveSalesMeasures('foliage', ['bunch', 'unit']), ['bunch']);
  assert.deepEqual(resolveSalesMeasures('supplies', ['stem', 'bunch', 'unit']), ['unit']);
});

test('a single floral measure never adds the other presentation', () => {
  assert.deepEqual(resolveSalesMeasures('roses', ['bunch', 'unit']), ['bunch']);
  assert.deepEqual(resolveSalesMeasures('other-flowers', ['stem', 'unit']), ['stem']);
});

test('quote catalog availability restricts each native row to the measures for its location', () => {
  const product = {
    id: 'flower-family',
    locations: [
      { location: 'houston', variants: [{ id: 'a', sourceProductId: 'flower-tx', availableMeasures: ['stem', 'bunch'] }] },
      { location: 'seattle', variants: [{ id: 'b', sourceProductId: 'flower-wa', availableMeasures: ['stem', 'bunch'] }] },
      { location: 'dmv', variants: [{ id: 'c', sourceProductId: 'flower-dmv', availableMeasures: ['stem'] }] },
    ],
  };
  const [updated] = applyFresaOrderableMeasures([product], new Map([
    ['houston', new Map([['flower-tx', ['stem']]])],
    ['seattle', new Map([['flower-wa', ['bunch']]])],
    ['dmv', new Map()],
  ]));

  const [texas, seattle, dmv] = updated.locations;
  const canSelect = (location, id, measure) => validateSelection(location, { variantId: id, measure, quantity: 1 }).ok;
  assert.equal(canSelect(texas, 'a', 'stem'), true);
  assert.equal(canSelect(texas, 'a', 'bunch'), false);
  assert.equal(canSelect(seattle, 'b', 'bunch'), true);
  assert.equal(canSelect(seattle, 'b', 'stem'), false);
  assert.equal(dmv.variants.length, 0);
});

test('unpriced Fresa products retain their declared sales unit for availability requests', () => {
  const products = [{ id: 'garden-roses', locations: [{ location: 'dmv', variants: [
    { id: 'dmv-adventure', sourceProductId: 'native-dmv-adventure', availableMeasures: ['bunch'] },
  ] }] }];
  const [updated] = applyFresaOrderableMeasures(products, new Map([
    ['dmv', new Map([['native-dmv-adventure', []]])],
  ]));
  const location = updated.locations[0];
  assert.deepEqual(location.variants[0].availableMeasures, ['bunch']);
  assert.equal(validateSelection(location, { variantId: 'dmv-adventure', measure: 'bunch', quantity: 1 }).ok, true);
  assert.equal(validateSelection(location, { variantId: 'dmv-adventure', measure: 'stem', quantity: 1 }).ok, false);
  assert.deepEqual(products[0].locations[0].variants[0].availableMeasures, ['bunch']);
});
