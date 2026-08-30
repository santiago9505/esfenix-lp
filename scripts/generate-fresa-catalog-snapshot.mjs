import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

import { fetchCatalogPages, normalizeCatalog } from '../src/catalog/core/fresa-catalog.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(root, 'public', 'data', 'catalog-snapshot.json');
const assetDirectory = path.join(root, 'public', 'data', 'catalog-assets');
const thumbnailWidth = 480;

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

function extensionFor(attachment, contentType) {
  const fromName = path.extname(String(attachment?.name ?? '')).toLowerCase();
  if (/^\.[a-z0-9]{1,8}$/.test(fromName)) return fromName;
  const byType = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/svg+xml': '.svg',
    'application/pdf': '.pdf',
  };
  return byType[String(contentType ?? '').split(';')[0].trim().toLowerCase()] ?? '.bin';
}

async function snapshotAttachment(attachment) {
  const sourceUrl = String(attachment?.url ?? attachment?.src ?? '').trim();
  if (!sourceUrl || sourceUrl.startsWith('/')) return attachment;

  try {
    const response = await fetch(sourceUrl, { headers: { Accept: '*/*' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const sourceBytes = Buffer.from(await response.arrayBuffer());
    const contentType = String(response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const canOptimizeImage = attachment?.isImage === true
      && contentType !== 'image/gif'
      && contentType !== 'image/svg+xml';
    const bytes = canOptimizeImage
      ? await sharp(sourceBytes)
        .rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82, effort: 5 })
        .toBuffer()
      : sourceBytes;
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 24);
    const extension = canOptimizeImage ? '.webp' : extensionFor(attachment, contentType);
    const filename = `${hash}${extension}`;
    await fs.mkdir(assetDirectory, { recursive: true });
    const writes = [fs.writeFile(path.join(assetDirectory, filename), bytes)];
    if (canOptimizeImage) {
      const thumbnail = await sharp(sourceBytes)
        .rotate()
        .resize({
          width: thumbnailWidth,
          height: thumbnailWidth,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 76, effort: 5 })
        .toBuffer();
      writes.push(fs.writeFile(path.join(assetDirectory, `${hash}-thumb.webp`), thumbnail));
    }
    await Promise.all(writes);
    const localUrl = `/data/catalog-assets/${filename}`;
    return {
      ...attachment,
      url: localUrl,
      ...(attachment?.isImage ? { src: localUrl, contentType: canOptimizeImage ? 'image/webp' : contentType } : {}),
    };
  } catch (error) {
    console.warn(`Skipped unavailable attachment: ${String(attachment?.name ?? 'unnamed file')}`);
    return null;
  }
}

async function pruneCatalogAssets(products) {
  const referenced = new Set();
  const collect = (attachments = []) => {
    for (const attachment of attachments) {
      const url = String(attachment?.url ?? '').trim();
      if (!url.startsWith('/data/catalog-assets/')) continue;
      const filename = path.basename(url);
      referenced.add(filename);
      if (attachment?.isImage && filename.endsWith('.webp')) {
        referenced.add(filename.replace(/\.webp$/i, '-thumb.webp'));
      }
    }
  };
  for (const product of products) {
    collect(product.images);
    collect(product.files);
    for (const location of product.locations ?? []) {
      for (const variant of location.variants ?? []) {
        collect(variant.images);
        collect(variant.files);
      }
    }
  }

  await fs.mkdir(assetDirectory, { recursive: true });
  const existing = await fs.readdir(assetDirectory, { withFileTypes: true });
  await Promise.all(existing
    .filter((entry) => entry.isFile() && !referenced.has(entry.name))
    .map((entry) => fs.unlink(path.join(assetDirectory, entry.name))));
}

async function snapshotAttachments(attachments = []) {
  const snapshots = (await Promise.all(attachments.map(snapshotAttachment))).filter(Boolean);
  const seen = new Set();
  return snapshots.filter((attachment) => {
    const key = String(attachment?.contentKey ?? attachment?.url ?? attachment?.src ?? attachment?.id ?? '').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function snapshotProduct(product) {
  return {
    ...product,
    // Fresa attachment URLs expire. Copy their current bytes into the static
    // release so images and files remain stable without exposing a credential.
    images: await snapshotAttachments(product.images),
    files: await snapshotAttachments(product.files),
    locations: await Promise.all((product.locations ?? []).map(async (location) => ({
      ...location,
      variants: await Promise.all((location.variants ?? []).map(async (variant) => ({
        ...variant,
        images: await snapshotAttachments(variant.images),
        files: await snapshotAttachments(variant.files),
      }))),
    }))),
  };
}

/** Prices are internal catalog data and must never enter the public snapshot. */
function stripPublicPrices(products) {
  return products.map((product) => ({
    ...product,
    locations: (product.locations ?? []).map((location) => ({
      ...location,
      variants: (location.variants ?? []).map(({ prices: _prices, ...variant }) => variant),
    })),
  }));
}

function readCatalogSources(env, apiUrl) {
  const configured = String(env.FRESA_CATALOG_SOURCES ?? '').trim();
  if (configured) {
    const parsed = JSON.parse(configured);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error('FRESA_CATALOG_SOURCES must be a non-empty JSON array.');
    }
    return parsed.map((source) => ({
      listId: String(source?.listId ?? '').trim(),
      name: String(source?.name ?? '').trim(),
      activeFieldId: String(source?.activeFieldId ?? '').trim(),
    }));
  }

  const fallbackUrl = new URL(apiUrl);
  const listId = fallbackUrl.searchParams.get('listId') ?? '';
  return listId ? [{ listId, name: 'Products', activeFieldId: '' }] : [];
}

const env = await readEnvironment();
const apiUrl = String(env.FRESA_CATALOG_API_URL ?? '').trim();
const apiKey = String(env.FRESA_CATALOG_API_KEY ?? '').trim();

if (!apiUrl || !apiKey) {
  throw new Error('FRESA_CATALOG_API_URL and FRESA_CATALOG_API_KEY are required.');
}

const sources = readCatalogSources(env, apiUrl);
if (sources.some((source) => !source.listId || !source.name)) {
  throw new Error('Every FRESA_CATALOG_SOURCES entry requires listId and name.');
}

const payloads = [];
for (const source of sources) {
  const sourceUrl = new URL(apiUrl);
  sourceUrl.searchParams.set('listId', source.listId);
  sourceUrl.searchParams.set('statusCanonical', 'ACTIVA');
  sourceUrl.searchParams.set('parentOnly', 'true');
  if (source.activeFieldId) {
    sourceUrl.searchParams.set('filterFieldId', source.activeFieldId);
    sourceUrl.searchParams.set('filterFieldValueJson', 'true');
  }
  payloads.push(await fetchCatalogPages({
    apiUrl: sourceUrl.toString(),
    apiKey,
    expectedListId: source.listId,
    listName: source.name,
    // The list endpoint can lag behind task details for newly uploaded
    // attachments. Hydrate empty file fields while building the static release.
    hydrateAttachments: true,
    attachmentConcurrency: 32,
    attachmentTimeoutMs: 10000,
  }));
}

const payload = {
  success: true,
  catalog: {
    id: 'esfenix-native-lists',
    name: 'Landing Page',
    products: payloads.flatMap((entry) => entry.catalog.products ?? []),
    columns: payloads.flatMap((entry) => entry.catalog.columns ?? []),
    lists: payloads.flatMap((entry) => entry.catalog.lists ?? []),
  },
};
const productsWithInternalData = await Promise.all(normalizeCatalog(payload).map(snapshotProduct));
const products = stripPublicPrices(productsWithInternalData);
await pruneCatalogAssets(products);

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify({
  version: 1,
  generatedAt: new Date().toISOString(),
  products,
})}\n`, 'utf8');

const bytes = Buffer.byteLength(JSON.stringify(products));
console.log(`Wrote ${products.length} products with stable media and no public prices (${bytes} bytes) to ${outputPath}`);
