/**
 * Verifies that every product in every location's catalog resolves to a product
 * option the Fresa form actually offers.
 *
 *   npm run check:fresa-map
 *
 * Exits non-zero when something is unmapped, so a product added to the catalog
 * cannot silently become unselectable in the quote form. Unmapped products are
 * not a crash at runtime — the quote still goes through, with those lines
 * described in the notes — but they should be fixed in
 * src/catalog/data/fresa-product-aliases.js or in the Fresa form itself.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LOCATIONS } from '../src/catalog/data/locations.js';
import { FRESA_FORM } from '../src/catalog/data/fresa-form.js';
import { resolveFresaProduct } from '../src/catalog/core/fresa-mapping.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8'));

const catalog = read('public/data/catalog-snapshot.json');
const fresa = FRESA_FORM;

const normalize = (v) =>
  String(v ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const unmapped = [];
const usedOptions = new Map();
let checked = 0;

for (const location of LOCATIONS) {
  const source = location.catalogSource;
  const options = fresa.productOptions[source] ?? [];
  if (!usedOptions.has(source)) usedOptions.set(source, new Set());

  for (const product of catalog.products) {
    const entry = product.locations.find((l) => l.location === source);
    if (!entry || !entry.catalogAvailable) continue;

    for (const variant of entry.variants) {
      checked += 1;
      const { option, candidates } = resolveFresaProduct(location.id, product, variant);
      if (option) usedOptions.get(source).add(option);
      else {
        unmapped.push({
          location: location.id,
          source,
          product: product.name,
          productId: product.id,
          variant: [variant.variety, variant.color, variant.lengthCm && `${variant.lengthCm}cm`]
            .filter(Boolean)
            .join(' / ') || '(single)',
          tried: candidates,
        });
      }
    }
  }
}

// Collapse to one row per product+variant shape; a product with 200 rose
// varieties should not print 200 identical failures.
const grouped = new Map();
for (const row of unmapped) {
  const key = `${row.source}|${row.productId}|${row.tried[0] ?? ''}`;
  if (!grouped.has(key)) grouped.set(key, { ...row, count: 0 });
  grouped.get(key).count += 1;
}

console.log(`Checked ${checked} product/variant combinations across ${LOCATIONS.length} locations.`);

for (const [source, used] of usedOptions) {
  const all = fresa.productOptions[source] ?? [];
  const unused = all.filter((o) => !used.has(o));
  console.log(`\n${source}: ${used.size}/${all.length} form options reachable from the catalog.`);
  if (unused.length) console.log(`  never offered: ${unused.join(', ')}`);
}

if (grouped.size === 0) {
  console.log('\nAll catalog products map to a Fresa form option.');
  process.exit(0);
}

console.log(`\n${grouped.size} unmapped product/variant shape(s):`);
for (const row of grouped.values()) {
  console.log(`  [${row.location}] ${row.product} — ${row.variant} (${row.count} variant(s))`);
  console.log(`      tried: ${row.tried.join(' | ')}`);
}
process.exit(1);
