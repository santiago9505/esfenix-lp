import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { getProductsForLocation } from '../src/catalog/core/repository.js';
import {
  applyLocalProductImageFallbacks,
  LOCAL_CATEGORY_IMAGE_FALLBACKS,
  LOCAL_PRODUCT_IMAGE_FALLBACK_PRODUCT_IDS,
  LOCAL_VARIANT_IMAGE_FALLBACK_PRODUCT_IDS,
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

test('EC Roses fills an exact missing variety photo without replacing Fresa photography', () => {
  const ecRoses = structuredClone(snapshot.products.find((product) => product.slug === 'ec-roses'));
  const originalImages = ecRoses.images.map((image) => image.src);
  const houston = ecRoses.locations.find((location) => location.location === 'houston');
  const amnesia = houston.variants.filter((variant) => variant.variety === 'Amnesia');
  const photographed = houston.variants.find((variant) => (variant.images ?? []).length > 0);
  const photographedBefore = photographed.images.map((image) => image.src);

  assert.ok(amnesia.every((variant) => variant.images.length === 0));

  applyLocalProductImageFallbacks([ecRoses], {
    enabled: true,
    variantProductIds: LOCAL_VARIANT_IMAGE_FALLBACK_PRODUCT_IDS,
  });

  assert.ok(amnesia.every((variant) =>
    variant.images[0]?.src === '/assets/images/flowers-fallback/roses-amnesia.webp'
      && variant.images[0]?.isFallback === true,
  ));
  assert.deepEqual(photographed.images.map((image) => image.src), photographedBefore);
  assert.deepEqual(ecRoses.images.map((image) => image.src), originalImages);
});

test('Supplies uses approved category artwork only where Fresa has no photo', () => {
  const realImage = { id: 'fresa-photo', src: 'https://cdn.example/floral-tape.webp' };
  const supplies = {
    id: 'floral-tape',
    slug: 'floral-tape',
    name: 'Floral tape',
    category: 'supplies',
    images: [realImage],
    locations: [
      {
        location: 'houston',
        variants: [
          { id: 'green', images: [realImage] },
          { id: 'white', images: [] },
        ],
      },
    ],
  };
  const flower = {
    id: 'hydrangea',
    slug: 'hydrangea',
    name: 'Hydrangea',
    category: 'other-flowers',
    images: [],
    locations: [{ location: 'houston', variants: [{ id: 'blue', images: [] }] }],
  };

  applyLocalProductImageFallbacks([supplies, flower], { enabled: true });

  assert.deepEqual(supplies.images, [realImage], 'a real product photo remains authoritative');
  assert.deepEqual(supplies.locations[0].variants[0].images, [realImage]);
  assert.equal(
    supplies.locations[0].variants[1].images[0].src,
    LOCAL_CATEGORY_IMAGE_FALLBACKS.supplies.src,
  );
  assert.equal(supplies.locations[0].variants[1].images[0].isFallback, true);
  assert.match(supplies.locations[0].variants[1].images[0].alt, /Floral tape/);
  assert.deepEqual(flower.images, []);
  assert.deepEqual(flower.locations[0].variants[0].images, []);
});

test('Supplies adds the approved artwork at product and variant level when all photos are missing', () => {
  const supplies = {
    id: 'floral-foam',
    slug: 'floral-foam',
    name: 'Floral foam',
    category: 'supplies',
    images: [],
    locations: [{ location: 'houston', variants: [{ id: 'brick', images: [] }] }],
  };

  applyLocalProductImageFallbacks([supplies], { enabled: true });

  assert.equal(supplies.images[0].src, '/assets/images/products/supplies.webp');
  assert.equal(supplies.locations[0].variants[0].images[0].src, supplies.images[0].src);
});
