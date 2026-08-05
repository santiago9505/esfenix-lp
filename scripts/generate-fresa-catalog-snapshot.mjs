import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchCatalogPages, normalizeCatalog } from '../src/catalog/core/fresa-catalog.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(root, 'public', 'data', 'catalog-snapshot.json');

async function readEnvironment() {
  const values = { ...process.env };
  for (const name of ['.env', '.env.local']) {
    try {
      const text = await fs.readFile(path.join(root, name), 'utf8');
      for (const line of text.split(/\r?\n/)) {
        const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (!match) continue;
        values[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return values;
}

function isBundledAttachment(attachment) {
  const source = String(attachment?.src ?? attachment?.url ?? '');
  return attachment?.isFallback === true || source.startsWith('/');
}

function snapshotProduct(product) {
  return {
    ...product,
    images: (product.images ?? []).filter(isBundledAttachment),
    files: [],
    locations: (product.locations ?? []).map((location) => ({
      ...location,
      variants: (location.variants ?? []).map((variant) => ({
        ...variant,
        images: (variant.images ?? []).filter(isBundledAttachment),
        files: [],
      })),
    })),
  };
}

const env = await readEnvironment();
const apiUrl = String(env.FRESA_CATALOG_API_URL ?? '').trim();
const apiKey = String(env.FRESA_CATALOG_API_KEY ?? '').trim();

if (!apiUrl || !apiKey) {
  throw new Error('FRESA_CATALOG_API_URL and FRESA_CATALOG_API_KEY are required.');
}

const payload = await fetchCatalogPages({ apiUrl, apiKey });
const products = normalizeCatalog(payload).map(snapshotProduct);

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify({
  version: 1,
  generatedAt: new Date().toISOString(),
  products,
})}\n`, 'utf8');

const bytes = Buffer.byteLength(JSON.stringify(products));
console.log(`Wrote ${products.length} price-free products (${bytes} bytes) to ${outputPath}`);
