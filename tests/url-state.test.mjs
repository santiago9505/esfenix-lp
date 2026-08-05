import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import { installBrowserEnv, resetBrowserEnv, sampleProducts } from './helpers/browser-env.mjs';

let urlState;
let facets;
let repository;

before(async () => {
  installBrowserEnv({ url: 'http://localhost/catalog' });
  urlState = await import('../src/catalog/core/url-state.js');
  facets = await import('../src/catalog/core/facets.js');
  repository = await import('../src/catalog/core/repository.js');
});

after(resetBrowserEnv);

const houston = () => repository.getProductsForLocation(sampleProducts(), 'houston');

test('filters survive a round trip through the query string', () => {
  const filters = {
    ...facets.emptyFilters(),
    category: ['roses'],
    variety: ['Freedom'],
    color: ['Red'],
    lengthCm: [60],
  };

  const query = urlState.buildQueryString({ location: 'seattle', filters });
  assert.equal(query, '?location=seattle&category=roses&variety=freedom&color=red&length=60');

  const parsed = urlState.readFiltersFromUrl(houston(), new URLSearchParams(query));
  assert.deepEqual(parsed.category, ['roses']);
  assert.deepEqual(parsed.variety, ['Freedom'], 'slugs resolve back to the stored value');
  assert.deepEqual(parsed.color, ['Red']);
  assert.deepEqual(parsed.lengthCm, [60]);
});

test('multi-word values round trip through their slug', () => {
  const products = houston();
  products[0].variants.push({
    id: 'hot_hotpink_60cm',
    variety: 'Hot Lady',
    color: 'Hot Pink',
    lengthCm: 60,
    availableMeasures: ['stem'],
  });

  const filters = { ...facets.emptyFilters(), variety: ['Hot Lady'], color: ['Hot Pink'] };
  const query = urlState.buildQueryString({ location: 'houston', filters });
  assert.ok(query.includes('variety=hot-lady'));
  assert.ok(query.includes('color=hot-pink'));

  const parsed = urlState.readFiltersFromUrl(products, new URLSearchParams(query));
  assert.deepEqual(parsed.variety, ['Hot Lady']);
  assert.deepEqual(parsed.color, ['Hot Pink']);
});

test('unknown values are dropped instead of producing a filter that matches nothing', () => {
  const params = new URLSearchParams('?color=chartreuse&length=999&variety=nonesuch');
  const parsed = urlState.readFiltersFromUrl(houston(), params);
  assert.deepEqual(parsed.color, []);
  assert.deepEqual(parsed.lengthCm, []);
  assert.deepEqual(parsed.variety, []);
});

test('Supplies survives even though it has no products', () => {
  const parsed = urlState.readFiltersFromUrl(houston(), new URLSearchParams('?category=supplies'));
  assert.deepEqual(parsed.category, ['supplies']);
});

test('an unknown location is ignored so the default applies', () => {
  assert.equal(urlState.readLocationFromUrl(new URLSearchParams('?location=atlantis')), null);
  assert.equal(urlState.readLocationFromUrl(new URLSearchParams('?location=dmv')), 'dmv');
});

test('routes are parsed from the pathname', () => {
  assert.deepEqual(urlState.parseRoute('/catalog'), { view: 'list', category: null, slug: null });
  assert.deepEqual(urlState.parseRoute('/catalog/'), { view: 'list', category: null, slug: null });
  assert.deepEqual(urlState.parseRoute('/catalog/quote'), { view: 'quote', category: 'quote', slug: null });
  assert.deepEqual(urlState.parseRoute('/catalog/roses'), {
    view: 'list',
    category: 'roses',
    slug: null,
  });
  assert.deepEqual(urlState.parseRoute('/catalog/roses/ecuadorian-roses'), {
    view: 'product',
    category: 'roses',
    slug: 'ecuadorian-roses',
  });
});

test('product links carry the location and the active filters', () => {
  const filters = { ...facets.emptyFilters(), color: ['Red'] };
  const href = urlState.productHref(
    { category: 'roses', slug: 'roses-a' },
    { location: 'dmv', filters },
  );
  assert.equal(href, '/catalog/roses/roses-a?location=dmv&color=red');
});

test('no personal data is ever encoded in the query string', () => {
  const query = urlState.buildQueryString({
    location: 'other',
    filters: facets.emptyFilters(),
  });
  for (const forbidden of ['email', 'address', 'zip', 'city', 'state', 'phone']) {
    assert.ok(!query.toLowerCase().includes(forbidden), `${forbidden} must not appear in the URL`);
  }
});
