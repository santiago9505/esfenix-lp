import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeSocialMediaUrl } from '../src/catalog/core/social-media-url.js';

test('adds HTTPS to domains entered without www', () => {
  assert.equal(
    normalizeSocialMediaUrl('cesarricarte.com'),
    'https://cesarricarte.com',
  );
});

test('adds HTTPS to domains entered with www', () => {
  assert.equal(
    normalizeSocialMediaUrl('www.cesarricarte.com'),
    'https://www.cesarricarte.com',
  );
});

test('keeps complete HTTP(S) social links unchanged', () => {
  assert.equal(
    normalizeSocialMediaUrl('https://www.instagram.com/esfenix/'),
    'https://www.instagram.com/esfenix/',
  );
  assert.equal(
    normalizeSocialMediaUrl('http://example.com/profile'),
    'http://example.com/profile',
  );
});

test('normalizes domains with paths, queries and surrounding spaces', () => {
  assert.equal(
    normalizeSocialMediaUrl('  instagram.com/esfenix?ref=quote  '),
    'https://instagram.com/esfenix?ref=quote',
  );
});

test('rejects unsupported protocols and values that are not domains', () => {
  assert.equal(normalizeSocialMediaUrl('ftp://example.com/profile'), '');
  assert.equal(normalizeSocialMediaUrl('javascript:alert(1)'), '');
  assert.equal(normalizeSocialMediaUrl('@esfenix'), '');
  assert.equal(normalizeSocialMediaUrl('not a website'), '');
});
