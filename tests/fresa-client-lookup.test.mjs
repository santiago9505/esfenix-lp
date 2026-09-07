import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FresaClientLookupError,
  lookupActiveClientByEmail,
} from '../functions/src/client-lookup.js';

const LIST_ID = 'clients-list';
const EMAIL_FIELD_ID = 'email-field';
const ACTIVE_FIELD_ID = 'active-field';

function task({ email, active = true, name = 'Cesar Ricaurte', description = '', statusCanonical = 'ACTIVA' }) {
  return {
    task_id: `${email}-task`,
    list_id: LIST_ID,
    name,
    status_canonical: statusCanonical,
    description,
    custom_fields: {
      [EMAIL_FIELD_ID]: { id: EMAIL_FIELD_ID, key: 'email_mr11h9d', name: 'email', value: email },
      [ACTIVE_FIELD_ID]: { id: ACTIVE_FIELD_ID, key: 'activo_mr11h8dn', name: 'activo', value: active },
      'vip-field': { id: 'vip-field', key: 'vip_mr3xfzz', name: 'VIP?', value: true },
    },
  };
}

function page(tasks, hasMore = false, nextOffset = null) {
  return { success: true, tasks, page: { hasMore, nextOffset } };
}

test('finds a live active client across pages and returns only the quote profile', async () => {
  const calls = [];
  const result = await lookupActiveClientByEmail(' FREDDY@FRESAAI.COM ', {
    apiUrl: 'https://fresaai.app/api/public/v1/tasks',
    apiKey: 'server-only-key',
    expectedListId: LIST_ID,
    emailFieldId: EMAIL_FIELD_ID,
    activeFieldId: ACTIVE_FIELD_ID,
    fetchImpl: async (url, options) => {
      calls.push({ url: new URL(url), options });
      return {
        ok: true,
        status: 200,
        json: async () => calls.length === 1
          ? page([task({ email: 'other@example.com', active: false })], true, 200)
          : page([task({
              email: 'freddy@fresaai.com',
              description: '## Full invocation JSON\n```json\n{"quickbooks":{"entity":{"GivenName":"Cesar","FamilyName":"Ricaurte","CompanyName":"GFT","PrimaryPhone":{"FreeFormNumber":"+57 350 576 59 62"}}}}\n```',
            })]),
      };
    },
  });

  assert.equal(result.found, true);
  assert.equal(result.vip, true);
  assert.equal(result.taskId, 'freddy@fresaai.com-task');
  assert.deepEqual(result.profile, {
    'First Name': 'Cesar',
    'Last Name': 'Ricaurte',
    'Phone Number': '+57 350 576 59 62',
    Company: 'GFT',
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.searchParams.get('listId'), LIST_ID);
  assert.equal(calls[0].url.searchParams.get('statusCanonical'), 'ACTIVA');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.match(calls[0].options.headers.Authorization, /^Bearer server-only-key$/);
});

test('consults Fresa again instead of reusing a client directory cache', async () => {
  let requestCount = 0;
  const result = await lookupActiveClientByEmail('new@example.com', {
    apiUrl: 'https://fresaai.app/api/public/v1/tasks',
    apiKey: 'server-only-key',
    expectedListId: LIST_ID,
    emailFieldId: EMAIL_FIELD_ID,
    activeFieldId: ACTIVE_FIELD_ID,
    fetchImpl: async () => {
      requestCount += 1;
      return {
        ok: true,
        status: 200,
        json: async () => page([task({ email: requestCount === 1 ? 'new@example.com' : 'changed@example.com' })]),
      };
    },
  });
  assert.equal(result.found, true);

  const next = await lookupActiveClientByEmail('new@example.com', {
    apiUrl: 'https://fresaai.app/api/public/v1/tasks',
    apiKey: 'server-only-key',
    expectedListId: LIST_ID,
    emailFieldId: EMAIL_FIELD_ID,
    activeFieldId: ACTIVE_FIELD_ID,
    fetchImpl: async () => {
      requestCount += 1;
      return { ok: true, status: 200, json: async () => page([task({ email: 'changed@example.com' })]) };
    },
  });
  assert.equal(next.found, false);
  assert.equal(requestCount, 2);
});

test('does not trust a task returned from another Fresa list', async () => {
  await assert.rejects(
    () => lookupActiveClientByEmail('client@example.com', {
      apiUrl: 'https://fresaai.app/api/public/v1/tasks',
      apiKey: 'server-only-key',
      expectedListId: LIST_ID,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => page([{ ...task({ email: 'client@example.com' }), list_id: 'wrong-list' }]),
      }),
    }),
    (error) => error instanceof FresaClientLookupError && error.status === 502,
  );
});
