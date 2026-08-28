import assert from 'node:assert/strict';
import test from 'node:test';

import { getSeasonType, resolveSeason } from '../src/catalog/core/season.js';

test('Valentine season is high on both boundaries and accepts date-time values', () => {
  assert.equal(getSeasonType('2026-02-08'), 'HIGH');
  assert.equal(getSeasonType('2026-02-14T12:00'), 'HIGH');

  assert.deepEqual(resolveSeason('2026-02-08'), {
    type: 'HIGH',
    ruleId: 'valentines-day',
    label: "Valentine's Day",
    startDate: '2026-02-08',
    dueDate: '2026-02-14',
    customerMessage: "Due to high demand during Valentine's Day, availability may vary.",
  });
});

test("Mother's Day season is high only inside its configured window", () => {
  assert.equal(resolveSeason('2026-05-02').type, 'LOW');
  assert.equal(resolveSeason('2026-05-03').ruleId, 'mothers-day');
  assert.equal(resolveSeason('2026-05-09').ruleId, 'mothers-day');
  assert.equal(resolveSeason('2026-05-10').type, 'LOW');
});

test('empty and invalid dates safely resolve to low season', () => {
  assert.equal(resolveSeason('').type, 'LOW');
  assert.equal(resolveSeason('2026-02-30').type, 'LOW');
  assert.equal(resolveSeason('not-a-date').ruleId, null);
});
