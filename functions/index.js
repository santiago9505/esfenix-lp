import { defineSecret, defineString } from 'firebase-functions/params';
import { onRequest } from 'firebase-functions/v2/https';

import {
  FresaServiceError,
  findClientByEmail,
  publicCatalog,
  quotePricing,
} from './src/fresa-service.js';

const catalogApiUrl = defineString('FRESA_CATALOG_API_URL');
const catalogIntegrationId = defineString('FRESA_CATALOG_INTEGRATION_ID');
const clientsApiUrl = defineString('FRESA_CLIENTS_API_URL');
const clientsIntegrationId = defineString('FRESA_CLIENTS_INTEGRATION_ID');
const catalogApiKey = defineSecret('FRESA_CATALOG_API_KEY');
const clientsApiKey = defineSecret('FRESA_CLIENTS_API_KEY');

const commonOptions = {
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 30,
  minInstances: 0,
  maxInstances: 20,
  concurrency: 40,
  cors: false,
};

const rateBuckets = new Map();

export const fresaCatalog = onRequest(
  { ...commonOptions, secrets: [catalogApiKey] },
  async (request, response) => {
    setApiSecurityHeaders(response);
    if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed(response, 'GET, HEAD');
    try {
      const result = await publicCatalog(catalogOptions());
      response.set('Cache-Control', 'public, max-age=60, s-maxage=900, stale-while-revalidate=60');
      response.set('ETag', result.etag);
      if (request.get('if-none-match') === result.etag) return response.status(304).end();
      if (request.method === 'HEAD') return response.status(200).end();
      return response.type('application/json').status(200).send(result.serialized);
    } catch (error) {
      return apiError(response, error);
    }
  },
);

export const fresaClientLookup = onRequest(
  { ...commonOptions, secrets: [clientsApiKey] },
  async (request, response) => {
    setApiSecurityHeaders(response);
    response.set('Cache-Control', 'private, no-store, max-age=0');
    if (request.method !== 'POST') return methodNotAllowed(response, 'POST');
    if (isCrossSiteRequest(request)) return response.status(403).json({ error: 'Cross-site request blocked.' });
    if (!acceptRequest(request, { limit: 20, windowMs: 60_000 })) {
      return response.status(429).json({ error: 'Too many requests. Please try again shortly.' });
    }
    if (!isJsonRequest(request) || request.rawBody?.length > 4096) {
      return response.status(400).json({ error: 'Invalid request.' });
    }
    const email = String(request.body?.email ?? '').trim().toLowerCase();
    if (!email || email.length > 254) return response.status(400).json({ error: 'Invalid email.' });
    try {
      const profile = await findClientByEmail(email, clientsOptions());
      return response.status(200).json({ profile });
    } catch (error) {
      return apiError(response, error);
    }
  },
);

export const fresaQuotePricing = onRequest(
  { ...commonOptions, secrets: [catalogApiKey] },
  async (request, response) => {
    setApiSecurityHeaders(response);
    response.set('Cache-Control', 'private, no-store, max-age=0');
    if (request.method !== 'POST') return methodNotAllowed(response, 'POST');
    if (isCrossSiteRequest(request)) return response.status(403).json({ error: 'Cross-site request blocked.' });
    if (!acceptRequest(request, { limit: 60, windowMs: 60_000 })) {
      return response.status(429).json({ error: 'Too many requests. Please try again shortly.' });
    }
    if (!isJsonRequest(request) || request.rawBody?.length > 32_768) {
      return response.status(400).json({ error: 'Invalid request.' });
    }
    try {
      const pricing = await quotePricing(request.body?.items, catalogOptions());
      return response.status(200).json(pricing);
    } catch (error) {
      return apiError(response, error);
    }
  },
);

function catalogOptions() {
  return {
    apiUrl: catalogApiUrl.value(),
    apiKey: catalogApiKey.value(),
    integrationId: catalogIntegrationId.value(),
  };
}

function clientsOptions() {
  return {
    apiUrl: clientsApiUrl.value(),
    apiKey: clientsApiKey.value(),
    integrationId: clientsIntegrationId.value(),
  };
}

function isJsonRequest(request) {
  return request.is('application/json') === 'application/json';
}

function isCrossSiteRequest(request) {
  return String(request.get('sec-fetch-site') ?? '').toLowerCase() === 'cross-site';
}

function acceptRequest(request, { limit, windowMs }) {
  const now = Date.now();
  const ip = String(request.ip ?? request.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim();
  const key = `${request.path}|${ip}`;
  const current = rateBuckets.get(key);
  if (!current || now >= current.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    pruneRateBuckets(now);
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}

function pruneRateBuckets(now) {
  if (rateBuckets.size < 5000) return;
  for (const [key, bucket] of rateBuckets) {
    if (now >= bucket.resetAt) rateBuckets.delete(key);
  }
}

function setApiSecurityHeaders(response) {
  response.set('X-Content-Type-Options', 'nosniff');
  response.set('Referrer-Policy', 'no-referrer');
  response.set('X-Frame-Options', 'DENY');
  response.set('Vary', 'Accept-Encoding');
}

function methodNotAllowed(response, allow) {
  response.set('Allow', allow);
  return response.status(405).json({ error: 'Method not allowed.' });
}

function apiError(response, error) {
  const status = error instanceof FresaServiceError && error.status >= 400 && error.status < 500
    ? error.status
    : 503;
  if (status >= 500) console.error('Fresa API failure', error);
  return response.status(status).json({
    error: status >= 500 ? 'The service is temporarily unavailable.' : error.message,
  });
}
