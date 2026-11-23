import assert from 'node:assert/strict';
import test from 'node:test';
import { flowerIdentity, missingFranchiseFlowers, sharedFlowerImages } from '../scripts/lib/shared-flower-images.mjs';

const rose = (id, variety, color, lengthCm, images = []) => ({ id, sourceProductId: id, variety, color, lengthCm, images });
const family = (group, locations) => ({ name: group, group, category: 'roses', locations });
const location = (location, variants) => ({ location, variants });

test('shares Houston photography by exact family, variety and color, across lengths only', () => {
  const products = [family('ec-roses', [location('houston', [rose('h', 'Freedom', 'Red', 50, [{ src: '/red.webp' }])])])];
  const photos = sharedFlowerImages(products);
  const product = products[0];
  assert.deepEqual(photos.get(flowerIdentity(product, rose('s', 'Freedom', 'Red', 70))), [{ src: '/red.webp' }]);
  for (const variant of [rose('s', 'Vendela', 'Red', 50), rose('s', 'Freedom', 'White', 50)]) {
    assert.equal(photos.has(flowerIdentity(product, variant)), false);
  }
  assert.equal(photos.has(flowerIdentity({ ...product, group: 'garden-roses' }, rose('s', 'Freedom', 'Red', 50))), false);
});

test('DMV additions retain existing native rows and add missing lengths once', () => {
  const products = [family('ec-roses', [
    location('houston', [rose('h50', 'generic', null, 50), rose('h60', null, null, 60), rose('duplicate', null, null, 60)]),
    location('dmv', [rose('d50', null, null, 50)]),
  ])];
  const before = structuredClone(products);
  assert.deepEqual(missingFranchiseFlowers(products).map(row => row.variant.id), ['h60']);
  assert.deepEqual(products, before, 'planning leaves catalog data unchanged');
});

test('franchise matching preserves color, variety and origin distinctions', () => {
  const products = [family('garden-roses', [
    location('houston', [rose('a', 'Adventure', 'Pink', 50), rose('b', 'Adventure', 'White', 50),
      { ...rose('c', 'Adventure', 'Pink', 50), attributes: { Origin: 'Canada' } }]),
    location('dmv', [rose('d', 'Adventure', 'Pink', 50)]),
  ])];
  assert.deepEqual(missingFranchiseFlowers(products).map(row => row.variant.id), ['b', 'c']);
});
