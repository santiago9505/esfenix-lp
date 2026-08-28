/**
 * Seasonal demand rules used by the quote flow.
 *
 * Rules are month/day ranges because the high-demand windows repeat every
 * year. The selected delivery or pickup date is the date that determines the
 * season; the time portion, when present, is intentionally ignored.
 */

export const SEASON_TYPES = Object.freeze({
  HIGH: 'HIGH',
  LOW: 'LOW',
});

/**
 * These windows mirror the current FORMS PARAMS configuration. Keep the
 * customer-facing copy here so the form, payload and Fresa notes agree.
 */
export const SEASON_RULES = Object.freeze([
  Object.freeze({
    id: 'valentines-day',
    label: "Valentine's Day",
    startMonthDay: '02-08',
    dueMonthDay: '02-14',
    customerMessage: "Due to high demand during Valentine's Day, availability may vary.",
  }),
  Object.freeze({
    id: 'mothers-day',
    label: "Mother's Day",
    startMonthDay: '05-03',
    dueMonthDay: '05-09',
    customerMessage: "Due to high demand during Mother's Day, availability may vary.",
  }),
]);

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_DAY_PATTERN = /^\d{2}-\d{2}$/;

/**
 * Resolves the season for a date-only or date-time value.
 *
 * Invalid and empty values safely resolve to LOW so an incomplete draft never
 * blocks the quote flow. `rules` is injectable to keep future changes local
 * and straightforward to test.
 *
 * @param {unknown} value
 * @param {{ rules?: Array<{ id: string, label: string, startMonthDay: string, dueMonthDay: string, customerMessage?: string }> }} [options]
 * @returns {{ type: 'HIGH'|'LOW', ruleId: string|null, label: string|null, startDate: string|null, dueDate: string|null, customerMessage: string|null }}
 */
export function resolveSeason(value, { rules = SEASON_RULES } = {}) {
  const dateKey = extractDateKey(value);
  if (!dateKey) return lowSeason();

  const year = dateKey.slice(0, 4);
  const rule = rules.find((candidate) => {
    if (!isValidMonthDay(candidate?.startMonthDay) || !isValidMonthDay(candidate?.dueMonthDay)) return false;
    const startDate = `${year}-${candidate.startMonthDay}`;
    const dueDate = `${year}-${candidate.dueMonthDay}`;
    return startDate <= dateKey && dateKey <= dueDate;
  });

  if (!rule) return lowSeason();

  return {
    type: SEASON_TYPES.HIGH,
    ruleId: String(rule.id),
    label: String(rule.label),
    startDate: `${year}-${rule.startMonthDay}`,
    dueDate: `${year}-${rule.dueMonthDay}`,
    customerMessage: String(rule.customerMessage ?? '').trim() || null,
  };
}

/** @param {unknown} value */
export function getSeasonType(value) {
  return resolveSeason(value).type;
}

/** @param {unknown} value */
function extractDateKey(value) {
  const dateKey = String(value ?? '').trim().slice(0, 10);
  if (!DATE_KEY_PATTERN.test(dateKey)) return '';

  const date = new Date(`${dateKey}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === dateKey
    ? dateKey
    : '';
}

/** @param {unknown} value */
function isValidMonthDay(value) {
  if (!MONTH_DAY_PATTERN.test(String(value ?? ''))) return false;
  const monthDay = String(value);
  const date = new Date(`2024-${monthDay}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(5, 10) === monthDay;
}

function lowSeason() {
  return {
    type: SEASON_TYPES.LOW,
    ruleId: null,
    label: null,
    startDate: null,
    dueDate: null,
    customerMessage: null,
  };
}
