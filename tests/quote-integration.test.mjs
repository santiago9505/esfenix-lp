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

function readyPickupPayload() {
  return buildQuotePayload({
    locationId: 'other',
    shippingDestination: { state: 'FL', city: 'Miami', zipCode: '33101' },
    email: 'buyer@example.com',
    contact: { firstName: 'Ana', lastName: 'Flower', phone: '+1 555 0100', company: 'Flowers Inc.' },
    orderType: 'Pickup',
    delivery: { dateTime: '2026-08-14' },
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

function publicFormResponse() {
  const fields = [
    { id: 'email', label: 'Email', type: 'email' },
    { id: 'vip', label: 'VIP?', type: 'checkbox' },
    { id: 'first', label: 'First Name', type: 'short_text' },
    { id: 'last', label: 'Last Name', type: 'short_text' },
    { id: 'phone', label: 'Phone Number', type: 'phone' },
    { id: 'location', label: 'Location', type: 'select', options: [{ value: 'nation_wide', label: 'NATION WIDE' }] },
    {
      id: 'products',
      label: 'Products TX - NATION WIDE',
      type: 'catalog_items',
      actionRules: [{ enabled: true, conditions: [
        { sourceFieldId: 'location', operator: 'equals', value: 'nation_wide' },
        { sourceFieldId: 'vip', operator: 'is_false' },
      ] }],
      catalogConfig: {
        items: [{
          value: 'product-task-id',
          label: 'Sunflowers',
          referenceValues: { bunch_price: 12 },
        }],
      },
    },
    { id: 'orderType', label: 'Type of Order', type: 'select', options: [{ value: 'pickup', label: 'Pickup' }] },
    { id: 'pickup', label: 'pickup', type: 'date' },
    { id: 'notes', label: 'Notes for the seller', type: 'long_text' },
  ];
  return { success: true, listId: 'quote-list', form: { enabled: true, fields } };
}

function deliveryPayloadWithSlot(orderType = 'Delivery') {
  const payload = payloadWithProducts();
  payload.orderType = orderType;
  payload.deliveryDateTime = '2026-08-10T08:00';
  payload.deliveryTimeZone = 'UTC';
  payload.deliverySlot = {
    date: '2026-08-10',
    start: '08:00',
    end: '10:00',
    capacity: 2,
  };
  return payload;
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

test('without a legacy session endpoint the response is submitted through the Fresa form API', async () => {
  const calls = [];
  const integration = createQuoteIntegration({
    formUrl: FORM_URL,
    sessionEndpoint: null,
    async fetchImpl(url, options) {
      calls.push({ url, options });
      if (options.method === 'GET') {
        return { ok: true, status: 200, json: async () => publicFormResponse() };
      }
      return { ok: true, status: 200, json: async () => ({ success: true, taskId: 'created-task' }) };
    },
  });

  assert.equal(integration.mode(), 'form-api');

  const result = await integration.start(readyPickupPayload());
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'form-api');
  assert.equal(result.taskId, 'created-task');
  assert.equal(calls[0].url, 'https://fresaai.app/api/forms/0578f97716840e34cf5472d5?catalog=metadata');
  assert.equal(calls[1].url, 'https://fresaai.app/api/forms/0578f97716840e34cf5472d5?catalogFieldId=products');
  assert.equal(calls[2].url, 'https://fresaai.app/api/forms/0578f97716840e34cf5472d5/submit');
  const body = JSON.parse(calls[2].options.body);
  assert.deepEqual(body.answers.products, [{
    productId: 'product-task-id',
    quantity: 5,
    size: null,
    measure: 'bunch',
  }]);
});

test('validates one active client email and returns the scoped profile and VIP flag', async () => {
  const form = publicFormResponse();
  form.form.fields[0].actionRules = [{
    enabled: true,
    conditions: [{
      operator: 'exists_in_list',
      listLookupTarget: { listId: 'clients', target: 'custom_field', customFieldId: 'client-email' },
    }],
    thenActions: [
      {
        type: 'populate_field_from_lookup',
        targetFieldId: 'first',
        lookupValueTarget: { listId: 'clients', target: 'custom_field', customFieldId: 'client-first' },
      },
      {
        type: 'populate_field_from_lookup',
        targetFieldId: 'vip',
        lookupValueTarget: { listId: 'clients', target: 'custom_field', customFieldId: 'client-vip' },
      },
    ],
  }];

  const calls = [];
  const integration = createQuoteIntegration({
    formUrl: FORM_URL,
    sessionEndpoint: null,
    async fetchImpl(url, options) {
      calls.push({ url, options });
      if (String(url).endsWith('/lookup')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            matches: {
              'clients|custom_field:client-email': {
                'buyer@example.com': [{
                  taskId: 'client-task',
                  values: {
                    'clients|custom_field:client-first': 'Ana',
                    'clients|custom_field:client-vip': true,
                  },
                }],
              },
            },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => form };
    },
  });

  const result = await integration.lookupClient(' Buyer@Example.com ');
  assert.equal(result.ok, true);
  assert.equal(result.found, true);
  assert.equal(result.vip, true);
  assert.equal(result.profile['First Name'], 'Ana');
  assert.equal(result.taskId, 'client-task');
  assert.equal(calls[1].url, 'https://fresaai.app/api/forms/0578f97716840e34cf5472d5/lookup');
  assert.deepEqual(JSON.parse(calls[1].options.body), { answers: { email: 'buyer@example.com' } });
});

test('a failing Fresa form API keeps the quote summary and does not open a tab', async () => {
  const open = recorder();
  const integration = createQuoteIntegration({
    formUrl: FORM_URL,
    sessionEndpoint: null,
    openImpl: open.open,
    fetchImpl: async () => ({
      ok: false,
      status: 503,
      json: async () => ({ success: false, error: 'Fresa unavailable' }),
    }),
  });

  const result = await integration.start(readyPickupPayload());
  assert.equal(result.ok, false);
  assert.match(result.error, /unavailable/i);
  assert.match(result.summary, /Sunflowers/);
  assert.equal(open.opened.length, 0, 'the API flow never opens another tab');
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

test('Delivery reserves capacity before the quote session and Pickup skips it', async () => {
  const open = recorder();
  const calls = [];
  const reservations = [];
  const integration = createQuoteIntegration({
    formUrl: FORM_URL,
    sessionEndpoint: '/api/quote-sessions',
    openImpl: open.open,
    reserveDeliverySlotImpl: async (slot) => {
      reservations.push(slot);
      return { booked: 1, remaining: 1 };
    },
    async fetchImpl(url, options) {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({ quoteSessionId: 'capacity-session', redirectUrl: `${FORM_URL}?quoteSession=capacity-session` }),
      };
    },
  });

  const deliveryResult = await integration.start(deliveryPayloadWithSlot());
  assert.equal(deliveryResult.ok, true);
  assert.deepEqual(calls.map(({ url }) => url), ['/api/quote-sessions']);
  assert.deepEqual(reservations, [{
    date: '2026-08-10',
    start: '08:00',
    end: '10:00',
    timeZone: 'UTC',
  }]);

  calls.length = 0;
  const pickupResult = await integration.start(deliveryPayloadWithSlot('Pickup'));
  assert.equal(pickupResult.ok, true);
  assert.deepEqual(calls.map(({ url }) => url), ['/api/quote-sessions']);
  assert.equal(reservations.length, 1, 'Pickup does not consume Delivery capacity');
});

test('a full Delivery window stops before creating a quote session', async () => {
  const integration = createQuoteIntegration({
    formUrl: FORM_URL,
    sessionEndpoint: '/api/quote-sessions',
    openImpl: () => ({}),
    reserveDeliverySlotImpl: async () => {
      const error = new Error('full');
      error.code = 'SLOT_FULL';
      throw error;
    },
    async fetchImpl(url) {
      throw new Error('quote session should not be called');
    },
  });

  const result = await integration.start(deliveryPayloadWithSlot());
  assert.equal(result.ok, false);
  assert.equal(result.code, 'SLOT_FULL');
  assert.match(result.error, /filled up/i);
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
