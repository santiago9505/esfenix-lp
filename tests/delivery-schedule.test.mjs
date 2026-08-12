import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatTimeRange,
  getDeliverySlots,
  getFirstSelectableDate,
  hasOpenDeliverySlots,
  hasRemainingWorkingTime,
  isDateSelectable,
  normalizeDeliveryDate,
  normalizeDeliveryValue,
} from '../src/catalog/core/delivery-schedule.js';

const timeZone = 'UTC';

test('delivery dates include weekends with shorter weekend windows', () => {
  const now = new Date('2026-08-05T07:30:00Z');
  assert.equal(isDateSelectable('2026-08-05', { now, timeZone }), true);
  assert.equal(isDateSelectable('2026-08-08', { now, timeZone }), true);
  assert.deepEqual(getDeliverySlots('2026-08-05', { now, timeZone }).map((slot) => [slot.start, slot.end]), [
    ['08:00', '10:00'],
    ['10:00', '12:00'],
    ['12:00', '14:00'],
    ['14:00', '16:00'],
  ]);
  assert.deepEqual(getDeliverySlots('2026-08-08', { now, timeZone }).map((slot) => [slot.start, slot.end]), [
    ['08:00', '10:00'],
    ['10:00', '12:00'],
  ]);
});

test('delivery availability uses the end of each window for the 24-hour notice', () => {
  const now = new Date('2026-08-05T15:59:00Z');
  const slots = getDeliverySlots('2026-08-06', { now, timeZone });
  assert.deepEqual(slots.map((slot) => slot.available), [false, false, false, true]);
  assert.equal(slots[3].status, 'open');
  assert.equal(slots[0].capacity, 2);

  const atCutoff = getDeliverySlots('2026-08-06', {
    now: new Date('2026-08-05T16:00:00Z'),
    timeZone,
  });
  assert.equal(atCutoff[3].available, true, 'exactly 24 hours is allowed');

  const afterCutoff = getDeliverySlots('2026-08-06', {
    now: new Date('2026-08-05T16:01:00Z'),
    timeZone,
  });
  assert.equal(afterCutoff[3].available, false);
  assert.equal(afterCutoff[3].status, 'too-soon');
});

test('the picker can recover an initial weekday and valid selected slot', () => {
  const now = new Date('2026-08-08T12:00:00Z');
  assert.equal(getFirstSelectableDate({ now, timeZone }), '2026-08-09');
  assert.equal(normalizeDeliveryValue('2026-08-09T10:00', { now, timeZone }), '2026-08-09T10:00');
  assert.equal(normalizeDeliveryValue('2026-08-09T12:00', { now, timeZone }), '');
});

test('pickup uses all seven days and requires 24 hours before the 8 AM start', () => {
  const now = new Date('2026-08-07T10:00:00Z');
  const options = { now, timeZone, mode: 'pickup' };
  assert.equal(normalizeDeliveryDate('2026-08-08', options), '');
  assert.equal(normalizeDeliveryDate('2026-08-09', options), '2026-08-09');
  assert.equal(getFirstSelectableDate({ ...options, requireOpenSlot: false }), '2026-08-09');
});

test('a window stops being offered once its two spots are taken', () => {
  const now = new Date('2026-08-10T06:00:00Z');
  const bookedByStart = { '2026-08-11T08:00': 2, '2026-08-11T10:00': 1 };
  const [first, second] = getDeliverySlots('2026-08-11', { now, timeZone, bookedByStart });

  assert.deepEqual(
    { status: first.status, remaining: first.remaining, available: first.available },
    { status: 'full', remaining: 0, available: false },
  );
  assert.deepEqual(
    { status: second.status, remaining: second.remaining, available: second.available },
    { status: 'open', remaining: 1, available: true },
  );
  // A booking that cannot exist must not remove a spot that does.
  assert.equal(getDeliverySlots('2026-08-11', { now, timeZone, bookedByStart: { '2026-08-11T08:00': -3 } })[0].remaining, 2);
});

test('a fully booked day is skipped by the calendar and by the initial date', () => {
  const now = new Date('2026-08-10T06:00:00Z');
  const bookedByStart = Object.fromEntries(
    ['08:00', '10:00', '12:00', '14:00'].map((start) => [`2026-08-11T${start}`, 2]),
  );

  assert.equal(hasOpenDeliverySlots('2026-08-11', { now, timeZone, bookedByStart }), false);
  assert.equal(getFirstSelectableDate({ now, timeZone, bookedByStart }), '2026-08-12');
  // Capacity is a delivery constraint: a date-only choice such as pickup is
  // still offered on that day.
  assert.equal(hasRemainingWorkingTime('2026-08-11', { now, timeZone, bookedByStart }), true);
  assert.equal(getFirstSelectableDate({ now, timeZone, bookedByStart, requireOpenSlot: false }), '2026-08-10');
});

test('a pickup date keeps the day, drops the time and accepts weekends', () => {
  const now = new Date('2026-08-10T06:00:00Z');
  const options = { now, timeZone, mode: 'pickup' };
  assert.equal(normalizeDeliveryDate('2026-08-11T10:00', options), '2026-08-11');
  assert.equal(normalizeDeliveryDate('2026-08-11', options), '2026-08-11');
  assert.equal(normalizeDeliveryDate('2026-08-15', options), '2026-08-15', 'Saturday');
  assert.equal(normalizeDeliveryDate('2026-08-07', options), '', 'already past');
  // The working day start is less than 24 hours away, so today is not offered.
  assert.equal(normalizeDeliveryDate('2026-08-10', { ...options, now: new Date('2026-08-10T16:30:00Z') }), '');
});

test('a window range states the meridiem once when both ends share it', () => {
  assert.equal(formatTimeRange('08:00', '10:00'), '8:00 – 10:00 AM');
  assert.equal(formatTimeRange('10:00', '12:00'), '10:00 AM – 12:00 PM');
  assert.equal(formatTimeRange('14:00', '16:00'), '2:00 – 4:00 PM');
});
