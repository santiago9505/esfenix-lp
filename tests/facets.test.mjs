import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildFacets,
  countActiveFilters,
  emptyFilters,
  filterProducts,
  matchingVariants,
  pruneFilters,
  toggleFilter,
} from '../src/catalog/core/facets.js';
import { getProductsForLocation } from '../src/catalog/core/repository.js';
import { sampleProducts } from './helpers/browser-env.mjs';

const houston = () => getProductsForLocation(sampleProducts(), 'houston');

test('no filters returns every product in the location', () => {
  const products = houston();
  assert.equal(filterProducts(products, emptyFilters()).length, 3);
});

test('the location decides which products and variants exist', () => {
  const seattle = getProductsForLocation(sampleProducts(), 'seattle');
  assert.deepEqual(
    seattle.map((p) => p.id),
    ['roses-a'],
    'Seattle only lists Roses A',
  );
  assert.equal(seattle[0].variants.length, 1, 'and only the variant Seattle carries');
});

test('The Woodlands and Other U.S. location are served from the Houston catalog', () => {
  const products = sampleProducts();
  const ids = (location) => getProductsForLocation(products, location).map((p) => p.id);
  assert.deepEqual(ids('the-woodlands'), ids('houston'));
  assert.deepEqual(ids('other'), ids('houston'));
});

test('filters combine per variant, not per product', () => {
  const products = houston();

  // Freedom is only Red; White only exists on Vendela. Asking for both must
  // match nothing, rather than matching the product because it has a Freedom
  // variant and, separately, a White variant.
  const impossible = { ...emptyFilters(), variety: ['Freedom'], color: ['White'] };
  assert.equal(filterProducts(products, impossible).length, 0);

  const possible = { ...emptyFilters(), variety: ['Freedom'], color: ['Red'] };
  assert.equal(filterProducts(products, possible).length, 1);
});

test('filters are cumulative across dimensions', () => {
  const products = houston();
  let filters = emptyFilters();

  filters = toggleFilter(filters, 'category', 'roses');
  assert.equal(filterProducts(products, filters).length, 1);

  filters = toggleFilter(filters, 'lengthCm', 50);
  assert.equal(countActiveFilters(filters), 2);
  const matched = filterProducts(products, filters);
  assert.equal(matched.length, 1);
  assert.equal(matchingVariants(matched[0], filters).length, 1, 'only the 50 cm variant matches');
});

test('toggling a value off restores the previous result', () => {
  const products = houston();
  const withRoses = toggleFilter(emptyFilters(), 'category', 'roses');
  const without = toggleFilter(withRoses, 'category', 'roses');
  assert.equal(countActiveFilters(without), 0);
  assert.equal(filterProducts(products, without).length, 3);
});

test('facets only offer values that are reachable', () => {
  const products = houston();
  const filters = toggleFilter(emptyFilters(), 'category', 'roses');
  const facets = buildFacets(products, filters);

  const variety = facets.find((f) => f.id === 'variety');
  assert.deepEqual(
    variety.options.map((o) => o.value).sort(),
    ['Freedom', 'Vendela'],
    'varieties are limited to the selected category',
  );

  const color = facets.find((f) => f.id === 'color');
  assert.deepEqual(color.options.map((o) => o.value).sort(), ['Red', 'White']);
});

test('a facet with nothing to offer is not rendered', () => {
  const products = houston();
  // Foliage has no variety, colour or length in the fixture.
  const filters = toggleFilter(emptyFilters(), 'category', 'foliage');
  const facets = buildFacets(products, filters);
  const ids = facets.map((f) => f.id);

  assert.ok(!ids.includes('variety'), 'Variety is hidden when no product has one');
  assert.ok(!ids.includes('color'), 'Color is hidden when no product has one');
  assert.ok(!ids.includes('lengthCm'), 'Stem length is hidden when no product has one');
});

test('a facet with a single shared option is not rendered either', () => {
  const products = houston();
  const filters = toggleFilter(emptyFilters(), 'category', 'roses');
  const facets = buildFacets(products, filters);
  // Every rose variant in the fixture is sold by stem, so the control could
  // not narrow anything down.
  assert.ok(!facets.some((f) => f.id === 'measure'));
});

test('facet counts ignore that facet, so multi-select stays usable', () => {
  const products = houston();
  const filters = toggleFilter(emptyFilters(), 'color', 'Red');
  const color = buildFacets(products, filters).find((f) => f.id === 'color');

  assert.ok(
    color.options.some((o) => o.value === 'White'),
    'White is still offered while Red is selected',
  );
  assert.ok(color.options.find((o) => o.value === 'Red').selected);
});

test('measure facet matches when any of the variant measures is asked for', () => {
  const products = houston();
  const filters = { ...emptyFilters(), measure: ['bunch'] };
  const matched = filterProducts(products, filters).map((p) => p.id).sort();
  assert.deepEqual(matched, ['flower-c', 'greens-b']);
});

test('pruning drops selections the new location cannot satisfy', () => {
  const seattle = getProductsForLocation(sampleProducts(), 'seattle');
  const filters = {
    ...emptyFilters(),
    category: ['roses'],
    color: ['White'],
    lengthCm: [60],
    variety: ['Vendela'],
  };

  const pruned = pruneFilters(seattle, filters);
  assert.deepEqual(pruned.color, [], 'White is not in the Seattle catalog');
  assert.deepEqual(pruned.lengthCm, [], '60 cm is not in the Seattle catalog');
  assert.deepEqual(pruned.variety, []);
  assert.deepEqual(pruned.category, ['roses'], 'the category is still valid');
});

test('pruning keeps Supplies, which is configuration rather than data', () => {
  const products = houston();
  const pruned = pruneFilters(products, { ...emptyFilters(), category: ['supplies'] });
  assert.deepEqual(pruned.category, ['supplies']);
});
