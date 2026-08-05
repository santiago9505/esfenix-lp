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

test('delivery dates are weekdays only and slots cover 8 AM to 4 PM', () => {
  const now = new Date('2026-08-05T07:30:00Z');
  assert.equal(isDateSelectable('2026-08-05', { now, timeZone }), true);
  assert.equal(isDateSelectable('2026-08-08', { now, timeZone }), false);
  assert.deepEqual(getDeliverySlots('2026-08-05', { now, timeZone }).map((slot) => [slot.start, slot.end]), [
    ['08:00', '10:00'],
    ['10:00', '12:00'],
    ['12:00', '14:00'],
    ['14:00', '16:00'],
  ]);
});

test('a slot that already started today is unavailable while later slots remain selectable', () => {
  const now = new Date('2026-08-05T09:15:00Z');
  const slots = getDeliverySlots('2026-08-05', { now, timeZone });
  assert.equal(slots[0].available, false);
  assert.equal(slots[1].available, true);
  assert.equal(slots[0].capacity, 2);
});

test('the picker can recover an initial weekday and valid selected slot', () => {
  const now = new Date('2026-08-08T12:00:00Z');
  assert.equal(getFirstSelectableDate({ now, timeZone }), '2026-08-10');
  assert.equal(normalizeDeliveryValue('2026-08-10T10:00', { now, timeZone }), '2026-08-10T10:00');
  assert.equal(normalizeDeliveryValue('2026-08-10T09:00', { now, timeZone }), '');
});

test('a window stops being offered once its two spots are taken', () => {
  const now = new Date('2026-08-10T06:00:00Z');
  const bookedByStart = { '2026-08-10T08:00': 2, '2026-08-10T10:00': 1 };
  const [first, second] = getDeliverySlots('2026-08-10', { now, timeZone, bookedByStart });

  assert.deepEqual(
    { status: first.status, remaining: first.remaining, available: first.available },
    { status: 'full', remaining: 0, available: false },
  );
  assert.deepEqual(
    { status: second.status, remaining: second.remaining, available: second.available },
    { status: 'open', remaining: 1, available: true },
  );
  // A booking that cannot exist must not remove a spot that does.
  assert.equal(getDeliverySlots('2026-08-10', { now, timeZone, bookedByStart: { '2026-08-10T08:00': -3 } })[0].remaining, 2);
});

test('a fully booked day is skipped by the calendar and by the initial date', () => {
  const now = new Date('2026-08-10T06:00:00Z');
  const bookedByStart = Object.fromEntries(
    ['08:00', '10:00', '12:00', '14:00'].map((start) => [`2026-08-10T${start}`, 2]),
  );

  assert.equal(hasOpenDeliverySlots('2026-08-10', { now, timeZone, bookedByStart }), false);
  assert.equal(getFirstSelectableDate({ now, timeZone, bookedByStart }), '2026-08-11');
  // Capacity is a delivery constraint: a date-only choice such as pickup is
  // still offered on that day.
  assert.equal(hasRemainingWorkingTime('2026-08-10', { now, timeZone, bookedByStart }), true);
  assert.equal(getFirstSelectableDate({ now, timeZone, bookedByStart, requireOpenSlot: false }), '2026-08-10');
});

test('a date-only choice keeps the day and drops the time', () => {
  const now = new Date('2026-08-10T06:00:00Z');
  assert.equal(normalizeDeliveryDate('2026-08-11T10:00', { now, timeZone }), '2026-08-11');
  assert.equal(normalizeDeliveryDate('2026-08-11', { now, timeZone }), '2026-08-11');
  assert.equal(normalizeDeliveryDate('2026-08-15', { now, timeZone }), '', 'Saturday');
  assert.equal(normalizeDeliveryDate('2026-08-07', { now, timeZone }), '', 'already past');
  // The working day is over, so today is no longer offered.
  assert.equal(normalizeDeliveryDate('2026-08-10', { now: new Date('2026-08-10T16:30:00Z'), timeZone }), '');
});

test('a window range states the meridiem once when both ends share it', () => {
  assert.equal(formatTimeRange('08:00', '10:00'), '8:00 – 10:00 AM');
  assert.equal(formatTimeRange('10:00', '12:00'), '10:00 AM – 12:00 PM');
  assert.equal(formatTimeRange('14:00', '16:00'), '2:00 – 4:00 PM');
});

