import { FresaClientLookupError, lookupActiveClientByEmail, normalizeEmail } from './client-lookup.js';
import { contactPreview, submitQuoteWithSavedContact } from './saved-contact.js';

// Retain the deployed class for the existing Cloudflare migration.
export class ClientProfileCodes {
  fetch() {
    return new Response(null, { status: 410 });
  }
}

const MAX_LOOKUP_BYTES = 2_048;
const MAX_SUBMISSION_BYTES = 1024 * 1024;

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
  if (declaredLength > MAX_SUBMISSION_BYTES) {
    return jsonResponse(413, { success: false, error: 'Request too large.' }, corsOrigin);
  }

  let body;
  try {
    const decoded = await readBoundedBody(request);
    if (!decoded) return jsonResponse(413, { success: false, error: 'Request too large.' }, corsOrigin);
    body = JSON.parse(decoded.text);
    if (body?.action !== 'submit-quote' && decoded.bytes > MAX_LOOKUP_BYTES) {
      return jsonResponse(413, { success: false, error: 'Request too large.' }, corsOrigin);
    }
  } catch {
    return jsonResponse(400, { success: false, error: 'Invalid request.' }, corsOrigin);
  }

  const email = typeof body?.email === 'string' ? normalizeEmail(body.email) : '';
  if (!isEmail(email)) {
    return jsonResponse(400, { success: false, error: 'Invalid email.' }, corsOrigin);
  }

  const action = body.action ?? 'lookup';
  if (action !== 'lookup' && action !== 'submit-quote') {
    return jsonResponse(400, { success: false }, corsOrigin);
  }
  let client;
  try {
    client = await lookupActiveClientByEmail(email, {
      apiUrl: env.FRESA_CLIENTS_API_URL,
      apiKey: env.FRESA_CLIENTS_API_KEY,
      expectedListId: env.FRESA_CLIENTS_LIST_ID,
      emailFieldId: env.FRESA_CLIENTS_EMAIL_FIELD_ID,
      activeFieldId: env.FRESA_CLIENTS_ACTIVE_FIELD_ID,
      vipFieldId: env.FRESA_CLIENTS_VIP_FIELD_ID,
      fetchImpl: options.fetchImpl,
    });
  } catch (error) {
    if (!(error instanceof FresaClientLookupError) || error.status >= 500) {
      console.error('Fresa client lookup failed', error);
    }
    return jsonResponse(
      error instanceof FresaClientLookupError && error.status >= 400 && error.status < 500 ? error.status : 503,
      {
        success: false,
        error: 'The service is temporarily unavailable.',
        ...(action === 'submit-quote' && { code: 'SAVED_CONTACT_UNAVAILABLE' }),
      },
      corsOrigin,
    );
  }

  if (action === 'submit-quote') {
    try {
      const result = await submitQuoteWithSavedContact({
        body, email, client, formUrl: env.FRESA_QUOTE_FORM_URL, fetchImpl: options.fetchImpl,
      });
      return jsonResponse(result.status, result.data, corsOrigin);
    } catch {
      return jsonResponse(503, { success: false }, corsOrigin);
    }
  }

  return jsonResponse(200, {
    success: true,
    found: client.found,
    vip: client.vip,
    verificationAvailable: false,
    contactPreview: env.FRESA_QUOTE_FORM_URL ? contactPreview(client.profile) : {},
  }, corsOrigin);
}

function isEmail(value) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(value);
}

async function readBoundedBody(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Request body is required.');
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return { bytes, text: text + decoder.decode() };
    bytes += value.byteLength;
    if (bytes > MAX_SUBMISSION_BYTES) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
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
