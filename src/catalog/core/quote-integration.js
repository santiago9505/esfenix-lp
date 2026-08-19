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
  resolveFresaProductFieldId,
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

    /** Validates one email through the public form's scoped list lookup. */
    lookupClient(email) {
      return lookupFresaClient({ formUrl, email, doFetch, timeoutMs });
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

function normalizeLookupValue(value) {
  return String(value ?? '')
    .trim()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/^mailto:/i, '')
    .toLowerCase();
}

function lookupTargetKey(target) {
  if (!target || typeof target !== 'object') return '';
  const listId = String(target.listId || target.listName || '').trim().toLowerCase() || 'current';
  if (target.target === 'custom_field') {
    const fieldId = String(target.customFieldId || '').trim();
    return fieldId ? `${listId}|custom_field:${fieldId}` : '';
  }
  return `${listId}|${String(target.target || '').trim()}`;
}

function lookupProfileFromMatch(fields, rule, match) {
  const byId = new Map(fields.map((field) => [field?.id, field]));
  const values = {};
  for (const action of rule?.thenActions ?? []) {
    if (action?.type !== 'populate_field_from_lookup') continue;
    const targetField = byId.get(action.targetFieldId);
    const sourceKey = lookupTargetKey(action.lookupValueTarget);
    if (!targetField?.label || !sourceKey) continue;
    values[targetField.label] = match?.values?.[sourceKey] ?? null;
  }
  return values;
}

function booleanValue(value) {
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'yes', 'si', 'sí', 'vip'].includes(normalizeLookupValue(value));
}

async function lookupFresaClient({ formUrl, email, doFetch, timeoutMs }) {
  const normalizedEmail = normalizeLookupValue(email);
  if (!normalizedEmail) return { ok: false, found: false, error: 'Enter a valid email address.' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const { formApiUrl, lookupUrl } = resolveFresaFormApi(formUrl);
    const metadataUrl = new URL(formApiUrl);
    metadataUrl.searchParams.set('catalog', 'metadata');
    const formResponse = await doFetch(metadataUrl.toString(), {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    const formData = await readJson(formResponse);
    const fields = Array.isArray(formData?.form?.fields) ? formData.form.fields : [];
    const emailField = fields.find((field) =>
      field?.type === 'email' && normalizeLookupValue(field?.label) === 'email'
    );
    const lookupRule = (emailField?.actionRules ?? []).find((rule) =>
      (rule?.conditions ?? []).some((condition) => condition?.operator === 'exists_in_list')
    );
    const lookupCondition = (lookupRule?.conditions ?? []).find((condition) => condition?.operator === 'exists_in_list');
    const emailTargetKey = lookupTargetKey(lookupCondition?.listLookupTarget);
    if (!formResponse.ok || formData?.success !== true || !emailField?.id || !emailTargetKey) {
      return { ok: false, found: false, error: 'Customer validation is not configured in Fresa.' };
    }

    const response = await doFetch(lookupUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ answers: { [emailField.id]: normalizedEmail } }),
      signal: controller.signal,
    });
    const data = await readJson(response);
    if (!response.ok || data?.success !== true) {
      return { ok: false, found: false, error: data?.error || 'Customer validation is temporarily unavailable.' };
    }

    const match = data?.matches?.[emailTargetKey]?.[normalizedEmail]?.[0] ?? null;
    if (!match) return { ok: true, found: false, vip: false, profile: {} };
    const profile = lookupProfileFromMatch(fields, lookupRule, match);
    return {
      ok: true,
      found: true,
      vip: booleanValue(profile['VIP?']),
      profile,
      taskId: match.taskId ?? null,
    };
  } catch (error) {
    return {
      ok: false,
      found: false,
      error: error?.name === 'AbortError'
        ? 'Customer validation took too long. Please try again.'
        : 'Customer validation is temporarily unavailable.',
    };
  } finally {
    clearTimeout(timer);
  }
}

async function submitToFresaForm({ formUrl, payload, doFetch, timeoutMs, reserveSlot, summary }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const { formApiUrl, submitUrl } = resolveFresaFormApi(formUrl);
    const metadataUrl = new URL(formApiUrl);
    metadataUrl.searchParams.set('catalog', 'metadata');
    const metadataResponse = await doFetch(metadataUrl.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    const metadata = await readJson(metadataResponse);
    if (!metadataResponse.ok || metadata?.success !== true) {
      return {
        ok: false,
        mode: 'form-api',
        error: metadata?.error || `Fresa could not load the quote form (${metadataResponse.status}).`,
        summary,
      };
    }

    const productFieldId = resolveFresaProductFieldId(payload, metadata);
    const scopedFormUrl = new URL(formApiUrl);
    scopedFormUrl.searchParams.set('catalogFieldId', productFieldId);
    const formResponse = await doFetch(scopedFormUrl.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    const formData = await readJson(formResponse);
    if (!formResponse.ok || formData?.success !== true) {
      return {
        ok: false,
        mode: 'form-api',
        error: formData?.error || `Fresa could not load the selected catalog (${formResponse.status}).`,
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
 * Runs an optional capacity adapter immediately before creating the external
 * quote request. The basic static plan intentionally has no adapter, so a
 * delivery window remains a preference that the Esfenix team confirms later.
 */
async function reserveDeliveryCapacity({ payload, reserveSlot }) {
  const slot = payload.deliverySlot;
  try {
    const reserve = reserveSlot ?? (async () => ({ ok: true, untracked: true }));
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
