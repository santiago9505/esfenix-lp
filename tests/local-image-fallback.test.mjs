import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { getProductsForLocation } from '../src/catalog/core/repository.js';
import {
  applyLocalProductImageFallbacks,
  LOCAL_PRODUCT_IMAGE_FALLBACK_PRODUCT_IDS,
} from '../src/catalog/core/local-image-fallback.js';

const snapshot = JSON.parse(
  fs.readFileSync(new URL('../public/data/catalog-snapshot.json', import.meta.url), 'utf8'),
);

test('the curated Garden Roses fallback supplies images only when Fresa has none', () => {
  const gardenRoses = structuredClone(snapshot.products.find((product) => product.slug === 'garden-roses'));
  gardenRoses.images = [];
  for (const location of gardenRoses.locations) {
    for (const variant of location.variants) variant.images = [];
  }

  applyLocalProductImageFallbacks([gardenRoses], {
    enabled: true,
    productIds: LOCAL_PRODUCT_IMAGE_FALLBACK_PRODUCT_IDS,
  });

  const product = getProductsForLocation([gardenRoses], 'houston')[0];
  assert.equal(product.images[0].src, '/assets/images/flowers-fallback/garden-roses-adventure.webp');
  assert.equal(product.images[0].isFallback, true);
  assert.ok(product.variants.some((variant) => variant.variety === 'Adventure' && variant.images.length > 0));

  for (const image of product.images) {
    const matchingVarieties = new Set(product.variants
      .filter((variant) =>
        variant.images.some((variantImage) => variantImage.id === image.id),
      )
      .map((variant) => variant.variety));
    assert.equal(matchingVarieties.size, 1, `${image.src} must identify one variety`);
  }
});

test('the curated fallback does not replace Fresa photography or paint other products', () => {
  const gardenRoses = structuredClone(snapshot.products.find((product) => product.slug === 'garden-roses'));
  const ecRoses = structuredClone(snapshot.products.find((product) => product.slug === 'ec-roses'));
  const beforeGardenImages = gardenRoses.images.map((image) => image.src);
  const beforeEcImages = ecRoses.images.map((image) => image.src);

  applyLocalProductImageFallbacks([gardenRoses, ecRoses], {
    enabled: true,
    productIds: LOCAL_PRODUCT_IMAGE_FALLBACK_PRODUCT_IDS,
  });

  assert.deepEqual(ecRoses.images.map((image) => image.src), beforeEcImages);
  assert.deepEqual(gardenRoses.images.map((image) => image.src), beforeGardenImages);
  assert.equal(gardenRoses.images.some((image) => image.isFallback), false);
});
