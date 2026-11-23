import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FresaClientLookupError,
  lookupActiveClientByEmail,
} from '../worker/src/client-lookup.js';
import { handleRequest } from '../worker/src/index.js';
import { contactPreview } from '../worker/src/saved-contact.js';

const LIST_ID = 'clients-list';
const EMAIL_FIELD_ID = 'email-field';
const ACTIVE_FIELD_ID = 'active-field';
const VIP_FIELD_ID = 'vip-field';

function task({ email, active = true, name = 'Cesar Ricaurte', description = '', statusCanonical = 'ACTIVA' }) {
  return {
    task_id: `${email}-task`,
    list_id: LIST_ID,
    name,
    status_canonical: statusCanonical,
    description,
    custom_fields: {
      [EMAIL_FIELD_ID]: { key: 'email_mr11h9d6', name: 'email', value: email },
      [ACTIVE_FIELD_ID]: { key: 'activo_mr11h8dn', name: 'activo', value: active },
      [VIP_FIELD_ID]: { key: 'vip_mr3xfzzn', name: 'VIP?', value: true },
      company: { key: 'empresa_mr11h8s7', name: 'empresa', value: '' },
    },
  };
}

function page(tasks, hasMore = false, nextOffset = null) {
  return { success: true, tasks, page: { hasMore, nextOffset } };
}

const lookupOptions = {
  apiUrl: 'https://fresaai.app/api/public/v1/tasks',
  apiKey: 'server-only-test-key',
  expectedListId: LIST_ID,
  emailFieldId: EMAIL_FIELD_ID,
  activeFieldId: ACTIVE_FIELD_ID,
  vipFieldId: VIP_FIELD_ID,
};

test('finds an active client across pages and returns only the form profile', async () => {
  const calls = [];
  const result = await lookupActiveClientByEmail(' FREDDY@FRESAAI.COM ', {
    ...lookupOptions,
    fetchImpl: async (url, options) => {
      const requestUrl = new URL(url);
      calls.push({ url: requestUrl, options });
      if (!requestUrl.pathname.endsWith('/tasks')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            task: task({
              email: 'freddy@fresaai.com',
              description: '```json\n{"quickbooks":{"entity":{"GivenName":"Cesar","FamilyName":"Ricaurte","CompanyName":"GFT","PrimaryPhone":{"FreeFormNumber":"+57 350 576 59 62"},"ShipAddr":{"Line1":"Main St","City":"Seattle","CountrySubDivisionCode":"WA","PostalCode":"98101"}}}}\n```',
            }),
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => Number(requestUrl.searchParams.get('offset')) === 0
          ? page([task({ email: 'other@example.com', active: false })], true, 200)
          : page([task({
              email: 'freddy@fresaai.com',
            })]),
      };
    },
  });

  assert.deepEqual(result, {
    found: true,
    vip: true,
    taskId: 'freddy@fresaai.com-task',
    profile: {
      'First Name': 'Cesar',
      'Last Name': 'Ricaurte',
      'Phone Number': '+57 350 576 59 62',
      Company: 'GFT',
      Address: 'Main St',
      City: 'Seattle',
      State: 'WA',
      'Zip Code': '98101',
    },
  });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url.searchParams.get('listId'), LIST_ID);
  assert.equal(calls[0].url.searchParams.get('statusCanonical'), 'ACTIVA');
  assert.equal(calls[0].url.searchParams.get('filterFieldId'), EMAIL_FIELD_ID);
  assert.equal(calls[0].url.searchParams.get('filterFieldValueJson'), '"freddy@fresaai.com"');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer server-only-test-key');
  assert.match(calls[2].url.pathname, /freddy%40fresaai\.com-task$/);
});

test('reads Fresa again on every lookup instead of caching clients', async () => {
  let requestCount = 0;
  const fetchImpl = async (url) => {
    if (!new URL(url).pathname.endsWith('/tasks')) {
      return { ok: false, status: 503, json: async () => ({ success: false }) };
    }
    requestCount += 1;
    return {
      ok: true,
      status: 200,
      json: async () => page([task({ email: requestCount === 1 ? 'new@example.com' : 'changed@example.com' })]),
    };
  };

  const first = await lookupActiveClientByEmail('new@example.com', { ...lookupOptions, fetchImpl });
  const second = await lookupActiveClientByEmail('new@example.com', { ...lookupOptions, fetchImpl });
  assert.equal(first.found, true);
  assert.equal(second.found, false);
  assert.equal(requestCount, 2);
});

test('rejects records returned from a different Fresa list', async () => {
  await assert.rejects(
    () => lookupActiveClientByEmail('client@example.com', {
      ...lookupOptions,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => page([{ ...task({ email: 'client@example.com' }), list_id: 'wrong-list' }]),
      }),
    }),
    (error) => error instanceof FresaClientLookupError && error.status === 502,
  );
});

test('worker accepts the landing origin and returns only an exact active match', async () => {
  const env = {
    ALLOWED_ORIGINS: 'https://esfenix-landing-page.web.app',
    FRESA_CLIENTS_API_URL: lookupOptions.apiUrl,
    FRESA_CLIENTS_API_KEY: lookupOptions.apiKey,
    FRESA_CLIENTS_LIST_ID: LIST_ID,
    FRESA_CLIENTS_EMAIL_FIELD_ID: EMAIL_FIELD_ID,
    FRESA_CLIENTS_ACTIVE_FIELD_ID: ACTIVE_FIELD_ID,
    FRESA_CLIENTS_VIP_FIELD_ID: VIP_FIELD_ID,
  };
  const request = new Request('https://lookup.example.workers.dev/', {
    method: 'POST',
    headers: { Origin: 'https://esfenix-landing-page.web.app', 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'freddy@fresaai.com' }),
  });
  const response = await handleRequest(request, env, {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => page([task({ email: 'freddy@fresaai.com' })]),
    }),
  });
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://esfenix-landing-page.web.app');
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store, max-age=0');
  assert.equal(data.success, true);
  assert.equal(data.found, true);
  assert.deepEqual(data.contactPreview, {});
  assert.equal(Object.hasOwn(data, 'profile'), false);
  assert.equal(Object.hasOwn(data, 'email'), false);
  assert.equal(Object.hasOwn(data, 'tasks'), false);
  assert.equal(Object.hasOwn(data, 'taskId'), false);
});

test('worker blocks unapproved browser origins before querying Fresa', async () => {
  let queried = false;
  const request = new Request('https://lookup.example.workers.dev/', {
    method: 'POST',
    headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'freddy@fresaai.com' }),
  });
  const response = await handleRequest(request, {
    ALLOWED_ORIGINS: 'https://esfenix-landing-page.web.app',
  }, {
    fetchImpl: async () => {
      queried = true;
      throw new Error('must not query');
    },
  });

  assert.equal(response.status, 403);
  assert.equal(queried, false);
});

test('worker rate limits before contacting Fresa', async () => {
  let queried = false;
  const request = new Request('https://lookup.example.workers.dev/', {
    method: 'POST',
    headers: {
      Origin: 'https://esfenix-landing-page.web.app',
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '203.0.113.8',
    },
    body: JSON.stringify({ email: 'freddy@fresaai.com' }),
  });
  const response = await handleRequest(request, {
    ALLOWED_ORIGINS: 'https://esfenix-landing-page.web.app',
    CLIENT_LOOKUP_RATE_LIMITER: { limit: async () => ({ success: false }) },
  }, {
    fetchImpl: async () => {
      queried = true;
      throw new Error('must not query');
    },
  });

  assert.equal(response.status, 429);
  assert.equal(queried, false);
});

function savedQuoteFixture({
  upstreamStatus = 200, phone = '+57 350 555 0100', hasSocialField = true, shipping = { Line1: 'Hidden address' },
} = {}) {
  const sent = [];
  const email = 'buyer@example.com';
  const formToken = 'quote-token';
  const env = {
    FRESA_CLIENTS_API_URL: lookupOptions.apiUrl,
    FRESA_CLIENTS_API_KEY: lookupOptions.apiKey,
    FRESA_CLIENTS_LIST_ID: LIST_ID,
    FRESA_CLIENTS_EMAIL_FIELD_ID: EMAIL_FIELD_ID,
    FRESA_CLIENTS_ACTIVE_FIELD_ID: ACTIVE_FIELD_ID,
    FRESA_CLIENTS_VIP_FIELD_ID: VIP_FIELD_ID,
    FRESA_QUOTE_FORM_URL: `https://fresaai.app/f/${formToken}`,
  };
  const fields = [
    { id: 'email', label: 'Email', type: 'email' },
    { id: 'vip', label: 'VIP?', type: 'checkbox' },
    { id: 'first', label: 'First Name', type: 'short_text' },
    { id: 'last', label: 'Last Name', type: 'short_text' },
    { id: 'phone', label: 'Phone Number', type: 'phone' },
    { id: 'company', label: 'Company', type: 'short_text' },
    ...(hasSocialField ? [{ id: 'social', label: 'Social Media Profiles (Business)', type: 'url' }] : []),
    { id: 'notes', label: 'Notes for the seller', type: 'long_text' },
    { id: 'items', label: 'Products', type: 'catalog_items' },
    { id: 'orderType', label: 'Type of Order', type: 'select', options: [{ label: 'Delivery', value: 'delivery' }, { label: 'Pickup', value: 'pickup' }] },
    { id: 'address', label: 'Address', type: 'short_text' },
    { id: 'city', label: 'City', type: 'short_text' },
    { id: 'state', label: 'State', type: 'short_text' },
    { id: 'zip', label: 'Zip Code', type: 'short_text' },
    { id: 'unrelatedEmail', label: 'Unrelated email', type: 'email' },
    { id: 'price', label: 'order_price', type: 'number' },
  ];
  function request(body) {
    return handleRequest(new Request('https://lookup.example.com/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }), env, {
      fetchImpl: async (input, init) => {
        const requestUrl = new URL(input);
        if (requestUrl.pathname.endsWith('/tasks')) {
          return Response.json(page([task({ email })]));
        }
        if (requestUrl.pathname === `/api/forms/${formToken}/submit`) {
          sent.push(JSON.parse(init.body));
          return upstreamStatus === 200
            ? Response.json({ success: true, taskId: 'created-quote', answers: sent.at(-1).answers })
            : Response.json({ success: false, error: `Your time slot is no longer available: ${phone}` }, { status: upstreamStatus });
        }
        if (requestUrl.pathname === `/api/forms/${formToken}`) {
          return Response.json({ success: true, form: { enabled: true, fields } });
        }
        assert.match(decodeURIComponent(requestUrl.pathname), /buyer@example\.com-task$/);
        const detail = task({ email, name: 'Test Account', description: `\`\`\`json\n${JSON.stringify({ entity: { ShipAddr: shipping } })}\n\`\`\`` });
        detail.custom_fields.first = { name: 'NOMBRE_CONTACTO', value: 'Ana' };
        detail.custom_fields.last = { name: 'APELLIDO_CONTACTO', value: 'Flowers' };
        detail.custom_fields.social = { name: 'Social media profiles (business)', value: 'https://example.com/flowers' };
        detail.custom_fields.mobile = { name: 'MÓVIL', value: null };
        detail.custom_fields.phone = { name: 'TELÉFONO', value: phone };
        detail.custom_fields.company.value = 'Flower Studio';
        return Response.json({ success: true, task: detail });
      },
    });
  }
  const quote = {
    action: 'submit-quote', formToken, email,
    savedContactFields: ['firstName', 'lastName', 'phone', 'company', 'socialMediaProfiles'],
    answers: { email, vip: true, first: '', last: '', phone: '', company: '', social: '', notes: 'Morning please', items: [{ id: 'flower' }] },
    meta: { source: 'esfenix-product-catalog', timeZone: 'America/Chicago', updateToken: 'ignore' },
  };
  return { request, quote, sent };
}

test('public lookup returns contact presence and last phone digits without the saved values', async () => {
  const { request, sent } = savedQuoteFixture();
  const response = await request({ email: ' Buyer@Example.com ' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true, found: true, vip: true, verificationAvailable: false,
    contactPreview: {
      firstName: true, firstNameInitial: 'A', firstNamePrefix: 'An',
      lastName: true, lastNameInitial: 'F', lastNamePrefix: 'Fl',
      phone: true, phoneLastDigits: '00', company: true, companyInitial: 'F', companyPrefix: 'Fl', socialMediaProfiles: true,
    },
    shippingPreview: null,
  });
  assert.deepEqual(await (await request({ email: 'new@example.com' })).json(), {
    success: true, found: false, vip: false, verificationAvailable: false, contactPreview: {}, shippingPreview: null,
  });
  assert.equal((await request({ action: 'send-code', email: 'buyer@example.com' })).status, 400);
  assert.equal(sent.length, 0);
});

test('saved contact prefixes preserve accented letters and keep short names masked', () => {
  const preview = contactPreview({ 'First Name': 'Éva', 'Last Name': 'Li', Company: 'X' });
  assert.equal(preview.firstNamePrefix, 'Év');
  assert.equal(preview.lastNamePrefix, 'L');
  assert.equal(preview.company, true);
  assert.equal(Object.hasOwn(preview, 'companyPrefix'), false);
});

test('loads structured phone data past a blank mobile column', async () => {
  const { request, quote, sent } = savedQuoteFixture({ phone: { number: 15551234042 } });
  const lookup = await (await request({ email: quote.email })).json();
  assert.equal(lookup.contactPreview.phoneLastDigits, '42');
  assert.equal((await request(quote)).status, 200);
  assert.equal(sent[0].answers.phone, '15551234042');
});

test('masks the saved shipping address and sends the complete address only for delivery', async () => {
  const { request, quote, sent } = savedQuoteFixture({ shipping: {
    Line1: '123 Main Street', City: 'Seattle', CountrySubDivisionCode: 'WA', PostalCode: '98101',
  } });
  const lookup = await (await request({ email: quote.email })).json();
  assert.deepEqual(lookup.shippingPreview, { available: true, cityInitial: 'S', stateInitial: 'W', zipCodeLastDigits: '01' });
  quote.useSavedShippingAddress = true;
  quote.savedContactFields = [];
  Object.assign(quote.answers, { first: 'Ana', last: 'Flower', phone: '+1 555 123 0100', orderType: 'pickup' });
  assert.equal((await request(quote)).status, 400);
  assert.equal(sent.length, 0);

  quote.answers.orderType = 'delivery';
  assert.equal((await request(quote)).status, 200);
  const { address, city, state, zip, first } = sent[0].answers;
  assert.deepEqual({ address, city, state, zip, first }, {
    address: '123 Main Street', city: 'Seattle', state: 'WA', zip: '98101', first: 'Ana',
  });

  const incomplete = savedQuoteFixture();
  const response = await incomplete.request(quote);
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { success: false, code: 'SAVED_SHIPPING_UNAVAILABLE' });
  assert.equal(incomplete.sent.length, 0);
});

test('sends saved social details in notes when the live Fresa form has no social field', async () => {
  const { request, quote, sent } = savedQuoteFixture({ hasSocialField: false });
  assert.equal((await request(quote)).status, 200);
  assert.match(sent[0].answers.notes, /Social media profiles \(business\): https:\/\/example\.com\/flowers/);

  quote.savedContactFields = quote.savedContactFields.filter((field) => field !== 'socialMediaProfiles');
  quote.answers.notes = 'Social media profiles (business): https://example.com/manual';
  assert.equal((await request(quote)).status, 200);
  assert.match(sent[1].answers.notes, /example\.com\/manual/);
  assert.doesNotMatch(sent[1].answers.notes, /example\.com\/flowers/);
});

test('quote submission fills contact values at Fresa and honors manual edits without echoing private data', async () => {
  const { request, quote, sent } = savedQuoteFixture();
  quote.answers.first = 'Anita';
  quote.answers.extraField = 'discard';
  quote.answers.unrelatedEmail = 'attacker@example.com';
  quote.answers.price = 0;
  const response = await request(quote);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, taskId: 'created-quote' });
  assert.deepEqual(sent, [{
    answers: {
      email: 'buyer@example.com', vip: true, first: 'Anita', last: 'Flowers', phone: '+57 350 555 0100',
      company: 'Flower Studio', social: 'https://example.com/flowers',
      notes: 'Company: Flower Studio\n\nMorning please', items: [{ id: 'flower' }],
    },
    meta: { source: 'esfenix-product-catalog', timeZone: 'America/Chicago' },
  }]);
});

test('rejects submissions with a different client or form and never forwards upstream private error text', async () => {
  const { request, quote, sent } = savedQuoteFixture({ upstreamStatus: 409 });
  assert.equal((await request({ ...quote, formToken: 'different-form' })).status, 409);
  assert.equal((await request({ ...quote, answers: { ...quote.answers, email: 'other@example.com' } })).status, 400);
  assert.equal(sent.length, 0);
  const response = await request(quote);
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { success: false, code: 'SLOT_FULL' });
});

test('does not disclose the entire phone or submit incomplete required saved contact details', async () => {
  const short = savedQuoteFixture({ phone: '12' });
  const lookup = await (await short.request({ email: short.quote.email })).json();
  assert.equal(lookup.contactPreview.phone, true);
  assert.equal(Object.hasOwn(lookup.contactPreview, 'phoneLastDigits'), false);

  const missing = savedQuoteFixture({ phone: '' });
  const response = await missing.request(missing.quote);
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { success: false, code: 'SAVED_CONTACT_UNAVAILABLE' });
  assert.equal(missing.sent.length, 0);
});
