import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveGalleryPrimaryImage, resolveInitialVariety } from '../src/catalog/product-page.js';
import { resolveProductCardImage } from '../src/catalog/ui/product-card.js';

test('the selected variety image wins over a different family primary image', () => {
  const amnesia = { src: '/roses-amnesia.webp', isPrimary: true };
  const beSweet = { src: '/be-sweet.webp' };

  assert.equal(resolveGalleryPrimaryImage([amnesia], beSweet), beSweet);
});

test('the family primary image remains the fallback when no variety is selected', () => {
  const amnesia = { src: '/roses-amnesia.webp', isPrimary: true };
  const beSweet = { src: '/be-sweet.webp' };

  assert.equal(resolveGalleryPrimaryImage([beSweet, amnesia]), amnesia);
});

test('EC Roses starts with its pink variety while an explicit variety still wins', () => {
  const product = {
    slug: 'ec-roses',
    group: 'ecuadorian-roses',
    variants: [
      { variety: 'Atomic', color: 'Bicolor' },
      { variety: 'Be Sweet', color: 'Pink' },
      { variety: 'Freedom', color: 'Red' },
    ],
  };

  assert.equal(resolveInitialVariety(product), 'Be Sweet');
  assert.equal(resolveInitialVariety(product, 'Atomic'), 'Atomic');
});

test('other product families keep their unselected initial state', () => {
  const product = {
    slug: 'peony',
    group: 'peony',
    variants: [{ variety: 'Sarah Bernhardt', color: 'Pink' }],
  };

  assert.equal(resolveInitialVariety(product), null);
});

test('the EC Roses catalog card uses the pink opening variety image', () => {
  const amnesia = { src: '/amnesia.webp' };
  const beSweet = { src: '/be-sweet.webp' };
  const product = {
    slug: 'ec-roses',
    group: 'ecuadorian-roses',
    images: [amnesia],
    variants: [
      { variety: 'Amnesia', color: 'Lavender', images: [amnesia] },
      { variety: 'Be Sweet', color: 'Pink', images: [beSweet] },
    ],
  };

  assert.equal(resolveProductCardImage(product), beSweet);
});

test('other catalog cards keep their family image', () => {
  const familyImage = { src: '/garden-rose.webp' };
  const pinkVariant = { src: '/garden-pink.webp' };
  const product = {
    slug: 'garden-roses',
    group: 'garden-roses',
    images: [familyImage],
    variants: [{ variety: 'Pink O Hara', color: 'Pink', images: [pinkVariant] }],
  };

  assert.equal(resolveProductCardImage(product), familyImage);
});
