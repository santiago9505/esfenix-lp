/**
 * quoteIntegrationService — the seam between the catalog and the quote form.
 *
 * The catalog never drives the Fresa form by poking at its DOM: that breaks the
 * moment the form changes. It hands over a payload and gets back a URL to open.
 *
 * Two adapters, chosen automatically:
 *
 *   session  Used when QUOTE_SESSION_ENDPOINT is configured. POSTs the payload,
 *            receives a short-lived id and a redirect URL, opens that. Email,
 *            address and the product list travel in the request body — never in
 *            a query string.
 *
 *   direct   The fallback while no endpoint exists. Opens the form with only
 *            non-identifying routing context in the URL, and returns a text
 *            summary the visitor can paste. Fresa has no published prefill API
 *            yet; when it does, add an adapter for it here and nothing else in
 *            the catalog needs to change.
 *
 * Failure never costs the visitor their selection: the caller keeps the quote
 * list and can retry.
 */

import { QUOTE_FORM_URL, QUOTE_SESSION_ENDPOINT, URL_SAFE_PARAMS } from '../data/quote-config.js';
import { assertNoPricing, buildQuoteSummaryText } from './quote-payload.js';

/**
 * @typedef {{ ok: true, mode: 'session'|'direct', url: string, summary: string, sessionId?: string }} QuoteSuccess
 * @typedef {{ ok: false, mode: 'session'|'direct', error: string, summary: string }} QuoteFailure
 */

const REQUEST_TIMEOUT_MS = 10000;

/**
 * @param {{
 *   formUrl?: string,
 *   sessionEndpoint?: string|null,
 *   fetchImpl?: typeof fetch,
 *   openImpl?: (url: string) => (Window|null),
 *   timeoutMs?: number,
 * }} [options]
 */
export function createQuoteIntegration(options = {}) {
  const formUrl = options.formUrl ?? QUOTE_FORM_URL;
  const sessionEndpoint =
    options.sessionEndpoint === undefined ? QUOTE_SESSION_ENDPOINT : options.sessionEndpoint;
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

  /**
   * The form URL with only the parameters listed in URL_SAFE_PARAMS.
   * @param {ReturnType<typeof import('./quote-payload').buildQuotePayload>} payload
   */
  function directUrl(payload) {
    const url = new URL(formUrl);
    const values = {
      source: payload.source,
      location: payload.fresa?.location ?? payload.selectedLocation,
      serviceCenter: payload.serviceCenter,
    };
    for (const key of URL_SAFE_PARAMS) {
      if (values[key]) url.searchParams.set(key, values[key]);
    }
    return url.toString();
  }

  return {
    /** Which adapter a call to `start` would use. */
    mode() {
      return sessionEndpoint ? 'session' : 'direct';
    },

    /**
     * Opens the quote form for the given payload.
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
        const url = directUrl(payload);
        const opened = openQuoteUrl(url);
        if (!opened) {
          return {
            ok: false,
            mode: 'direct',
            error: 'The quote form could not be opened. Your browser may have blocked the new tab.',
            summary,
          };
        }
        return { ok: true, mode: 'direct', url, summary };
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
