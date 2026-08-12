import test from 'node:test';
import assert from 'node:assert/strict';
import { groupProductsByCategory, matchesProductSearch } from '../src/catalog/ui/product-list-picker.js';

const product = (category, name) => ({ category, name });

test('product picker keeps all four categories and groups only available products', () => {
  const groups = groupProductsByCategory([
    product('foliage', 'Greens'),
    product('roses', 'Roses'),
    product('roses', 'Garden Roses'),
  ]);

  assert.deepEqual(groups.map((group) => group.id), ['roses', 'other-flowers', 'foliage', 'supplies']);
  assert.deepEqual(groups.map((group) => group.products.map((entry) => entry.name)), [
    ['Roses', 'Garden Roses'],
    [],
    ['Greens'],
    [],
  ]);
});

test('product picker search matches names and variant attributes, including accents', () => {
  const searchableProduct = {
    name: 'Garden Rose',
    groupLabel: 'Rosas de jardín',
    variants: [{ variety: 'Vendela', color: 'White', lengthCm: 60, availableMeasures: ['stem'] }],
  };

  assert.equal(matchesProductSearch(searchableProduct, 'garden'), true);
  assert.equal(matchesProductSearch(searchableProduct, 'rosas jardin'), true);
  assert.equal(matchesProductSearch(searchableProduct, 'vendela 60'), true);
  assert.equal(matchesProductSearch(searchableProduct, 'orange'), false);
});
