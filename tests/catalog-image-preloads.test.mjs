import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { catalogImagePreloads, catalogPreloadManifest } from '../scripts/vite-plugin-catalog-preloads.mjs';
import { preloadCatalogImages } from '../src/catalog/preload-images.js';
import { productImageSource, productMedia } from '../src/catalog/ui/dom.js';

function browser(url = '/catalog', stored = null) {
  const links = [];
  return {
    links,
    window: {
      location: new URL(url, 'https://esfenix.com'),
      localStorage: { getItem: () => JSON.stringify(stored) },
    },
    document: {
      head: { append: link => links.push(link) },
      querySelector: selector => links.find(link => selector.includes(`href="${link.href}"`)),
      createElement: () => ({ setAttribute(key, value) { this[key] = value; } }),
    },
  };
}

const manifest = {
  defaultLocation: 'other',
  locations: { other: 0, houston: 0, seattle: 1 },
  groups: [
    { all: ['/pink.webp', '/garden.webp', '/dyed.webp'], roses: ['/pink.webp', '/garden.webp', '/dyed.webp'], foliage: ['/green.webp'], supplies: [] },
    { all: ['/seattle.webp'], roses: ['/seattle.webp'], foliage: [], supplies: [] },
  ],
};

test('first-row hints start independently of app/data loading and are reused', () => {
  const env = browser();
  const source = `(${preloadCatalogImages.toString()})(${JSON.stringify(manifest)})`;
  // No fetch, app, imports or catalog DOM are available to the early script.
  runInNewContext(source, { window: env.window, document: env.document, URL });
  assert.deepEqual(env.links.map(link => link.href), ['/pink.webp', '/garden.webp', '/dyed.webp']);
  assert.ok(env.links.every(link => link.rel === 'preload' && link.as === 'image' && link.fetchpriority === 'high'));
  preloadCatalogImages(manifest, env.window, env.document);
  assert.equal(env.links.length, 3);
});

test('hints respect URL location, stored location, category and empty results', () => {
  for (const [url, stored, expected] of [
    ['/catalog?location=seattle', 'houston', ['/seattle.webp']],
    ['/catalog', 'seattle', ['/seattle.webp']],
    ['/catalog?location=unknown', 'seattle', ['/seattle.webp']],
    ['/catalog?category=foliage', null, ['/green.webp']],
    ['/catalog?category=supplies', null, []],
    ['/catalog?category=unknown', null, ['/pink.webp', '/garden.webp', '/dyed.webp']],
    ['/catalog?category=foliage,roses', null, ['/pink.webp', '/garden.webp', '/dyed.webp']],
  ]) {
    const env = browser(url, stored);
    preloadCatalogImages(manifest, env.window, env.document);
    assert.deepEqual(env.links.map(link => link.href), expected, url);
  }
  const env = browser();
  env.window.localStorage.getItem = () => { throw new Error('Storage disabled'); };
  preloadCatalogImages(manifest, env.window, env.document);
  assert.equal(env.links.length, 3);
});

test('product, quote and deeply filtered pages do not download unrelated cards', () => {
  for (const url of ['/catalog/roses/ec-roses', '/catalog/quote', '/catalog?color=pink', '/catalog?variety=be-sweet', '/catalog?length=60', '/catalog?measure=bunch', '/']) {
    const env = browser(url);
    preloadCatalogImages(manifest, env.window, env.document);
    assert.equal(env.links.length, 0, url);
  }
});

test('missing photos do not promote offscreen images into the first row', () => {
  const env = browser();
  const sparse = { ...manifest, groups: [{ all: [null, '/same.webp', '/same.webp', '/offscreen.webp'] }] };
  preloadCatalogImages(sparse, env.window, env.document);
  assert.deepEqual(env.links.map(link => link.href), ['/same.webp']);
});

test('build derives a compact, executable script from actual catalog card photos', async () => {
  const plugin = catalogImagePreloads();
  plugin.configResolved({ root: process.cwd(), build: { outDir: 'dist' } });
  const html = await plugin.transformIndexHtml.handler('<head></head><body></body>', { filename: `${process.cwd()}/catalog.html` });
  const url = html.match(/src="(\/data\/catalog-preloads\.[a-f0-9]+\.js)"/)[1];
  let middleware;
  plugin.configureServer({ middlewares: { use: callback => { middleware = callback; } } });
  let source;
  middleware({ url }, { setHeader() {}, end(value) { source = value; } }, () => assert.fail('script was not served'));
  assert.ok(Buffer.byteLength(source) < 8000, 'early script must stay small');
  const env = browser();
  runInNewContext(source, { window: env.window, document: env.document, URL });
  assert.equal(env.links.length, 3);
  for (const link of env.links) {
    assert.match(link.href, /^\/data\/catalog-assets\/[a-f0-9]+-thumb\.webp$/);
    assert.ok(existsSync(new URL(`../public${link.href}`, import.meta.url)));
  }
  const original = '<head></head>';
  assert.equal(await plugin.transformIndexHtml.handler(original, { filename: `${process.cwd()}/index.html` }), original);
});

test('manifest preserves location-specific photos and the pink EC Roses opening variety', () => {
  const products = [{
    id: 'roses', slug: 'ec-roses', name: 'EC Roses', category: 'roses',
    locations: ['houston', 'seattle'].map(location => ({
      location, catalogAvailable: true,
      variants: [
        { variety: 'Freedom', color: 'Red', images: [{ src: `/data/catalog-assets/${location}-red.webp` }] },
        { variety: 'Be Sweet', color: 'Pink', images: [{ src: `/data/catalog-assets/${location}-pink.webp` }] },
      ],
    })),
  }];
  const result = catalogPreloadManifest(products);
  assert.deepEqual(result.groups[result.locations.houston].all, ['/data/catalog-assets/houston-pink-thumb.webp']);
  assert.deepEqual(result.groups[result.locations.seattle].all, ['/data/catalog-assets/seattle-pink-thumb.webp']);
  assert.deepEqual(result.groups[result.locations.dmv].all, []);
});

test('media keeps thumbnail/full-size selection, scheduling hints and error fallback', () => {
  const image = { src: '/data/catalog-assets/photo.webp' };
  assert.equal(productImageSource(image.src, 480), '/data/catalog-assets/photo-thumb.webp');
  assert.equal(productImageSource(image.src, 960), image.src);
  assert.equal(productImageSource('https://example.com/photo.webp', 480), 'https://example.com/photo.webp');
  const previous = { document: globalThis.document, Node: globalThis.Node };
  class Element {
    children = [];
    attributes = new Map();
    listeners = {};
    dataset = {};
    classList = { remove() {}, add: value => { this.fallback = value; } };
    setAttribute(key, value) { this.attributes.set(key, value); }
    addEventListener(key, value) { this.listeners[key] = value; }
    append(child) { this.children.push(child); child.parentElement = this; }
    remove() { this.parentElement.children = this.parentElement.children.filter(child => child !== this); }
  }
  globalThis.Node = Element;
  globalThis.document = { createElement: () => new Element() };
  try {
    const media = productMedia(image, { label: 'Rose', width: 480, eager: true });
    const img = media.children[0];
    assert.equal(img.attributes.get('loading'), 'eager');
    assert.equal(img.attributes.get('fetchpriority'), 'high');
    assert.equal(img.attributes.get('src'), '/data/catalog-assets/photo-thumb.webp');
    assert.ok([...img.attributes.keys()].indexOf('fetchpriority') < [...img.attributes.keys()].indexOf('src'));
    img.listeners.error({ currentTarget: img });
    assert.equal(media.dataset.placeholder, 'true');
    assert.equal(media.children.length, 0);
    const lazy = productMedia(image, { label: 'Rose' }).children[0];
    assert.equal(lazy.attributes.get('loading'), 'lazy');
    assert.equal(lazy.attributes.get('fetchpriority'), 'auto');
  } finally {
    globalThis.document = previous.document;
    globalThis.Node = previous.Node;
  }
});
