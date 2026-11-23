import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { groupCatalogPresentations } from '../src/catalog/core/catalog-presentations.js';
import { findProductBySlug, getProductsForLocation } from '../src/catalog/core/repository.js';
import { validateSelection } from '../src/catalog/core/quote-store.js';

function product(id, name, color = null, location = 'houston') {
  return {
    id, name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, ''),
    category: 'other-flowers', sourceProductIds: [id],
    images: [{ src: `/${id}.webp` }],
    locations: [{ location, catalogAvailable: true, variants: [{
      id: `${id}-variant`, sourceProductId: id, sourceProductName: name,
      variety: null, color, lengthCm: null, availableMeasures: ['stem'], images: [{ src: `/${id}.webp` }],
    }] }],
  };
}

test('preserved sizes stay separately selectable, with both photos and working legacy URLs', () => {
  const input = [product('jumbo', 'Preserved rose Jumbo'), product('large', 'Preserved rose Large')];
  const before = structuredClone(input);
  const grouped = groupCatalogPresentations(input);
  assert.deepEqual(input, before, 'presentation grouping must not mutate cached source data');
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].name, 'Preserved Roses');
  assert.deepEqual(grouped[0].images.map(image => image.src), ['/jumbo.webp', '/large.webp']);
  const [local] = getProductsForLocation(grouped, 'houston');
  assert.deepEqual(local.variants.map(variant => [variant.variety, variant.sourceProductId]), [
    ['Jumbo', 'jumbo'], ['Large', 'large'],
  ]);
  for (const variant of local.variants) assert.equal(validateSelection(local, { variantId: variant.id, measure: 'stem', quantity: 2 }).ok, true);
  for (const old of input) assert.equal(findProductBySlug(grouped, old.slug), grouped[0]);
  assert.deepEqual(groupCatalogPresentations(grouped), grouped, 'snapshot and live preparation can safely run twice');
});

test('preserved roses are listed under Roses even when Fresa files them as other flowers', () => {
  const grouped = groupCatalogPresentations([
    product('jumbo', 'Preserved rose Jumbo'),
    product('large', 'Preserved rose Large'),
    product('carnation', 'Carnation'),
  ]);
  const preserved = grouped.find(item => item.slug === 'preserved-roses');
  assert.equal(preserved.category, 'roses');
  assert.equal(grouped.find(item => item.slug === 'carnation').category, 'other-flowers');
  assert.deepEqual(groupCatalogPresentations(grouped), grouped, 'an already grouped snapshot keeps the Roses category');
  const local = getProductsForLocation(grouped, 'houston');
  assert.deepEqual(local.filter(item => item.category === 'roses').map(item => item.slug), ['preserved-roses']);
  assert.equal(findProductBySlug(grouped, 'preserved-rose-jumbo'), preserved, 'old links keep working');
});

test('origin, Premium, other colors and bunch size remain distinct choices after grouping', () => {
  for (const [names, expected] of [
    [['Lisianthus', 'Lisianthus (Canada)'], ['Standard', 'Canada']],
    [['Snapdragon', 'Snapdragon (Canada)'], ['Standard', 'Canada']],
    [['Hydrangeas blue', 'Hydrangeas Premium - blue', 'Hydrangeas purple / lavender'], ['Standard', 'Premium', 'Standard']],
    [['Leather leaf (10 stems)', 'Leather leaf (20 stems) (Costa Rica)'], ['10 stems', '20 stems (Costa Rica)']],
  ]) {
    const result = groupCatalogPresentations(names.map((name, i) => product(`row-${i}`, name, 'Blue')));
    assert.equal(result.length, 1);
    assert.deepEqual(result[0].locations[0].variants.map(variant => variant.variety), expected);
    assert.equal(result[0].locations[0].variants.length, names.length, 'native rows are never deduplicated by similar labels');
  }
  for (const name of ['Tulip', 'Peony']) {
    const [result] = groupCatalogPresentations([product('white', name, 'White'), product('mix', `${name} - other colors`)]);
    assert.deepEqual(result.locations[0].variants.map(variant => variant.color), ['White', 'Other colors']);
  }
});

test('grouping keeps availability and images scoped to their native location', () => {
  const grouped = groupCatalogPresentations([
    product('canada', 'Lisianthus (Canada)'),
    product('standard', 'Lisianthus', 'White', 'seattle'),
    product('carnation', 'Carnation'),
    product('mini', 'Mini Carnation'),
  ]);
  assert.equal(grouped.length, 3, 'distinct flower types keep separate cards');
  const houston = getProductsForLocation(grouped, 'houston').find(product => product.slug === 'lisianthus');
  const seattle = getProductsForLocation(grouped, 'seattle').find(product => product.slug === 'lisianthus');
  assert.deepEqual(houston.variants.map(variant => variant.sourceProductId), ['canada']);
  assert.deepEqual(seattle.variants.map(variant => variant.sourceProductId), ['standard']);
  assert.deepEqual(seattle.images.map(image => image.src), ['/standard.webp']);
});

test('regrouping the bundled catalog preserves every native variant and old product link', () => {
  const { products } = JSON.parse(readFileSync(new URL('../public/data/catalog-snapshot.json', import.meta.url), 'utf8'));
  const grouped = groupCatalogPresentations(products);
  const identities = entries => entries.flatMap(product => product.locations.flatMap(location =>
    location.variants.map(variant => `${location.location}:${variant.id}:${variant.sourceProductId}`))).sort();
  assert.deepEqual(identities(grouped), identities(products));
  for (const product of products) assert.ok(findProductBySlug(grouped, product.slug), `missing older link ${product.slug}`);
});
