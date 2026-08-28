/**
 * Delivery availability rules shared by the quote form and any future
 * availability adapter.
 *
 * Dates and times in the form are deliberately represented as wall-clock
 * values in the customer's timezone. They must not be parsed with the
 * browser's local timezone before the receiving system has the timezone.
 */

export const DELIVERY_SCHEDULE = Object.freeze({
  startMinutes: 8 * 60,
  endMinutes: 16 * 60,
  slotMinutes: 2 * 60,
  capacity: 2,
  weekdays: Object.freeze([1, 2, 3, 4, 5]),
  weekendDays: Object.freeze([0, 6]),
  workingDays: Object.freeze([0, 1, 2, 3, 4, 5, 6]),
  minimumNoticeMs: 24 * 60 * 60 * 1000,
});

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

/** @param {string} dateKey */
export function isDeliveryDate(dateKey) {
  if (!DATE_KEY_PATTERN.test(dateKey)) return false;
  const date = new Date(`${dateKey}T12:00:00Z`);
  return !Number.isNaN(date.getTime())
    && date.toISOString().slice(0, 10) === dateKey
    && DELIVERY_SCHEDULE.workingDays.includes(date.getUTCDay());
}

/**
 * Pickup is date-only in the current form, so its notice is measured against
 * the beginning of the pickup day (08:00 in the customer's timezone). This
 * keeps a date from being offered when its earliest possible pickup would be
 * less than 24 hours away.
 *
 * @param {string} dateKey
 * @param {{ now?: Date, timeZone: string, isDateAllowed?: (dateKey: string) => boolean }} options
 */
export function isPickupDateSelectable(dateKey, { now = new Date(), timeZone, isDateAllowed } = {}) {
  if (!isDeliveryDate(dateKey)) return false;
  if (isDateAllowed && isDateAllowed(dateKey) === false) return false;
  const pickupStart = wallClockToDate(
    dateKey,
    minutesToTime(DELIVERY_SCHEDULE.startMinutes),
    timeZone,
  );
  return pickupStart.getTime() - now.getTime() >= DELIVERY_SCHEDULE.minimumNoticeMs;
}

/** @param {string} time */
export function timeToMinutes(time) {
  const match = TIME_PATTERN.exec(String(time ?? ''));
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * @param {string} dateKey
 * @param {{ now?: Date, timeZone: string, isDateAllowed?: (dateKey: string) => boolean }} options
 */
export function isDateSelectable(dateKey, { now = new Date(), timeZone, isDateAllowed } = {}) {
  if (!isDeliveryDate(dateKey)) return false;
  if (isDateAllowed && isDateAllowed(dateKey) === false) return false;
  return dateKey >= getDateKeyInTimeZone(now, timeZone);
}

/**
 * Creates the two-hour delivery windows for the selected day.
 *
 * `bookedByStart` is the seam for a live availability source: a map of slot
 * value (`2026-08-13T10:00`) to how many requests already hold that window.
 * Without it every window is offered at full capacity, which is what the
 * static catalog does today.
 *
 * Every slot carries a `status` so the UI never has to re-derive why a window
 * cannot be chosen:
 *
 *   open    selectable
 *   past    the window already started (or is starting now) today
 *   too-soon the window ends less than 24 hours from now
 *   full    capacity is taken
 *   closed  the whole day is outside the delivery calendar
 *
 * @param {string} dateKey
 * @param {{ now?: Date, timeZone: string, bookedByStart?: Record<string, number>, isDateAllowed?: (dateKey: string) => boolean }} options
 */
export function getDeliverySlots(dateKey, { now = new Date(), timeZone, bookedByStart, isDateAllowed } = {}) {
  const today = getDateKeyInTimeZone(now, timeZone);
  const nowMinutes = getMinutesInTimeZone(now, timeZone);
  const selectableDate = isDateSelectable(dateKey, { now, timeZone, isDateAllowed });

  const slots = [];
  for (const start of slotStartsForDate(dateKey)) {
    const end = start + DELIVERY_SCHEDULE.slotMinutes;
    const startTime = minutesToTime(start);
    const endTime = minutesToTime(end);
    const value = `${dateKey}T${startTime}`;
    const booked = readBookedCount(bookedByStart, value);
    const remaining = Math.max(0, DELIVERY_SCHEDULE.capacity - booked);
    const passed = dateKey === today && start <= nowMinutes;
    const hasMinimumNotice = hasMinimumNoticeForSlot(dateKey, endTime, now, timeZone);
    const status = !selectableDate ? 'closed'
      : passed ? 'past'
      : !hasMinimumNotice ? 'too-soon'
      : remaining === 0 ? 'full'
      : 'open';
    slots.push({
      id: value,
      date: dateKey,
      start: startTime,
      end: endTime,
      value,
      capacity: DELIVERY_SCHEDULE.capacity,
      booked,
      remaining,
      status,
      available: status === 'open',
    });
  }
  return slots;
}

/** @param {Record<string, number>|undefined} bookedByStart @param {string} value */
function readBookedCount(bookedByStart, value) {
  const raw = bookedByStart?.[value];
  const count = Number(raw);
  return Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0;
}

/** @param {Date} date @param {string} timeZone */
export function getDateKeyInTimeZone(date, timeZone) {
  const parts = formatParts(date, timeZone, ['year', 'month', 'day']);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** @param {Date} date @param {string} timeZone */
export function getMinutesInTimeZone(date, timeZone) {
  const parts = formatParts(date, timeZone, ['hour', 'minute']);
  return Number(parts.hour) * 60 + Number(parts.minute);
}

/**
 * True when the day still has at least one window someone can book.
 * @param {string} dateKey
 * @param {{ now?: Date, timeZone: string, bookedByStart?: Record<string, number> }} options
 */
export function hasOpenDeliverySlots(dateKey, options) {
  return getDeliverySlots(dateKey, options).some((slot) => slot.available);
}

/**
 * True when the working day has not ended yet — the test for a date-only
 * choice such as pickup, where capacity is not what is being reserved.
 *
 * @param {string} dateKey
 * @param {{ now?: Date, timeZone: string }} options
 */
export function hasRemainingWorkingTime(dateKey, options) {
  return getDeliverySlots(dateKey, options).some((slot) => slot.status !== 'past' && slot.status !== 'closed');
}

/**
 * The date part of a value, kept only when that day can still be served.
 * @param {string} value @param {{ now?: Date, timeZone: string }} options
 */
export function normalizeDeliveryDate(value, options) {
  const dateKey = String(value ?? '').split('T')[0];
  const selectable = options?.mode === 'pickup'
    ? isPickupDateSelectable(dateKey, options)
    : isDateSelectable(dateKey, options);
  if (!selectable || !hasRemainingWorkingTime(dateKey, options)) return '';
  return dateKey;
}

/**
 * Picks the first usable date in the delivery or pickup calendar.
 * @param {{ now?: Date, timeZone: string, bookedByStart?: Record<string, number>, requireOpenSlot?: boolean, mode?: 'delivery'|'pickup' }} options
 */
export function getFirstSelectableDate(options) {
  const { now = new Date(), timeZone, requireOpenSlot = true, mode = 'delivery' } = options;
  const isUsable = requireOpenSlot ? hasOpenDeliverySlots : hasRemainingWorkingTime;
  const isDateUsable = mode === 'pickup' ? isPickupDateSelectable : isDateSelectable;
  const candidate = new Date(now.getTime());
  for (let offset = 0; offset <= 370; offset += 1) {
    if (offset > 0) candidate.setUTCDate(candidate.getUTCDate() + 1);
    const dateKey = getDateKeyInTimeZone(candidate, timeZone);
    if (isDateUsable(dateKey, options) && isUsable(dateKey, options)) {
      return dateKey;
    }
  }
  return getDateKeyInTimeZone(now, timeZone);
}

/** @param {string} value @param {{ now?: Date, timeZone: string, bookedByStart?: Record<string, number> }} options */
export function normalizeDeliveryValue(value, options) {
  const [dateKey, time = ''] = String(value ?? '').split('T');
  if (!isDateSelectable(dateKey, options)) return '';
  const slot = getDeliverySlots(dateKey, options).find((candidate) => candidate.start === time && candidate.available);
  return slot?.value ?? '';
}

/** @param {number} minutes */
export function minutesToTime(minutes) {
  const hours = Math.floor(minutes / 60).toString().padStart(2, '0');
  const remainder = String(minutes % 60).padStart(2, '0');
  return `${hours}:${remainder}`;
}

/** @param {string} time */
export function formatTime(time, locale = 'en-US') {
  const minutes = timeToMinutes(time);
  if (minutes === null) return time;
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(Date.UTC(2020, 0, 1, Math.floor(minutes / 60), minutes % 60)));
}

/**
 * "8:00 – 10:00 AM" rather than "8:00 AM – 10:00 AM": in a list of windows the
 * repeated meridiem is noise, so it is only kept when the two ends differ.
 *
 * @param {string} start @param {string} end
 */
export function formatTimeRange(start, end, locale = 'en-US') {
  const from = formatTime(start, locale);
  const to = formatTime(end, locale);
  const fromMeridiem = from.match(/[^\d\s:.,]+\s*$/)?.[0]?.trim();
  const toMeridiem = to.match(/[^\d\s:.,]+\s*$/)?.[0]?.trim();
  const shortFrom = fromMeridiem && fromMeridiem === toMeridiem
    ? from.slice(0, from.length - fromMeridiem.length).trim()
    : from;
  return `${shortFrom} – ${to}`;
}

/** @param {string} dateKey */
function slotStartsForDate(dateKey) {
  const day = new Date(`${dateKey}T12:00:00Z`).getUTCDay();
  const lastStart = DELIVERY_SCHEDULE.weekendDays.includes(day)
    ? DELIVERY_SCHEDULE.startMinutes + DELIVERY_SCHEDULE.slotMinutes
    : DELIVERY_SCHEDULE.endMinutes - DELIVERY_SCHEDULE.slotMinutes;
  const starts = [];
  for (let start = DELIVERY_SCHEDULE.startMinutes; start <= lastStart; start += DELIVERY_SCHEDULE.slotMinutes) {
    starts.push(start);
  }
  return starts;
}

/** @param {string} dateKey @param {string} endTime @param {Date} now @param {string} timeZone */
function hasMinimumNoticeForSlot(dateKey, endTime, now, timeZone) {
  const slotEnd = wallClockToDate(dateKey, endTime, timeZone);
  return slotEnd.getTime() - now.getTime() >= DELIVERY_SCHEDULE.minimumNoticeMs;
}

/**
 * Converts a wall-clock date/time in a named timezone to an instant without
 * depending on the browser's local timezone. The schedule values are all
 * regular daytime hours, so this also avoids DST transition edge cases for
 * the configured windows.
 *
 * @param {string} dateKey @param {string} time @param {string} timeZone
 */
function wallClockToDate(dateKey, time, timeZone) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  const targetUtc = Date.UTC(year, month - 1, day, hours, minutes);
  const target = new Date(targetUtc);
  const parts = formatParts(target, timeZone, ['year', 'month', 'day', 'hour', 'minute']);
  const formattedUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
  );
  return new Date(targetUtc + (targetUtc - formattedUtc));
}

/** @param {Date} date @param {string} timeZone @param {string[]} keys */
function formatParts(date, timeZone, keys) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || 'UTC',
    ...Object.fromEntries(keys.map((key) => [key, key === 'hour' ? '2-digit' : 'numeric'])),
    hourCycle: 'h23',
  });
  return Object.fromEntries(formatter.formatToParts(date)
    .filter(({ type }) => keys.includes(type))
    .map(({ type, value }) => [type, value.padStart(2, '0')]));
}
