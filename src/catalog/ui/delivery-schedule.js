import {
  DELIVERY_SCHEDULE,
  formatTime,
  formatTimeRange,
  getDeliverySlots,
  getDateKeyInTimeZone,
  getFirstSelectableDate,
  hasOpenDeliverySlots,
  isDateSelectable,
  isPickupDateSelectable,
  normalizeDeliveryDate,
  normalizeDeliveryValue,
} from '../core/delivery-schedule.js';
import { formatTimeZoneOffset } from '../core/timezone.js';
import { el, replaceChildren } from './dom.js';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// The quote flow is English. Do not let the browser's regional language turn
// the selected date into Spanish (or another language) in an English form.
const FORM_LOCALE = 'en-US';

/**
 * A date — and, for delivery, two-hour window — picker for the quote form.
 *
 * Two modes:
 *
 *   window  Delivery. The visitor answers two questions in order, which day
 *           and which window, so both halves are numbered and the second one
 *           always names the day it belongs to. The value is `<date>T<start>`.
 *   date    Pickup. Nothing is being reserved against capacity, so asking for
 *           a window would be asking for something we do not hold. Only the
 *           calendar is shown and the value is the date alone.
 *
 * In both modes a day the schedule cannot serve is never selectable: weekends,
 * past days and — for delivery — days whose windows are all taken are disabled
 * in the grid rather than failing after the click.
 *
 * It owns only its visual state; the quote form remains the source of truth
 * for the selected value and persists it in the existing draft flow.
 *
 * @param {{
 *   value?: string,
 *   timeZone: string,
 *   mode?: 'window'|'date',
 *   bookedByStart?: Record<string, number>,
 *   isDateAllowed?: (dateKey: string) => boolean,
 *   availabilityProvider?: ((dateKey: string) => Promise<Array<{ start: string, booked?: number }> )|null,
 *   onChange?: (selection: { dateTime: string, slot?: object, timeZone: string }) => void,
 * }} options
 */
export function deliverySchedulePicker({ value = '', timeZone, mode = 'window', bookedByStart, isDateAllowed = () => true, availabilityProvider = null, onChange }) {
  const now = new Date();
  const locale = FORM_LOCALE;
  const picksWindow = mode !== 'date';
  let remoteBookedByStart = bookedByStart ?? {};
  let availabilityState = picksWindow && availabilityProvider ? 'loading' : 'disabled';
  const tracksCapacity = Boolean(availabilityProvider || bookedByStart);
  const availabilityCache = new Map();
  let availabilityRequest = 0;
  const currentDate = getDateKeyInTimeZone(now, timeZone);
  const firstDate = getFirstSelectableDate(scheduleOptions());
  let selectedValue = picksWindow
    ? normalizeDeliveryValue(value, scheduleOptions())
    : normalizeDeliveryDate(value, scheduleOptions());
  let selectedDate = selectedValue ? selectedValue.slice(0, 10) : firstDate;
  let visibleMonth = selectedDate.slice(0, 7);
  const host = el('div', { class: `cat-quote-schedule ${picksWindow ? '' : 'is-date-only'}` });

  render();
  if (picksWindow && availabilityProvider) void loadAvailability(selectedDate);
  return host;

  function scheduleOptions() {
    return {
      now,
      timeZone,
      bookedByStart: remoteBookedByStart,
      isDateAllowed,
      mode: picksWindow ? 'delivery' : 'pickup',
      requireOpenSlot: picksWindow,
    };
  }

  function render() {
    const slots = picksWindow ? getDeliverySlots(selectedDate, scheduleOptions()) : [];
    replaceChildren(host, [
      el('div', { class: 'cat-quote-schedule-main' }, [
        calendar(),
        picksWindow ? slotPicker(slots) : null,
      ]),
      footer(slots),
    ]);
  }

  function calendar() {
    const options = scheduleOptions();
    const monthStart = parseDateKey(`${visibleMonth}-01`);
    const monthLabel = new Intl.DateTimeFormat(locale, {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(monthStart);
    const monthKey = visibleMonth;
    const minMonth = currentDate.slice(0, 7);
    const maxMonth = monthKeyAfter(minMonth, 12);
    const isDayUsable = picksWindow ? hasOpenDeliverySlots : isPickupDateSelectable;
    const isDateSelectableForMode = picksWindow ? isDateSelectable : isPickupDateSelectable;
    const days = [];
    const startOffset = monthStart.getUTCDay();
    for (let index = 0; index < 42; index += 1) {
      const day = new Date(monthStart.getTime());
      day.setUTCDate(day.getUTCDate() - startOffset + index);
      const dateKey = day.toISOString().slice(0, 10);
      const inMonth = dateKey.slice(0, 7) === monthKey;
      const selectable = inMonth
        && isDateSelectableForMode(dateKey, options)
        && isDayUsable(dateKey, options);
      const classes = ['cat-quote-calendar-day'];
      if (!inMonth) classes.push('is-outside-month');
      if (!selectable) classes.push('is-unavailable');
      if (inMonth && dateKey === currentDate) classes.push('is-today');
      if (selectedDate === dateKey) classes.push('is-selected');
      days.push(el('button', {
        type: 'button',
        class: classes.join(' '),
        text: String(Number(dateKey.slice(-2))),
        disabled: !selectable,
        'aria-label': formatDate(dateKey, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
        'aria-pressed': selectedDate === dateKey,
        onClick: () => selectDate(dateKey),
      }));
    }

    return el('section', {
      class: 'cat-quote-schedule-calendar',
      'aria-label': picksWindow ? 'Choose a delivery date' : 'Choose a pickup date',
    }, [
      picksWindow ? step('1', 'Pick a day') : null,
      el('div', { class: 'cat-quote-calendar-head' }, [
        el('strong', { text: capitalize(monthLabel) }),
        el('div', { class: 'cat-quote-calendar-nav' }, [
          el('button', {
            type: 'button',
            class: 'cat-quote-calendar-nav-button',
            text: '‹',
            'aria-label': 'Previous month',
            disabled: monthKey <= minMonth,
            onClick: () => {
              visibleMonth = monthKeyAfter(visibleMonth, -1);
              render();
            },
          }),
          el('button', {
            type: 'button',
            class: 'cat-quote-calendar-nav-button',
            text: '›',
            'aria-label': 'Next month',
            disabled: monthKey >= maxMonth,
            onClick: () => {
              visibleMonth = monthKeyAfter(visibleMonth, 1);
              render();
            },
          }),
        ]),
      ]),
      el('div', { class: 'cat-quote-calendar-weekdays', 'aria-hidden': 'true' }, DAY_NAMES.map((day, index) => el('span', {
        class: DELIVERY_SCHEDULE.workingDays.includes(index) ? '' : 'is-off',
        text: day,
      }))),
      el('div', { class: 'cat-quote-calendar-grid' }, days),
      el('p', {
        class: 'cat-quote-calendar-hint',
        text: picksWindow
          ? `Mon–Fri · ${formatTime(scheduleTime(DELIVERY_SCHEDULE.startMinutes), locale)}–${formatTime(scheduleTime(DELIVERY_SCHEDULE.endMinutes), locale)}; Sat–Sun · ${formatTime(scheduleTime(DELIVERY_SCHEDULE.startMinutes), locale)}–${formatTime(scheduleTime(DELIVERY_SCHEDULE.startMinutes + 2 * DELIVERY_SCHEDULE.slotMinutes), locale)}.`
          : 'Monday–Sunday · at least 24 hours ahead.',
      }),
    ]);
  }

  function slotPicker(slots) {
    const selectedDateLabel = formatDate(selectedDate, { weekday: 'long', month: 'short', day: 'numeric' });
    const waitingForAvailability = Boolean(availabilityProvider) && availabilityState !== 'ready';
    const visibleSlots = waitingForAvailability
      ? []
      : slots.filter((slot) => slot.status !== 'past' && slot.status !== 'too-soon' && slot.status !== 'closed');
    const openSlots = waitingForAvailability ? [] : slots.filter((slot) => slot.available);
    const selectedSlot = slots.find((slot) => slot.value === selectedValue);
    return el('section', {
      class: 'cat-quote-schedule-slots',
      'aria-label': 'Choose a delivery time',
    }, [
      step('2', 'Pick a 2-hour window'),
      el('div', { class: 'cat-quote-slots-head' }, [
        el('strong', { text: capitalize(selectedDateLabel) }),
        el('span', {
          class: 'cat-quote-slots-kicker',
          text: waitingForAvailability
            ? availabilityState === 'error' ? 'Delivery availability unavailable' : 'Checking delivery availability...'
            : selectedSlot
            ? 'Delivery window selected'
            : openSlots.length
              ? tracksCapacity
                ? `${openSlots.length} of ${visibleSlots.length} windows open`
                : `${openSlots.length} windows available to request`
              : visibleSlots.length
                ? 'No eligible windows left'
                : 'Choose another day',
        }),
      ]),
      waitingForAvailability
        ? el('p', {
            class: 'cat-quote-slot-empty',
            role: 'status',
            text: availabilityState === 'error'
              ? 'Delivery availability could not be loaded. Try again or choose another day.'
              : 'Checking delivery availability before showing windows...',
          })
        : !visibleSlots.length
          ? el('p', {
              class: 'cat-quote-slot-empty',
              role: 'status',
              text: 'No delivery window meets the 24-hour notice on this day. Choose another day.',
            })
          : null,
      el('div', { class: 'cat-quote-slot-list' }, visibleSlots.map((slot) => {
        const selected = selectedValue === slot.value;
        return el('button', {
          type: 'button',
          class: `cat-quote-slot ${selected ? 'is-selected' : ''}`,
          disabled: !slot.available,
          'aria-pressed': selected,
          onClick: () => selectSlot(slot),
        }, [
          el('span', { class: 'cat-quote-slot-time', text: formatTimeRange(slot.start, slot.end, locale) }),
          el('span', { class: `cat-quote-slot-capacity is-${slot.status}`, text: describeSlot(slot) }),
        ]);
      })),
      waitingForAvailability || openSlots.length || !visibleSlots.length
        ? null
        : el('p', { class: 'cat-quote-slot-empty', text: 'Every eligible window on this day is taken. Choose another day in the calendar.' }),
    ]);
  }

  function footer(slots) {
    const selected = picksWindow ? slots.find((slot) => slot.value === selectedValue) : null;
    const chosenDate = picksWindow ? selected?.date : selectedValue;
    return el('div', { class: 'cat-quote-schedule-footer' }, [
      el('p', {
        class: `cat-quote-schedule-summary ${chosenDate ? 'is-set' : ''}`,
        role: 'status',
        'aria-live': 'polite',
      }, [
        el('span', {
          class: `cat-quote-schedule-summary-mark ${chosenDate ? '' : 'is-empty'}`,
          'aria-hidden': 'true',
          text: chosenDate ? '✓' : '◷',
        }),
        el('span', {}, chosenDate
          ? [
              el('strong', { text: capitalize(formatDate(chosenDate, { weekday: 'long', month: 'long', day: 'numeric' })) }),
              el('small', {
                text: selected
                  ? formatTimeRange(selected.start, selected.end, locale)
                  : 'We’ll agree the exact time with you.',
              }),
            ]
          : [
              el('strong', { text: picksWindow ? 'No window selected yet' : 'No day selected yet' }),
              el('small', {
                text: picksWindow
                  ? 'Choose a delivery window before continuing.'
                  : 'Pick a day at least 24 hours ahead.',
              }),
            ]),
      ]),
      picksWindow
        ? el('p', { class: 'cat-quote-timezone', role: 'note' }, [
            el('small', { text: `Your time · ${timeZone} (${formatTimeZoneOffset(timeZone)})` }),
          ])
        : null,
    ]);
  }

  /** @param {string} mark @param {string} label */
  function step(mark, label) {
    return el('p', { class: 'cat-quote-schedule-step' }, [
      el('span', { class: 'cat-quote-schedule-step-mark', text: mark }),
      el('span', { text: label }),
    ]);
  }

  /** @param {{ status: string, remaining: number }} slot */
  function describeSlot(slot) {
    if (!tracksCapacity && slot.status === 'open') return 'Available to request';
    if (slot.status === 'past') return 'Passed';
    if (slot.status === 'full') return 'Full';
    if (slot.status === 'closed') return 'Closed';
    return slot.remaining === 1 ? '1 spot left' : `${slot.remaining} spots left`;
  }

  async function loadAvailability(dateKey) {
    if (!availabilityProvider || !picksWindow) return;
    const cached = availabilityCache.get(dateKey);
    if (cached) {
      remoteBookedByStart = cached;
      availabilityState = 'ready';
      render();
      return;
    }

    const requestId = ++availabilityRequest;
    availabilityState = 'loading';
    remoteBookedByStart = {};
    render();
    try {
      const slots = await availabilityProvider(dateKey);
      if (!Array.isArray(slots)) throw new Error('Availability returned an unexpected response.');
      const counts = Object.fromEntries(slots
        .filter((slot) => slot && typeof slot.start === 'string')
        .map((slot) => [`${dateKey}T${slot.start}`, Number(slot.booked) || 0]));
      availabilityCache.set(dateKey, counts);
      if (requestId !== availabilityRequest || selectedDate !== dateKey) return;
      remoteBookedByStart = counts;
      availabilityState = 'ready';
      render();
    } catch {
      if (requestId !== availabilityRequest || selectedDate !== dateKey) return;
      remoteBookedByStart = {};
      availabilityState = 'error';
      render();
    }
  }

  function selectDate(dateKey) {
    if (!isDateAllowed(dateKey)) return;
    selectedDate = dateKey;
    if (picksWindow) {
      // Changing day drops a window that belonged to the previous one.
      if (!selectedValue.startsWith(`${dateKey}T`)) selectedValue = '';
      if (availabilityProvider) {
        availabilityState = 'loading';
        remoteBookedByStart = {};
      }
      render();
      if (availabilityProvider) void loadAvailability(dateKey);
      return;
    }
    selectedValue = dateKey;
    onChange?.({ dateTime: dateKey, timeZone });
    render();
  }

  function selectSlot(slot) {
    if (!slot.available) return;
    selectedValue = slot.value;
    onChange?.({
      dateTime: slot.value,
      slot: {
        date: slot.date,
        start: slot.start,
        end: slot.end,
        capacity: slot.capacity,
      },
      timeZone,
    });
    render();
  }

  /** @param {string} dateKey @param {Intl.DateTimeFormatOptions} options */
  function formatDate(dateKey, options) {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(parseDateKey(dateKey));
  }
}

/** @param {number} minutes */
function scheduleTime(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** @param {string} dateKey */
function parseDateKey(dateKey) {
  return new Date(`${dateKey}T12:00:00Z`);
}

/** @param {string} monthKey @param {number} amount */
function monthKeyAfter(monthKey, amount) {
  const date = parseDateKey(`${monthKey}-01`);
  date.setUTCMonth(date.getUTCMonth() + amount);
  return date.toISOString().slice(0, 7);
}

/** @param {string} value */
function capitalize(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}
