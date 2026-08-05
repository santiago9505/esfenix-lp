import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const snapshot = JSON.parse(
  fs.readFileSync(new URL('../public/data/catalog-snapshot.json', import.meta.url), 'utf8'),
);

test('the fast catalog snapshot is populated and carries no pricing fields', () => {
  assert.equal(snapshot.version, 1);
  assert.ok(Array.isArray(snapshot.products));
  assert.ok(snapshot.products.length > 0);

  const serialized = JSON.stringify(snapshot.products);
  assert.ok(Buffer.byteLength(serialized) < 500_000, 'snapshot stays small enough for the first render');
  assert.doesNotMatch(serialized, /"(?:price|precio|cost|costo|amount)"\s*:/i);
  assert.doesNotMatch(serialized, /https?:\/\//i, 'expiring remote attachments are not bundled');
});
