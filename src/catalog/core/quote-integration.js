/**
 * quoteIntegrationService — the seam between the catalog and the quote form.
 *
 * The catalog never drives the Fresa form by poking at its DOM: that breaks the
 * moment the form changes. It hands over a payload to a configured integration.
 *
 * Two adapters, chosen automatically:
 *
 *   session  Used when QUOTE_SESSION_ENDPOINT is configured. POSTs the payload,
 *            receives a short-lived id and a redirect URL, opens that. Email,
 *            address and the product list travel in the request body — never in
 *            a query string.
 *
 *   form-api The default. Reads the live public-form schema, converts product
 *            labels to Fresa task ids, and submits the completed response.
 *
 * Failure never costs the visitor their selection: the caller keeps the quote
 * list and can retry.
 */

import { QUOTE_FORM_URL, QUOTE_SESSION_ENDPOINT } from '../data/quote-config.js';
import { assertNoPricing, buildQuoteSummaryText } from './quote-payload.js';
import {
  buildFresaFormSubmission,
  FresaFormConfigurationError,
  resolveFresaFormApi,
} from './fresa-form-submission.js';

/**
 * @typedef {{ ok: true, mode: 'session'|'form-api', url?: string, summary: string, sessionId?: string, taskId?: string, listId?: string }} QuoteSuccess
 * @typedef {{ ok: false, mode: 'session'|'form-api', error: string, summary: string, code?: string }} QuoteFailure
 */

// The public form hydrates live catalog relationships before validating and
// creating subtasks. Local and cold production requests can legitimately take
// more than ten seconds, so keep the user-facing request alive long enough for
// Fresa to return the created task id.
const REQUEST_TIMEOUT_MS = 45000;

/**
 * @param {{
 *   formUrl?: string,
 *   sessionEndpoint?: string|null,
 *   fetchImpl?: typeof fetch,
 *   openImpl?: (url: string) => (Window|null),
 *   timeoutMs?: number,
 *   reserveDeliverySlotImpl?: (slot: object) => Promise<object>,
 * }} [options]
 */
export function createQuoteIntegration(options = {}) {
  const formUrl = options.formUrl ?? QUOTE_FORM_URL;
  const sessionEndpoint =
    options.sessionEndpoint === undefined ? QUOTE_SESSION_ENDPOINT : options.sessionEndpoint;
  const reserveDeliverySlotImpl = options.reserveDeliverySlotImpl;
  const doFetch = options.fetchImpl ?? ((...args) => globalThis.fetch(...args));
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const openUrl =
    options.openImpl ?? ((url) => window.open(url, '_blank', 'noopener,noreferrer'));

  /**
   * Only a URL on the form's own origin is ever opened, so a compromised or
   * misconfigured endpoint cannot turn this into an open redirect.
   * @param {string} candidate
   */
  function isSafeRedirect(candidate) {
    try {
      const target = new URL(candidate, formUrl);
      const expected = new URL(formUrl);
      return target.protocol === 'https:' && target.host === expected.host;
    } catch {
      return false;
    }
  }

  return {
    /** Which adapter a call to `start` would use. */
    mode() {
      return sessionEndpoint ? 'session' : 'form-api';
    },

    /**
     * Submits the quote payload to Fresa.
     *
     * @param {ReturnType<typeof import('./quote-payload').buildQuotePayload>} payload
     * @param {{ targetWindow?: Window|null }} [openOptions]
     * @returns {Promise<QuoteSuccess|QuoteFailure>}
     */
    async start(payload, openOptions = {}) {
      assertNoPricing(payload);
      const summary = buildQuoteSummaryText(payload);

      /** @param {string} url */
      function openQuoteUrl(url) {
        const target = openOptions.targetWindow;
        if (target && !target.closed) {
          try {
            target.location.href = url;
            return target;
          } catch {
            // Fall back to the regular opener if the reserved tab is unusable.
          }
        }
        return openUrl(url);
      }

      if (!sessionEndpoint) {
        // The API flow does not navigate away or need a reserved browser tab.
        openOptions.targetWindow?.close?.();
        return submitToFresaForm({
          formUrl,
          payload,
          doFetch,
          timeoutMs,
          reserveSlot: reserveDeliverySlotImpl,
          summary,
        });
      }

      if (payload.orderType === 'Delivery') {
        if (!payload.deliverySlot) {
          return {
            ok: false,
            mode: 'session',
            code: 'DELIVERY_SLOT_MISSING',
            error: 'Please choose an available delivery window before sending your request.',
            summary,
          };
        }
        const capacityResult = await reserveDeliveryCapacity({
          payload,
          reserveSlot: reserveDeliverySlotImpl,
        });
        if (!capacityResult.ok) {
          return {
            ok: false,
            mode: 'session',
            code: capacityResult.code,
            error: capacityResult.error,
            summary,
          };
        }
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await doFetch(sessionEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (!response.ok) {
          return {
            ok: false,
            mode: 'session',
            error: `The quote service responded with ${response.status}.`,
            summary,
          };
        }

        const data = await response.json();
        const redirect = data?.redirectUrl;
        if (typeof redirect !== 'string' || !isSafeRedirect(redirect)) {
          return {
            ok: false,
            mode: 'session',
            error: 'The quote service returned an unexpected address.',
            summary,
          };
        }

        const opened = openQuoteUrl(redirect);
        if (!opened) {
          return {
            ok: false,
            mode: 'session',
            error: 'The quote form could not be opened. Your browser may have blocked the new tab.',
            summary,
          };
        }
        return {
          ok: true,
          mode: 'session',
          url: redirect,
          summary,
          sessionId: data?.quoteSessionId,
        };
      } catch (error) {
        const aborted = error?.name === 'AbortError';
        return {
          ok: false,
          mode: 'session',
          error: aborted
            ? 'The quote service took too long to respond.'
            : 'We could not reach the quote service.',
          summary,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

async function submitToFresaForm({ formUrl, payload, doFetch, timeoutMs, reserveSlot, summary }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const { formApiUrl, submitUrl } = resolveFresaFormApi(formUrl);
    const formResponse = await doFetch(formApiUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    const formData = await readJson(formResponse);
    if (!formResponse.ok || formData?.success !== true) {
      return {
        ok: false,
        mode: 'form-api',
        error: formData?.error || `Fresa could not load the quote form (${formResponse.status}).`,
        summary,
      };
    }

    const submission = buildFresaFormSubmission(payload, formData);

    if (payload.orderType === 'Delivery') {
      if (!payload.deliverySlot) {
        return {
          ok: false,
          mode: 'form-api',
          code: 'DELIVERY_SLOT_MISSING',
          error: 'Please choose an available delivery window before sending your request.',
          summary,
        };
      }
      const capacityResult = await reserveDeliveryCapacity({ payload, reserveSlot });
      if (!capacityResult.ok) {
        return {
          ok: false,
          mode: 'form-api',
          code: capacityResult.code,
          error: capacityResult.error,
          summary,
        };
      }
    }

    const response = await doFetch(submitUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ answers: submission.answers, meta: submission.meta }),
      signal: controller.signal,
    });
    const data = await readJson(response);
    if (!response.ok || data?.success !== true || typeof data?.taskId !== 'string') {
      return {
        ok: false,
        mode: 'form-api',
        error: data?.error || `Fresa could not record the quote request (${response.status}).`,
        summary,
      };
    }

    return {
      ok: true,
      mode: 'form-api',
      taskId: data.taskId,
      listId: submission.listId,
      summary,
    };
  } catch (error) {
    const aborted = error?.name === 'AbortError';
    const configured = error instanceof FresaFormConfigurationError;
    return {
      ok: false,
      mode: 'form-api',
      ...(configured && error.code ? { code: error.code } : {}),
      error: aborted
        ? 'Fresa took too long to respond. Your selection is still saved.'
        : configured
          ? error.message
          : 'We could not reach Fresa. Your selection is still saved.',
      summary,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Reserves a Delivery window immediately before creating the external quote
 * request. The Firestore client transaction owns the atomic increment; the
 * server-side rules enforce the same two-slot ceiling for every browser.
 */
async function reserveDeliveryCapacity({ payload, reserveSlot }) {
  const slot = payload.deliverySlot;
  try {
    const reserve = reserveSlot ?? (async (deliverySlot) => {
      const module = await import('./delivery-capacity.js');
      return module.reserveDeliverySlot(deliverySlot);
    });
    await reserve({
      date: slot.date,
      start: slot.start,
      end: slot.end,
      timeZone: payload.deliveryTimeZone ?? 'UTC',
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      code: error?.code ?? 'CAPACITY_UNAVAILABLE',
      error: error?.code === 'SLOT_FULL'
        ? 'That delivery window just filled up. Please choose another window.'
        : 'Delivery capacity could not be confirmed. Please try again.',
    };
  }
}

/** The message shown when a quote flow fails. */
export const QUOTE_ERROR_MESSAGE = "We couldn't open the quote form. Please try again.";

/**
 * Copies text, falling back to a hidden textarea where the async clipboard API
 * is unavailable or blocked.
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }

  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}
