import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FresaClientLookupError,
  lookupActiveClientByEmail,
} from '../worker/src/client-lookup.js';
import { handleRequest } from '../worker/src/index.js';

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
  assert.equal(data.profile['First Name'], 'Cesar');
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
