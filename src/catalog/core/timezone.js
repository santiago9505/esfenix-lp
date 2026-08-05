/** Customer timezone detection used by the whole catalog application. */

import { read, write } from './storage.js';

const TIME_ZONE_KEY = 'client-timezone';
const FALLBACK_TIME_ZONE = 'UTC';

/**
 * Uses the browser's IANA timezone identifier. It is more useful than a
 * numeric offset because it keeps daylight-saving rules intact.
 */
export function detectClientTimeZone() {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof timeZone === 'string' && timeZone ? timeZone : FALLBACK_TIME_ZONE;
  } catch {
    return FALLBACK_TIME_ZONE;
  }
}

/**
 * Reads the current browser timezone and mirrors it into the app's resilient
 * storage. The detected value always wins so a traveler changing networks or
 * device settings does not keep seeing an old timezone.
 */
export function getClientTimeZone() {
  const detected = detectClientTimeZone();
  if (read(TIME_ZONE_KEY, '') !== detected) write(TIME_ZONE_KEY, detected);
  return detected;
}

/** @param {string} timeZone @param {Date} [date] */
export function formatTimeZoneOffset(timeZone, date = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'shortOffset',
    }).formatToParts(date).find(({ type }) => type === 'timeZoneName')?.value ?? 'UTC';
  } catch {
    return 'UTC';
  }
}

