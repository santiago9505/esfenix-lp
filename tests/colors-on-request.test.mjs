import test from 'node:test';
import assert from 'node:assert/strict';
import { offersColorsOnRequest } from '../src/catalog/data/colors-on-request.js';

const variant = (overrides = {}) => ({ variety: 'Jumbo', color: null, ...overrides });

test('Preserved Roses offer colours on request while Fresa lists no colours', () => {
  assert.equal(offersColorsOnRequest({ slug: 'preserved-roses', variants: [variant(), variant({ variety: 'Large' })] }), true);
});

test('families not confirmed by Esfenix never show the note', () => {
  assert.equal(offersColorsOnRequest({ slug: 'anemones', variants: [variant()] }), false);
  assert.equal(offersColorsOnRequest({ slug: 'garden-roses', variants: [variant({ variety: 'Aly' })] }), false);
  assert.equal(offersColorsOnRequest(null), false);
});

test('once Fresa lists colours the normal colour choice takes over', () => {
  assert.equal(offersColorsOnRequest({ slug: 'preserved-roses', variants: [variant({ color: 'Red' })] }), false);
});
