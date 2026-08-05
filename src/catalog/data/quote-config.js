/**
 * Quote form configuration.
 *
 * To point the catalog at a different Fresa form, change QUOTE_FORM_URL. To
 * enable secure product and client prefill, set FRESA_QUOTE_SESSION_ENDPOINT
 * (see below). Nothing else in the catalog references the form.
 */

/** The Fresa form the quote flows open. */
export const QUOTE_FORM_URL = 'https://fresaai.app/f/0578f97716840e34cf5472d5';

const env = typeof import.meta !== 'undefined' ? import.meta.env ?? {} : {};

/**
 * Endpoint that exchanges a quote payload for a short-lived session id.
 *
 *   POST <endpoint>  { ...payload }  ->  { quoteSessionId, redirectUrl }
 *
 * Set this once a backend exists. Until then the catalog opens the form with
 * only non-identifying context in the URL and offers the visitor a copyable
 * summary of their selection, because the alternative — putting the product
 * list, email or address into visible query parameters — is not acceptable.
 *
 * Fresa publishes no documented prefill API at the time of writing. If it
 * gains one, prefer it over this endpoint and implement it as an adapter in
 * core/quote-integration.js.
 *
 * @type {string|null}
 */
export const QUOTE_SESSION_ENDPOINT = String(env.FRESA_QUOTE_SESSION_ENDPOINT ?? '').trim() || null;

/** Identifies where a request came from, in the payload's `source` field. */
export const QUOTE_SOURCE = 'esfenix-product-catalog';

/** `source` used when the visitor asks for a quote without selecting products. */
export const QUOTE_SOURCE_NO_PRODUCTS = 'esfenix-website';

/**
 * Query parameters the catalog is willing to put in the form URL.
 *
 * Only non-identifying routing context: which catalog the visitor browsed and
 * which branch should pick the request up. City, state, ZIP code, email and
 * the product list travel through the session endpoint, never the URL.
 */
export const URL_SAFE_PARAMS = ['source', 'location', 'serviceCenter'];
