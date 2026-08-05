import assert from 'node:assert/strict';
import test from 'node:test';

import { maskEmailForDisplay, maskPhoneForDisplay } from '../src/catalog/core/privacy.js';

test('masks an email while preserving recognizable fragments', () => {
  const actual = 'freddy@fresaai.com';
  const displayed = maskEmailForDisplay(actual);

  assert.equal(displayed, 'fr••••@fr••••.com');
  assert.ok(!displayed.includes('freddy'));
  assert.ok(!displayed.includes('fresaai'));
  assert.equal(actual, 'freddy@fresaai.com', 'masking does not alter the source value');
});

test('masks the middle phone digits and keeps its formatting', () => {
  assert.equal(maskPhoneForDisplay('+57 350 576 59 62'), '+57 ••• ••• •• 62');
  assert.equal(maskPhoneForDisplay('5555555555'), '55••••••55');
});

test('does not echo malformed sensitive values', () => {
  assert.equal(maskEmailForDisplay('not-an-email'), '••••••');
  assert.equal(maskPhoneForDisplay('unknown'), '••••••');
});
