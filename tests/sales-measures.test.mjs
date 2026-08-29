import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveSalesMeasures } from '../src/catalog/core/sales-measures.js';

test('normalizes legacy snapshot measures to the customer-facing presentation', () => {
  assert.deepEqual(resolveSalesMeasures('roses', ['stem', 'bunch', 'unit']), ['stem', 'bunch']);
  assert.deepEqual(resolveSalesMeasures('other-flowers', ['bunch', 'unit']), ['bunch']);
  assert.deepEqual(resolveSalesMeasures('foliage', ['bunch', 'unit']), ['bunch']);
  assert.deepEqual(resolveSalesMeasures('supplies', ['stem', 'bunch', 'unit']), ['unit']);
});

test('uses an explicit stem-price signal when the catalog provides it', () => {
  assert.deepEqual(resolveSalesMeasures('roses', ['unit'], { hasStemPrice: true }), ['stem', 'bunch']);
  assert.deepEqual(resolveSalesMeasures('other-flowers', ['stem', 'unit'], { hasStemPrice: false }), ['bunch']);
});
