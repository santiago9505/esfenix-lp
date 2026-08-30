import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

const snapshot = JSON.parse(
  fs.readFileSync(new URL('../public/data/catalog-snapshot.json', import.meta.url), 'utf8'),
);

test('the fast catalog snapshot is populated and contains only stable media URLs', () => {
  assert.equal(snapshot.version, 1);
  assert.ok(Array.isArray(snapshot.products));
  assert.ok(snapshot.products.length > 0);

  const serialized = JSON.stringify(snapshot.products);
  assert.ok(
    gzipSync(Buffer.from(serialized)).byteLength < 150_000,
    'compressed snapshot stays small enough for the first render',
  );
  assert.doesNotMatch(serialized, /https?:\/\//i, 'expiring remote attachments are not bundled');
  assert.doesNotMatch(serialized, /"prices"\s*:/i, 'prices stay out of the public snapshot');

  for (const product of snapshot.products) {
    const attachments = [
      ...(product.images ?? []),
      ...(product.locations ?? []).flatMap((location) =>
        (location.variants ?? []).flatMap((variant) => variant.images ?? []),
      ),
    ];
    for (const image of attachments) {
      if (!image?.src?.startsWith('/data/catalog-assets/') || !image.src.endsWith('.webp')) continue;
      const thumbnailUrl = image.src.replace(/\.webp$/i, '-thumb.webp');
      assert.ok(
        fs.existsSync(new URL(`../public${thumbnailUrl}`, import.meta.url)),
        `missing fast thumbnail for ${image.src}`,
      );
    }

    for (const location of product.locations ?? []) {
      for (const variant of location.variants ?? []) {
        for (const cents of Object.values(variant.prices ?? {})) {
          assert.ok(Number.isInteger(cents) && cents >= 0, 'serialized catalog prices use non-negative cents');
        }
      }
    }
  }
});
