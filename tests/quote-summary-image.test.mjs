import assert from 'node:assert/strict';
import test from 'node:test';

import { imageForQuoteItem } from '../src/catalog/ui/quote-summary.js';

const red = { id: 'red', src: '/red.webp', alt: 'Red rose' };
const white = { id: 'white', src: '/white.webp', alt: 'White rose' };

function catalog(redImages = [red], whiteImages = [white]) {
  return [{
    id: 'roses',
    images: [...redImages, ...whiteImages],
    variants: [
      {
        id: 'red-50',
        sourceProductId: 'fresa-red',
        variety: 'Freedom',
        color: 'Red',
        lengthCm: 50,
        availableMeasures: ['stem'],
        images: redImages,
      },
      {
        id: 'white-50',
        sourceProductId: 'fresa-white',
        variety: 'Candelight',
        color: 'White',
        lengthCm: 50,
        availableMeasures: ['stem'],
        images: whiteImages,
      },
    ],
  }];
}

function quoteItem(overrides = {}) {
  return {
    productId: 'roses',
    sourceProductId: 'fresa-white',
    variety: 'Candelight',
    color: 'White',
    lengthCm: 50,
    measure: 'stem',
    ...overrides,
  };
}

test('quote summary uses the image for the exact selected product variant', () => {
  assert.equal(imageForQuoteItem(quoteItem(), catalog()), white);
});

test('older saved quote lines resolve their variant by selected attributes', () => {
  assert.equal(imageForQuoteItem(quoteItem({ sourceProductId: null }), catalog()), white);
});

test('quote summary does not borrow a sibling variant image', () => {
  assert.equal(imageForQuoteItem(quoteItem(), catalog([red], [])), null);
});
