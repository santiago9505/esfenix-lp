import { defineSecret, defineString } from 'firebase-functions/params';
import { onRequest } from 'firebase-functions/v2/https';

import {
  FresaClientLookupError,
  lookupActiveClientByEmail,
} from './src/client-lookup.js';

const clientsApiUrl = defineString('FRESA_CLIENTS_API_URL', {
  default: 'https://fresaai.app/api/public/v1/tasks',
});
const clientsListId = defineString('FRESA_CLIENTS_LIST_ID', {
  default: '20cd5f18-e350-492f-97db-fc52b45461bf',
});
const clientsEmailFieldId = defineString('FRESA_CLIENTS_EMAIL_FIELD_ID', {
  default: '385ea80b-dafe-498a-a153-1d83419149f7',
});
const clientsActiveFieldId = defineString('FRESA_CLIENTS_ACTIVE_FIELD_ID', {
  default: 'e25c3417-f03a-4a32-9809-85951e015a41',
});
const clientsApiKey = defineSecret('FRESA_CLIENTS_API_KEY');

const rateBuckets = new Map();

export const fresaClientLookup = onRequest(
  {
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 30,
    minInstances: 0,
    maxInstances: 20,
    concurrency: 40,
    cors: false,
    secrets: [clientsApiKey],
  },
  async (request, response) => {
    setApiSecurityHeaders(response);
    response.set('Cache-Control', 'private, no-store, max-age=0');

    if (request.method !== 'POST') return methodNotAllowed(response, 'POST');
    if (isCrossSiteRequest(request)) {
      return response.status(403).json({ success: false, error: 'Cross-site request blocked.' });
    }
    if (!acceptRequest(request, { limit: 20, windowMs: 60_000 })) {
      return response.status(429).json({ success: false, error: 'Too many requests. Please try again shortly.' });
    }
    if (!isJsonRequest(request) || request.rawBody?.length > 4096) {
      return response.status(400).json({ success: false, error: 'Invalid request.' });
    }

    const email = request.body?.email;
    if (typeof email !== 'string' || email.trim().length > 254) {
      return response.status(400).json({ success: false, error: 'Invalid email.' });
    }

    try {
      const result = await lookupActiveClientByEmail(email, {
        apiUrl: clientsApiUrl.value(),
        apiKey: clientsApiKey.value(),
        expectedListId: clientsListId.value(),
        emailFieldId: clientsEmailFieldId.value(),
        activeFieldId: clientsActiveFieldId.value(),
      });
      return response.status(200).json({
        success: true,
        found: result.found,
        vip: result.vip,
        profile: result.profile,
        ...(result.taskId ? { taskId: result.taskId } : {}),
      });
    } catch (error) {
      return apiError(response, error);
    }
  },
);

function isJsonRequest(request) {
  return request.is?.('application/json') === 'application/json';
}

function isCrossSiteRequest(request) {
  if (String(request.get?.('sec-fetch-site') ?? '').toLowerCase() === 'cross-site') return true;
  const origin = String(request.get?.('origin') ?? '').trim();
  if (!origin) return false;
  try {
    return new URL(origin).host !== String(request.get?.('host') ?? '').trim();
  } catch {
    return true;
  }
}

function acceptRequest(request, { limit, windowMs }) {
  const now = Date.now();
  const ip = String(request.ip ?? request.get?.('x-forwarded-for') ?? 'unknown').split(',')[0].trim();
  const current = rateBuckets.get(ip);
  if (!current || now >= current.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + windowMs });
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
  response.set('Vary', 'Accept-Encoding, Origin, Sec-Fetch-Site');
}

function methodNotAllowed(response, allow) {
  response.set('Allow', allow);
  return response.status(405).json({ success: false, error: 'Method not allowed.' });
}

function apiError(response, error) {
  const status = error instanceof FresaClientLookupError && error.status >= 400 && error.status < 500
    ? error.status
    : 503;
  if (status >= 500) console.error('Fresa client lookup failure', error);
  return response.status(status).json({
    success: false,
    error: status >= 500 ? 'The service is temporarily unavailable.' : error.message,
  });
}
