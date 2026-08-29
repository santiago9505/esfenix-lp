const env = typeof import.meta !== 'undefined' ? import.meta.env ?? {} : {};

export const LIVE_CATALOG_INTEGRATION_ID = 'c4753811-17e2-4dcd-9477-048b1b79060b';

const defaultOrigin = env.DEV ? 'http://localhost:3000' : 'https://fresaai.app';

/**
 * Public, read-only Fresa integration. Its server-side configuration limits it
 * to the three Esfenix product lists and excludes all price fields.
 */
export const LIVE_CATALOG_URL = String(
  env.VITE_FRESA_CATALOG_PUBLIC_URL
    ?? `${defaultOrigin}/api/integrations/lists/${LIVE_CATALOG_INTEGRATION_ID}?activeOnly=true`,
).trim();

export const LIVE_CATALOG_POLL_INTERVAL_MS = 15_000;
export const LIVE_CATALOG_SIGNED_URL_REFRESH_MS = 45 * 60_000;
