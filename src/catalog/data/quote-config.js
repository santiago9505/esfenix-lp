/**
 * Quote form configuration.
 *
 * The public form URL is enough for the default API integration: the catalog
 * derives GET /api/forms/:token and POST /api/forms/:token/submit from it.
 */

const env = typeof import.meta !== 'undefined' ? import.meta.env ?? {} : {};

const PRODUCTION_FORM_URL = 'https://fresaai.app/f/0578f97716840e34cf5472d5';
const LOCAL_FORM_URL = 'http://localhost:3000/f/0578f97716840e34cf5472d5';
const isLocalCatalog = typeof window !== 'undefined'
  && ['localhost', '127.0.0.1'].includes(window.location.hostname);

/** The live Fresa form. Local development follows the already-running app on port 3000. */
export const QUOTE_FORM_URL = String(env.VITE_FRESA_QUOTE_FORM_URL ?? '').trim()
  || (isLocalCatalog ? LOCAL_FORM_URL : PRODUCTION_FORM_URL);

/**
 * Endpoint that exchanges a quote payload for a short-lived session id.
 *
 *   POST <endpoint>  { ...payload }  ->  { quoteSessionId, redirectUrl }
 *
 * This legacy adapter remains supported for environments that already provide
 * it. When unset, the public Fresa form API is used directly.
 *
 * @type {string|null}
 */
// No custom session backend is used in the basic-plan deployment. The quote
// integration still accepts an injected adapter in tests/future hosting, but
// production always submits through the public Fresa form API.
export const QUOTE_SESSION_ENDPOINT = null;

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
