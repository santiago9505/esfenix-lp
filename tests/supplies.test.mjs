import assert from 'node:assert/strict';
import test from 'node:test';

import { SUPPLY_ITEMS, SUPPLY_PAGES, normalizeSupplyIds, supplyLabels } from '../src/catalog/data/supplies.js';
import { LOCATIONS, locationOffersSupplies } from '../src/catalog/data/locations.js';
import { createSuppliesInterestStore } from '../src/catalog/core/supplies-interest.js';
import { exclusiveSupplies } from '../src/catalog/app.js';
import { emptyFilters } from '../src/catalog/core/facets.js';
import { buildQuotePayload } from '../src/catalog/core/quote-payload.js';
import { createQuoteIntegration } from '../src/catalog/core/quote-integration.js';
import {
  buildFresaFormSubmission,
  resolveFresaContactFields,
  resolveFresaQuoteAnswerIds,
  SUPPLIES_INQUIRY_ORDER_TYPE,
} from '../src/catalog/core/fresa-form-submission.js';
import { submitQuoteWithSavedContact } from '../worker/src/saved-contact.js';

function formResponse({ productsRequired = false, suppliesField } = {}) {
  return {
    success: true,
    listId: 'esfenix-orders',
    form: {
      enabled: true,
      fields: [
        { id: 'email', label: 'Email', type: 'email' },
        { id: 'vip', label: 'VIP?', type: 'checkbox' },
        { id: 'first', label: 'First Name', type: 'short_text' },
        { id: 'last', label: 'Last Name', type: 'short_text' },
        { id: 'phone', label: 'Phone Number', type: 'phone' },
        { id: 'location', label: 'Location', type: 'select', options: [{ value: 'tx__houston', label: 'TX - HOUSTON' }] },
        {
          id: 'products',
          label: 'Products TX - HOUSTON',
          type: 'catalog_items',
          required: productsRequired,
          actionRules: [{
            enabled: true,
            conditions: [
              { sourceFieldId: 'location', operator: 'equals', value: 'tx__houston' },
              { sourceFieldId: 'vip', operator: 'is_false' },
            ],
          }],
          catalogConfig: {
            items: [{ value: 'fresa-rose-task', label: 'Ecuadorian Roses - 60cm', referenceValues: { stem_price: 0.92 } }],
          },
        },
        { id: 'type', label: 'Type of Order', type: 'select', options: [
          { value: 'delivery', label: 'Delivery' },
          { value: 'pickup', label: 'Pickup' },
          ...(suppliesField === 'multiselect' ? [{ value: 'supplies_inquiry', label: SUPPLIES_INQUIRY_ORDER_TYPE }] : []),
        ] },
        { id: 'delivery', label: 'Delivery', type: 'date' },
        { id: 'pickup', label: 'pickup', type: 'date' },
        { id: 'notes', label: 'Notes for the seller', type: 'long_text' },
        ...(suppliesField ? [{
          id: 'supplies', label: 'Supplies of interest', type: suppliesField,
          options: SUPPLY_ITEMS.map(({ id, label }) => ({ value: id, label })),
        }] : []),
      ],
    },
  };
}

function suppliesPayload(items = []) {
  return buildQuotePayload({
    locationId: 'houston',
    email: 'ana@example.com',
    contact: { firstName: 'Ana', lastName: 'Flower', phone: '+1 713 555 0100' },
    orderType: 'Pickup',
    delivery: { dateTime: '2026-12-04T10:00', timeZone: 'America/Chicago' },
    items,
    suppliesInterest: ['Floral foam', 'Ribbons', 'Floral foam'],
  });
}

const roseLine = {
  id: 'rose-red-60',
  productId: 'ecuadorian-roses',
  sourceProductId: 'fresa-rose-task',
  sourceProductName: 'EC ROSES 60',
  productName: 'Ecuadorian Roses',
  category: 'roses',
  variety: 'Freedom',
  color: 'Red',
  lengthCm: 60,
  measure: 'stem',
  quantity: 25,
};

test('the showcase follows the printed catalog with one supply per photo', () => {
  const ids = SUPPLY_ITEMS.map((item) => item.id);
  const photos = SUPPLY_PAGES.flat().flatMap((group) => group.tiles.map((tile) => tile.item));
  assert.deepEqual([...photos].sort(), [...ids].sort());
  assert.equal(new Set(photos).size, photos.length, 'two photos never share a supply');
  assert.equal(SUPPLY_PAGES.flat().length, 7);
  for (const group of SUPPLY_PAGES.flat()) {
    assert.equal(group.tiles.reduce((sum, tile) => sum + tile.span, 0), 6, group.id);
    const named = group.names.flatMap((entry) => entry.items);
    assert.deepEqual([...named].sort(), group.tiles.map((tile) => tile.item).sort(), group.id);
  }
  const captions = SUPPLY_PAGES.flat().map((group) => group.names.map((entry) => entry.label).join(' | '));
  assert.ok(captions.includes('Flower boxes | Crowns'));
  assert.ok(captions.includes('Stuffed animals | Floral mesh'));
});

test('supply ids are kept once, in catalog order, and unknown ids are dropped', () => {
  assert.deepEqual(normalizeSupplyIds(['ribbons', 'floral-foam', 'ribbons', 'nope']), ['floral-foam', 'ribbons']);
  assert.deepEqual(supplyLabels(['cake-toppers', 'tape']), ['Tape', 'Cake toppers']);
  assert.deepEqual(normalizeSupplyIds(null), []);
  // Selections saved before each photo became its own supply still load.
  assert.deepEqual(normalizeSupplyIds(['stuffed-animals']), ['teddy-bears', 'cow-plush']);
});

test('supplies are offered only for the Texas product list', () => {
  const offering = LOCATIONS.filter((location) => location.offersSupplies).map((location) => location.id);
  assert.deepEqual(offering, ['houston', 'the-woodlands', 'other']);
  assert.equal(locationOffersSupplies('seattle'), false);
  assert.equal(locationOffersSupplies('dmv'), false);
  for (const location of LOCATIONS) {
    assert.equal(location.offersSupplies, location.catalogSource === 'houston', location.id);
  }
});

test('the interest store toggles, removes and clears without touching the quote list', () => {
  const store = createSuppliesInterestStore();
  const seen = [];
  store.subscribe((ids) => seen.push(ids));
  assert.equal(store.toggle('ribbons'), true);
  assert.equal(store.toggle('floral-foam'), true);
  assert.deepEqual(store.getIds(), ['floral-foam', 'ribbons']);
  assert.deepEqual(store.getLabels(), ['Floral foam', 'Ribbons']);
  assert.equal(store.toggle('ribbons'), false);
  store.remove('floral-foam');
  assert.equal(store.count(), 0);
  store.toggle('needle');
  store.clear();
  assert.equal(store.count(), 0);
  store.setMany(['round-flower-box', 'purse-flower-box'], true);
  assert.deepEqual(store.getLabels(), ['Round flower box', 'Purse flower box']);
  store.toggle('purse-flower-box');
  assert.deepEqual(store.getIds(), ['round-flower-box']);
  store.setMany(['round-flower-box', 'purse-flower-box'], false);
  assert.equal(store.count(), 0);
  assert.equal(seen.length, 9);
});

test('Supplies is never combined with product categories', () => {
  const filters = (category, extra = {}) => ({ ...emptyFilters(), ...extra, category });
  // Choosing Supplies while Roses is shown switches to Supplies only.
  assert.deepEqual(exclusiveSupplies(filters(['roses', 'supplies'], { color: ['Red'] }), filters(['roses'])), filters(['supplies']));
  // Choosing Roses while Supplies is shown leaves Supplies.
  assert.deepEqual(exclusiveSupplies(filters(['supplies', 'roses']), filters(['supplies'])).category, ['roses']);
  // A mixed link keeps the product categories.
  assert.deepEqual(exclusiveSupplies(filters(['roses', 'supplies']), null).category, ['roses']);
  // Supplies alone drops filters that only apply to products.
  assert.deepEqual(exclusiveSupplies(filters(['supplies'], { color: ['Red'] }), null), filters(['supplies']));
  assert.deepEqual(exclusiveSupplies(filters(['roses']), filters([])), filters(['roses']));
});

test('the payload carries supplies as names, never as product lines', () => {
  const payload = suppliesPayload();
  assert.deepEqual(payload.suppliesInterest, ['Floral foam', 'Ribbons']);
  assert.deepEqual(payload.products, []);
  assert.deepEqual(payload.fresa.products, []);
  assert.equal(buildQuotePayload({ locationId: 'houston' }).suppliesInterest, undefined);
});

test('a supplies-only request goes to Notes for the seller when Fresa has no supplies field', () => {
  const submission = buildFresaFormSubmission(suppliesPayload(), formResponse());
  assert.deepEqual(submission.answers.products, []);
  assert.match(submission.answers.notes, /Supplies of interest \(more information requested\): Floral foam, Ribbons\./);
});

test('a dedicated Supplies of interest field receives the list instead of the notes', () => {
  const submission = buildFresaFormSubmission(suppliesPayload([roseLine]), formResponse({ suppliesField: 'long_text' }));
  assert.equal(submission.answers.supplies, 'Floral foam, Ribbons');
  assert.equal(submission.answers.products.length, 1);
  assert.doesNotMatch(submission.answers.notes ?? '', /Supplies of interest/);
});

test('a required Fresa product field stops a supplies-only request with a clear code', () => {
  assert.throws(
    () => buildFresaFormSubmission(suppliesPayload(), formResponse({ productsRequired: true })),
    (error) => error.code === 'FRESA_PRODUCTS_REQUIRED',
  );
  const withProducts = buildFresaFormSubmission(suppliesPayload([roseLine]), formResponse({ productsRequired: true }));
  assert.equal(withProducts.answers.products.length, 1);
});

test('labels use configured option values alongside the existing product lines', () => {
  const form = formResponse({ suppliesField: 'multiselect' });
  const payload = suppliesPayload([roseLine]);
  const plainQuote = buildFresaFormSubmission({ ...payload, suppliesInterest: [] }, form);
  const mixedQuote = buildFresaFormSubmission(payload, form);
  assert.deepEqual(mixedQuote.answers, { ...plainQuote.answers, supplies: ['floral-foam', 'ribbons'] });
  assert.equal(mixedQuote.answers.products.length, 1);
});

test('a supply inquiry submits labels without a pickup or delivery reservation', () => {
  const form = formResponse({ suppliesField: 'multiselect' });
  const inquiry = { ...suppliesPayload(), orderType: SUPPLIES_INQUIRY_ORDER_TYPE };
  const { answers } = buildFresaFormSubmission(inquiry, form);
  assert.equal(answers.type, 'supplies_inquiry');
  assert.deepEqual(answers.supplies, ['floral-foam', 'ribbons']);
  assert.deepEqual(answers.products, []);
  assert.equal(Object.hasOwn(answers, 'pickup'), false);
  assert.equal(Object.hasOwn(answers, 'delivery'), false);
  assert.throws(() => buildFresaFormSubmission(inquiry, formResponse()),
    { code: 'FRESA_SUPPLIES_UNAVAILABLE' });
  assert.throws(() => buildFresaFormSubmission({ ...inquiry, suppliesInterest: ['Removed item'] }, form),
    { code: 'FRESA_SUPPLIES_OPTIONS_CHANGED' });
});

test('the public adapter submits a supply inquiry using only form metadata', async () => {
  const form = formResponse({ suppliesField: 'multiselect' });
  delete form.form.fields.find(field => field.id === 'products').catalogConfig.items;
  const inquiry = { ...suppliesPayload(), orderType: SUPPLIES_INQUIRY_ORDER_TYPE };
  const calls = [];
  const integration = createQuoteIntegration({
    formUrl: 'https://example.test/f/quote-test',
    reserveDeliverySlotImpl: () => assert.fail('An availability inquiry must not reserve a slot'),
    fetchImpl: async (url, request) => {
      calls.push(new URL(url).pathname + new URL(url).search);
      if (url.endsWith('?catalog=metadata')) return Response.json(form);
      assert.equal(request.method, 'POST');
      assert.deepEqual(JSON.parse(request.body).answers.supplies, ['floral-foam', 'ribbons']);
      return Response.json({ success: true, taskId: 'test-order' });
    },
  });
  await integration.prepareSubmission(inquiry);
  assert.equal((await integration.start(inquiry)).ok, true);
  assert.deepEqual(calls, ['/api/forms/quote-test?catalog=metadata', '/api/forms/quote-test/submit']);
});

test('saved-contact submissions keep the supplies field answer', async () => {
  const form = formResponse({ suppliesField: 'multiselect' });
  const { fields } = form.form;
  const ids = resolveFresaQuoteAnswerIds(fields, resolveFresaContactFields(fields));
  assert.ok(ids.includes('supplies'));
  const inquiry = { ...suppliesPayload(), orderType: SUPPLIES_INQUIRY_ORDER_TYPE };
  const { answers, meta } = buildFresaFormSubmission(inquiry, form);
  let submitted;
  const result = await submitQuoteWithSavedContact({
    body: { formToken: 'quote-test', savedContactFields: ['firstName'], answers: { ...answers, first: '' }, meta },
    email: inquiry.email,
    client: { found: true, vip: false, profile: { 'First Name': 'Ana' } },
    formUrl: 'https://example.test/f/quote-test',
    fetchImpl: async (url, request) => {
      if (url.endsWith('?catalog=metadata')) return Response.json(form);
      submitted = JSON.parse(request.body).answers;
      return Response.json({ success: true, taskId: 'test-order' });
    },
  });
  assert.equal(result.status, 200);
  assert.deepEqual(submitted, answers);
});
