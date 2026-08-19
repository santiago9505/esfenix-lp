import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

import { createStorage, installBrowserEnv, resetBrowserEnv } from './helpers/browser-env.mjs';

let env;
let draft;

beforeEach(async () => {
  env = installBrowserEnv({ storage: createStorage() });
  draft = await import('../src/catalog/core/quote-draft.js');
  const storage = await import('../src/catalog/core/storage.js');
  storage.resetStorageProbe();
  const sessionStorage = await import('../src/catalog/core/session-storage.js');
  sessionStorage.resetSessionStorageProbe();
});

afterEach(resetBrowserEnv);

test('a quote draft survives a new read and keeps the entered form state', () => {
  draft.writeQuoteDraft({
    step: 4,
    email: 'ana@example.com',
    recognized: false,
    vip: false,
    clientLookup: 'not-found',
    phoneCountry: 'US',
    contact: { firstName: 'Ana', lastName: 'Flower', phone: '5550100', company: 'Flowers Inc.' },
    orderType: 'Pickup',
    delivery: {
      dateTime: '2026-08-08T12:00',
      address: '123 Flower Street',
      city: 'Houston',
      state: 'TX',
      zipCode: '77001',
    },
    notes: 'Please call before delivery.',
  });

  assert.deepEqual(draft.readQuoteDraft(), {
    step: 4,
    email: 'ana@example.com',
    recognized: false,
    vip: false,
    clientLookup: 'not-found',
    phoneCountry: 'US',
    contact: { firstName: 'Ana', lastName: 'Flower', phone: '5550100', company: 'Flowers Inc.' },
    orderType: 'Pickup',
    delivery: {
      dateTime: '2026-08-08T12:00',
      address: '123 Flower Street',
      city: 'Houston',
      state: 'TX',
      zipCode: '77001',
    },
    notes: 'Please call before delivery.',
  });
  assert.equal(env.storage.length, 0, 'personal data is never written to localStorage');
  assert.equal(env.sessionStorage.length, 1, 'the resumable draft is scoped to this tab');
});

test('clearing a quote draft removes it without affecting storage availability', () => {
  draft.writeQuoteDraft({ email: 'ana@example.com' });
  draft.clearQuoteDraft();
  assert.equal(draft.readQuoteDraft(), null);
});

test('malformed draft values are normalized to safe form defaults', () => {
  env.sessionStorage.setItem('esfenix.session.quote-draft', JSON.stringify({
    expiresAt: Date.now() + 60_000,
    value: { step: 99, orderType: 'Unknown', contact: { firstName: 42 } },
  }));

  assert.deepEqual(draft.readQuoteDraft(), {
    step: 5,
    email: '',
    recognized: false,
    vip: false,
    clientLookup: 'idle',
    phoneCountry: 'US',
    contact: { firstName: '', lastName: '', phone: '', company: '' },
    orderType: 'Delivery',
    delivery: { dateTime: '', address: '', city: '', state: '', zipCode: '' },
    notes: '',
  });
});
