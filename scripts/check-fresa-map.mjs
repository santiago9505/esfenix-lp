/**
 * Verifies the scalable landing -> public form contract.
 *
 * Every selectable catalog variant must carry the native Fresa task id that
 * the public form uses as its catalog item value. Labels remain presentation
 * data; they are never the integration key.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LOCATIONS } from '../src/catalog/data/locations.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(readFileSync(resolve(ROOT, 'public/data/catalog-snapshot.json'), 'utf8'));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const invalid = [];
const sourceIds = new Map();
let checked = 0;
let priced = 0;

for (const location of LOCATIONS) {
  const source = location.catalogSource;
  if (!sourceIds.has(source)) sourceIds.set(source, new Set());

  for (const product of catalog.products ?? []) {
    const entry = (product.locations ?? []).find((candidate) => candidate.location === source);
    if (!entry?.catalogAvailable) continue;

    for (const variant of entry.variants ?? []) {
      checked += 1;
      const sourceProductId = String(variant.sourceProductId ?? '').trim();
      const sourceProductName = String(variant.sourceProductName ?? '').trim();
      const hasPrice = Object.values(variant.prices ?? {}).some((value) =>
        typeof value === 'number' && Number.isFinite(value) && value >= 0
      );
      if (hasPrice) priced += 1;

      if (!UUID.test(sourceProductId) || !sourceProductName) {
        invalid.push({
          location: location.id,
          product: product.name,
          variant: variant.id,
          sourceProductId,
          sourceProductName,
        });
        continue;
      }

      sourceIds.get(source).add(sourceProductId);
    }
  }
}

console.log(`Checked ${checked} selectable product/variant combinations across ${LOCATIONS.length} locations.`);
for (const [source, ids] of sourceIds) {
  console.log(`${source}: ${ids.size} native Fresa task id(s).`);
}
console.log(`${priced}/${checked} combinations include at least one current price; the rest remain available with price on request.`);

if (invalid.length === 0) {
  console.log('All selectable variants are linked by native Fresa task id.');
  process.exit(0);
}

console.error(`${invalid.length} selectable variant(s) are missing their native Fresa task identity:`);
for (const row of invalid.slice(0, 50)) {
  console.error(`  [${row.location}] ${row.product} (${row.variant})`);
}
process.exit(1);
