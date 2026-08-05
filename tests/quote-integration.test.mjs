import assert from 'node:assert/strict';
import test from 'node:test';

import { buildQuotePayload } from '../src/catalog/core/quote-payload.js';
import { createQuoteIntegration } from '../src/catalog/core/quote-integration.js';

const FORM_URL = 'https://fresaai.app/f/0578f97716840e34cf5472d5';

function payloadWithProducts() {
  return buildQuotePayload({
    locationId: 'other',
    shippingDestination: { state: 'FL', city: 'Miami', zipCode: '33101' },
    items: [
      {
        id: 'a',
        productId: 'sunflowers',
        productName: 'Sunflowers',
        category: 'other-flowers',
        selectedLocation: 'other',
        serviceCenter: 'HOUSTON',
        variety: null,
        color: null,
        lengthCm: null,
        measure: 'bunch',
        quantity: 5,
      },
    ],
  });
}

/** Records what the integration tried to open. */
function recorder() {
  const opened = [];
  return {
    opened,
    open: (url) => {
      opened.push(url);
      return {};
    },
  };
}

test('without an endpoint the form opens directly', async () => {
  const open = recorder();
  const integration = createQuoteIntegration({
    formUrl: FORM_URL,
    sessionEndpoint: null,
    openImpl: open.open,
  });

  assert.equal(integration.mode(), 'direct');

  const result = await integration.start(payloadWithProducts());
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'direct');
  assert.equal(open.opened.length, 1);
  assert.ok(open.opened[0].startsWith(FORM_URL));
});

test('the direct URL carries routing context and nothing personal', async () => {
  const open = recorder();
  const integration = createQuoteIntegration({
    formUrl: FORM_URL,
    sessionEndpoint: null,
    openImpl: open.open,
  });

  await integration.start(payloadWithProducts());
  const url = new URL(open.opened[0]);

  assert.equal(url.searchParams.get('location'), 'NATION WIDE');
  assert.equal(url.searchParams.get('serviceCenter'), 'HOUSTON');
  assert.equal(url.searchParams.get('source'), 'esfenix-product-catalog');

  const query = url.search.toLowerCase();
  for (const forbidden of ['miami', '33101', 'email', 'address', 'zip', 'sunflowers']) {
    assert.ok(!query.includes(forbidden), `${forbidden} must never appear in the URL`);
  }
});

test('a blocked popup is reported without losing the selection', async () => {
  const integration = createQuoteIntegration({
    formUrl: FORM_URL,
    sessionEndpoint: null,
    openImpl: () => null,
  });

  const result = await integration.start(payloadWithProducts());
  assert.equal(result.ok, false);
  assert.match(result.error, /blocked/i);
  assert.match(result.summary, /Sunflowers/, 'the summary is still offered as a fallback');
});

test('with an endpoint the payload is POSTed and the returned URL is opened', async () => {
  const open = recorder();
  let seen = null;

  const integration = createQuoteIntegration({
    formUrl: FORM_URL,
    sessionEndpoint: '/api/quote-sessions',
    openImpl: open.open,
    async fetchImpl(url, options) {
      seen = { url, options };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          quoteSessionId: 'temporary-id',
          redirectUrl: `${FORM_URL}?quoteSession=temporary-id`,
        }),
      };
    },
  });

  assert.equal(integration.mode(), 'session');

  const result = await integration.start(payloadWithProducts());
  assert.equal(result.ok, true);
  assert.equal(result.sessionId, 'temporary-id');
  assert.equal(open.opened[0], `${FORM_URL}?quoteSession=temporary-id`);

  assert.equal(seen.url, '/api/quote-sessions');
  assert.equal(seen.options.method, 'POST');

  // The address travels in the body, never in a query string.
  const body = JSON.parse(seen.options.body);
  assert.equal(body.delivery.zipCode, '33101');
  assert.equal(body.fresa.products.length, 1);
});

test('a redirect to another host is refused', async () => {
  const open = recorder();
  const integration = createQuoteIntegration({
    formUrl: FORM_URL,
    sessionEndpoint: '/api/quote-sessions',
    openImpl: open.open,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ quoteSessionId: 'x', redirectUrl: 'https://evil.example.com/steal' }),
    }),
  });

  const result = await integration.start(payloadWithProducts());
  assert.equal(result.ok, false);
  assert.match(result.error, /unexpected address/i);
  assert.equal(open.opened.length, 0, 'nothing is opened');
});

test('a failing endpoint returns an error and keeps the summary', async () => {
  const integration = createQuoteIntegration({
    formUrl: FORM_URL,
    sessionEndpoint: '/api/quote-sessions',
    openImpl: () => ({}),
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
  });

  const result = await integration.start(payloadWithProducts());
  assert.equal(result.ok, false);
  assert.match(result.error, /503/);
  assert.match(result.summary, /Sunflowers/);
});

test('a network failure is handled rather than thrown', async () => {
  const integration = createQuoteIntegration({
    formUrl: FORM_URL,
    sessionEndpoint: '/api/quote-sessions',
    openImpl: () => ({}),
    fetchImpl: async () => {
      throw new Error('offline');
    },
  });

  const result = await integration.start(payloadWithProducts());
  assert.equal(result.ok, false);
  assert.match(result.error, /could not reach/i);
});

test('a slow endpoint times out instead of hanging', async () => {
  const integration = createQuoteIntegration({
    formUrl: FORM_URL,
    sessionEndpoint: '/api/quote-sessions',
    timeoutMs: 20,
    openImpl: () => ({}),
    fetchImpl: (url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }),
  });

  const result = await integration.start(payloadWithProducts());
  assert.equal(result.ok, false);
  assert.match(result.error, /too long/i);
});

test('a payload carrying a price is refused before it can be sent', async () => {
  const integration = createQuoteIntegration({
    formUrl: FORM_URL,
    sessionEndpoint: null,
    openImpl: () => ({}),
  });

  const payload = payloadWithProducts();
  payload.products[0].price = 1.25;

  await assert.rejects(() => integration.start(payload), /pricing field/i);
});
