import assert from 'node:assert/strict';
import test from 'node:test';

import { maskPhoneForDisplay, maskTextForDisplay } from '../src/catalog/core/privacy.js';

test('masks names and companies while preserving recognizable fragments', () => {
  const actual = 'Fresa AI';
  const displayed = maskTextForDisplay(actual);

  assert.equal(maskTextForDisplay('Fresa'), 'Fr•••');
  assert.equal(maskTextForDisplay('Test'), 'Te••');
  assert.equal(maskTextForDisplay('GFT'), 'G••');
  assert.equal(displayed, 'Fr••• ••');
  assert.equal(actual, 'Fresa AI', 'masking does not alter the source value');
});

test('masks the middle phone digits and keeps its formatting', () => {
  assert.equal(maskPhoneForDisplay('+57 350 576 59 62'), '+57 ••• ••• •• 62');
  assert.equal(maskPhoneForDisplay('5555555555'), '55••••••55');
});

test('does not echo malformed sensitive values', () => {
  assert.equal(maskTextForDisplay('---'), '•••');
  assert.equal(maskPhoneForDisplay('unknown'), '••••••');
});
