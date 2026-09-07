import { FresaClientLookupError, lookupActiveClientByEmail } from './client-lookup.js';

const SECURITY_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Content-Type': 'application/json; charset=utf-8',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};

export async function handleRequest(request, env, options = {}) {
  const origin = String(request.headers.get('Origin') ?? '').trim();
  const allowedOrigins = new Set(String(env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean));
  const corsOrigin = origin && allowedOrigins.has(origin) ? origin : '';

  if (request.method === 'OPTIONS') {
    if (!corsOrigin) return jsonResponse(403, { success: false, error: 'Origin not allowed.' });
    return new Response(null, {
      status: 204,
      headers: responseHeaders(corsOrigin, {
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Max-Age': '86400',
      }),
    });
  }

  if (request.method !== 'POST') {
    return jsonResponse(405, { success: false, error: 'Method not allowed.' }, corsOrigin, { Allow: 'POST, OPTIONS' });
  }
  if (origin && !corsOrigin) {
    return jsonResponse(403, { success: false, error: 'Origin not allowed.' });
  }
  if (env.CLIENT_LOOKUP_RATE_LIMITER) {
    const actor = request.headers.get('CF-Connecting-IP') || 'unknown';
    const rateLimit = await env.CLIENT_LOOKUP_RATE_LIMITER.limit({ key: `client-lookup:${actor}` });
    if (!rateLimit.success) {
      return jsonResponse(429, { success: false, error: 'Too many requests. Please try again shortly.' }, corsOrigin);
    }
  }
  if (!String(request.headers.get('Content-Type') ?? '').toLowerCase().startsWith('application/json')) {
    return jsonResponse(400, { success: false, error: 'Invalid request.' }, corsOrigin);
  }

  const declaredLength = Number(request.headers.get('Content-Length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > 2048) {
    return jsonResponse(413, { success: false, error: 'Request too large.' }, corsOrigin);
  }

  let body;
  try {
    const rawBody = await request.text();
    if (rawBody.length > 2048) throw new Error('too large');
    body = JSON.parse(rawBody);
  } catch {
    return jsonResponse(400, { success: false, error: 'Invalid request.' }, corsOrigin);
  }

  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  if (!isEmail(email)) {
    return jsonResponse(400, { success: false, error: 'Invalid email.' }, corsOrigin);
  }

  try {
    const result = await lookupActiveClientByEmail(email, {
      apiUrl: env.FRESA_CLIENTS_API_URL,
      apiKey: env.FRESA_CLIENTS_API_KEY,
      expectedListId: env.FRESA_CLIENTS_LIST_ID,
      emailFieldId: env.FRESA_CLIENTS_EMAIL_FIELD_ID,
      activeFieldId: env.FRESA_CLIENTS_ACTIVE_FIELD_ID,
      vipFieldId: env.FRESA_CLIENTS_VIP_FIELD_ID,
      fetchImpl: options.fetchImpl,
    });
    return jsonResponse(200, {
      success: true,
      found: result.found,
      vip: result.vip,
      profile: result.profile,
    }, corsOrigin);
  } catch (error) {
    if (!(error instanceof FresaClientLookupError) || error.status >= 500) {
      console.error('Fresa client lookup failed', error);
    }
    return jsonResponse(
      error instanceof FresaClientLookupError && error.status >= 400 && error.status < 500 ? error.status : 503,
      { success: false, error: 'The service is temporarily unavailable.' },
      corsOrigin,
    );
  }
}

function isEmail(value) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(value);
}

function jsonResponse(status, data, corsOrigin = '', extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: responseHeaders(corsOrigin, extraHeaders),
  });
}

function responseHeaders(corsOrigin, extraHeaders = {}) {
  const headers = new Headers({ ...SECURITY_HEADERS, ...extraHeaders });
  if (corsOrigin) headers.set('Access-Control-Allow-Origin', corsOrigin);
  headers.set('Vary', 'Origin');
  return headers;
}
