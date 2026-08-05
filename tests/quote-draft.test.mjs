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
});

afterEach(resetBrowserEnv);

test('a quote draft survives a new read and keeps the entered form state', () => {
  draft.writeQuoteDraft({
    step: 4,
    email: 'ana@example.com',
    recognized: false,
    clientLookup: 'not-found',
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
    clientLookup: 'not-found',
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
});

test('clearing a quote draft removes it without affecting storage availability', () => {
  draft.writeQuoteDraft({ email: 'ana@example.com' });
  draft.clearQuoteDraft();
  assert.equal(draft.readQuoteDraft(), null);
});

test('malformed draft values are normalized to safe form defaults', () => {
  env.storage.setItem('esfenix.catalog.quote-draft', JSON.stringify({ step: 99, orderType: 'Unknown', contact: { firstName: 42 } }));

  assert.deepEqual(draft.readQuoteDraft(), {
    step: 5,
    email: '',
    recognized: false,
    clientLookup: 'idle',
    contact: { firstName: '', lastName: '', phone: '', company: '' },
    orderType: 'Delivery',
    delivery: { dateTime: '', address: '', city: '', state: '', zipCode: '' },
    notes: '',
  });
});

