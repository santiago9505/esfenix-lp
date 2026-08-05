import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_LOCATION_ID,
  LOCATIONS,
  getLocation,
  isKnownLocation,
  locationCatalogMap,
  locationServiceMap,
  resolveLocation,
} from '../src/catalog/data/locations.js';

test('every selectable location is configured once', () => {
  const ids = LOCATIONS.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate ids');
  assert.deepEqual(ids.sort(), ['dmv', 'houston', 'other', 'seattle', 'the-woodlands']);
});

test('each location maps to its service centre', () => {
  assert.equal(locationServiceMap.houston, 'HOUSTON');
  assert.equal(locationServiceMap['the-woodlands'], 'THE_WOODLANDS');
  assert.equal(locationServiceMap.seattle, 'SEATTLE');
  assert.equal(locationServiceMap.dmv, 'DMV');
});

test('Other U.S. location is served by Houston but is not Houston', () => {
  const other = getLocation('other');
  assert.equal(other.serviceCenter, 'HOUSTON', 'Houston handles the request');
  assert.equal(other.catalogSource, 'houston', 'and it shows the Houston catalog');
  assert.notEqual(other.id, 'houston', 'but the selected location stays distinct');
  assert.equal(other.requiresShippingDestination, true, 'so it must ask where to ship');
});

test('only Other U.S. location asks for a shipping destination', () => {
  const asking = LOCATIONS.filter((l) => l.requiresShippingDestination).map((l) => l.id);
  assert.deepEqual(asking, ['other']);
});

test('The Woodlands keeps its own service centre while sharing a catalog', () => {
  const woodlands = getLocation('the-woodlands');
  assert.equal(woodlands.catalogSource, 'houston');
  assert.equal(woodlands.serviceCenter, 'THE_WOODLANDS');
});

test('catalog sources are limited to the lists that actually exist', () => {
  const sources = new Set(Object.values(locationCatalogMap));
  assert.deepEqual([...sources].sort(), ['dmv', 'houston', 'seattle']);
});

test('unknown values resolve to the default rather than throwing', () => {
  assert.equal(isKnownLocation('atlantis'), false);
  assert.equal(getLocation('atlantis'), null);
  assert.equal(resolveLocation('atlantis').id, DEFAULT_LOCATION_ID);
  assert.equal(resolveLocation(null).id, DEFAULT_LOCATION_ID);
  assert.equal(resolveLocation(undefined).id, DEFAULT_LOCATION_ID);
});
