import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadProducts, getProductsForLocation } from '../src/catalog/core/repository.js';
import { CATEGORY_ORDER } from '../src/catalog/data/categories.js';
import { DEFAULT_LOCATION_ID, LOCATIONS } from '../src/catalog/data/locations.js';
import { resolveProductCardImage } from '../src/catalog/ui/product-card.js';
import { productImageSource } from '../src/catalog/ui/dom.js';
import { preloadCatalogImages } from '../src/catalog/preload-images.js';

/** Derive hints using the same location, ordering and photo rules as the cards. */
export function catalogPreloadManifest(products) {
  const groups = [];
  const locations = {};
  for (const location of LOCATIONS) {
    const list = getProductsForLocation(products, location.id);
    const sources = items => items.slice(0, 3).map(product => {
      const image = resolveProductCardImage(product);
      return image?.src?.startsWith('/') ? productImageSource(image.src, 480) : null;
    });
    const group = {
      all: sources(list),
      ...Object.fromEntries(CATEGORY_ORDER.map(category => [
        category, sources(list.filter(product => product.category === category)),
      ])),
    };
    const existing = groups.findIndex(candidate => JSON.stringify(candidate) === JSON.stringify(group));
    locations[location.id] = existing < 0 ? groups.push(group) - 1 : existing;
  }
  return { defaultLocation: DEFAULT_LOCATION_ID, locations, groups };
}

/** Serve identical early hints in development and in the static release. */
export function catalogImagePreloads() {
  let root;
  let outDir;
  const scripts = new Map();
  return {
    name: 'esfenix-catalog-image-preloads',
    configResolved(config) {
      root = config.root;
      outDir = resolve(root, config.build.outDir);
    },
    transformIndexHtml: {
      order: 'post',
      async handler(html, ctx) {
        if (!ctx.filename.replace(/\\/g, '/').endsWith('/catalog.html')) return html;
        const payload = JSON.parse(await readFile(resolve(root, 'public/data/catalog-snapshot.json'), 'utf8'));
        const products = await loadProducts({
          force: true,
          liveUrl: '',
          snapshotFetchImpl: async () => ({ ok: true, json: async () => payload }),
        });
        const manifest = catalogPreloadManifest(products);
        const source = `try { (${preloadCatalogImages.toString()})(${JSON.stringify(manifest)}); } catch {}\n`;
        const hash = createHash('sha256').update(source).digest('hex').slice(0, 16);
        const url = `/data/catalog-preloads.${hash}.js`;
        scripts.set(url, source);
        return html.replace('</head>', `<script src="${url}" async fetchpriority="high"></script>\n</head>`);
      },
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const source = scripts.get((request.url ?? '').split('?')[0]);
        if (!source) return next();
        response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        response.end(source);
      });
    },
    async closeBundle() {
      for (const [url, source] of scripts) {
        const output = resolve(outDir, `.${url}`);
        await mkdir(resolve(outDir, 'data'), { recursive: true });
        await writeFile(output, source);
      }
    },
  };
}
