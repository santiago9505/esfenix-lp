import assert from 'node:assert/strict';
import test from 'node:test';

import {
  quantityAfterVarietyChange,
  usesColorAsVarietyFilter,
} from '../src/catalog/ui/variant-picker.js';

test('uses color as a variety filter when each variety has one color across stem lengths', () => {
  const variants = [
    { variety: 'Be Sweet', color: 'Pink', lengthCm: 50 },
    { variety: 'Be Sweet', color: 'Pink', lengthCm: 60 },
    { variety: 'Freedom', color: 'Red', lengthCm: 50 },
    { variety: 'Freedom', color: 'Red', lengthCm: 60 },
  ];

  assert.equal(usesColorAsVarietyFilter(variants), true);
});

test('keeps color as a selection when one variety is sold in multiple colors', () => {
  const variants = [
    { variety: 'Assorted', color: 'Pink', lengthCm: 50 },
    { variety: 'Assorted', color: 'White', lengthCm: 50 },
  ];

  assert.equal(usesColorAsVarietyFilter(variants), false);
});

test('does not render a color filter that cannot narrow the variety list', () => {
  const variants = [
    { variety: 'A', color: 'White', lengthCm: 50 },
    { variety: 'B', color: 'White', lengthCm: 60 },
  ];

  assert.equal(usesColorAsVarietyFilter(variants), false);
});

test('a different variety starts with its own quantity', () => {
  assert.equal(quantityAfterVarietyChange('Be Sweet', 'Atomic', 10), 1);
});

test('refining the same variety preserves its quantity', () => {
  assert.equal(quantityAfterVarietyChange('Atomic', 'Atomic', 11), 11);
  assert.equal(quantityAfterVarietyChange(null, 'Atomic', 1), 1);
});
