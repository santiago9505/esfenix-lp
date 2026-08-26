import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertNoPricing,
  buildQuotePayload,
  buildQuoteSummaryText,
} from '../src/catalog/core/quote-payload.js';
import { FRESA_FORM } from '../src/catalog/data/fresa-form.js';
import { resolveFresaProduct } from '../src/catalog/core/fresa-mapping.js';

/**
 * @param {Partial<import('../src/catalog/core/types').QuoteItem>} overrides
 */
function line(overrides = {}) {
  return {
    id: 'x',
    productId: 'sunflowers',
    productName: 'Sunflowers',
    category: 'other-flowers',
    selectedLocation: 'seattle',
    serviceCenter: 'SEATTLE',
    variety: null,
    color: null,
    lengthCm: null,
    measure: 'bunch',
    quantity: 5,
    ...overrides,
  };
}

test('the payload matches the agreed shape', () => {
  const payload = buildQuotePayload({ locationId: 'seattle', items: [line()] });

  assert.equal(payload.source, 'esfenix-product-catalog');
  assert.equal(payload.selectedLocation, 'SEATTLE');
  assert.equal(payload.serviceCenter, 'SEATTLE');
  assert.equal(payload.email, '');
  assert.equal(payload.orderType, null);
  assert.equal(payload.notes, '');
  assert.deepEqual(payload.delivery, { address: '', city: '', state: '', zipCode: '' });
  assert.deepEqual(payload.products, [
    {
      productId: 'sunflowers',
      productName: 'Sunflowers',
      category: 'other-flowers',
      variety: null,
      color: null,
      lengthCm: null,
      quantity: 5,
      measure: 'bunch',
    },
  ]);
});

test('the internal quote form carries contact, order and delivery details', () => {
  const payload = buildQuotePayload({
    locationId: 'houston',
    items: [],
    email: 'new@example.com',
    contact: {
      firstName: 'Ana',
      lastName: 'Flower',
      phone: '5550100',
      company: 'Example Flowers',
      socialMediaProfiles: '@exampleflowers',
    },
    orderType: 'Delivery',
    delivery: {
      dateTime: '2026-08-08T12:00',
      address: '123 Flower Street',
      city: 'Houston',
      state: 'TX',
      zipCode: '77001',
    },
    notes: 'Please call before delivery.',
  });

  assert.deepEqual(payload.contact, {
    firstName: 'Ana',
    lastName: 'Flower',
    phone: '5550100',
    company: 'Example Flowers',
    socialMediaProfiles: '@exampleflowers',
  });
  assert.equal(payload.orderType, 'Delivery');
  assert.equal(payload.deliveryDateTime, '2026-08-08T12:00');
  assert.equal(payload.delivery.address, '123 Flower Street');
  assert.equal(payload.fresa.orderType, 'Delivery');
  assert.equal(payload.fresa.delivery.dateTime, '2026-08-08T12:00');
});

test('the selected country calling code is included once in the phone payload', () => {
  const payload = buildQuotePayload({
    locationId: 'houston',
    contact: {
      firstName: 'Ana',
      lastName: 'Flower',
      phone: '350 576 5962',
      company: '',
      socialMediaProfiles: '',
    },
    phoneCountryCode: '+57',
  });

  assert.equal(payload.contact.phone, '+57 350 576 5962');
});

test('delivery metadata preserves the customer timezone and slot capacity', () => {
  const payload = buildQuotePayload({
    locationId: 'houston',
    orderType: 'Delivery',
    delivery: {
      dateTime: '2026-08-10T08:00',
      timeZone: 'America/Bogota',
      slot: { date: '2026-08-10', start: '08:00', end: '10:00', capacity: 2 },
    },
  });

  assert.equal(payload.deliveryTimeZone, 'America/Bogota');
  assert.deepEqual(payload.deliverySlot, {
    date: '2026-08-10',
    start: '08:00',
    end: '10:00',
    capacity: 2,
  });
  assert.equal(payload.delivery.timeZone, 'America/Bogota');
  assert.equal(payload.fresa.delivery.slot.capacity, 2);
});

test('the payload carries no pricing of any kind', () => {
  const payload = buildQuotePayload({
    locationId: 'houston',
    items: [line({ selectedLocation: 'houston', serviceCenter: 'HOUSTON' })],
  });
  assert.equal(assertNoPricing(payload), true);

  const json = JSON.stringify(payload);
  for (const forbidden of ['price', 'total', 'subtotal', 'currency', 'discount', 'tax']) {
    assert.ok(!json.includes(`"${forbidden}"`), `${forbidden} must not be in the payload`);
  }
  assert.ok(!/[$€£]/.test(json), 'no currency symbols');
});

test('assertNoPricing is what stops a price ever reaching the form', () => {
  assert.throws(() => assertNoPricing({ products: [{ price: 1.2 }] }), /pricing field/i);
  assert.throws(() => assertNoPricing({ total: 10 }), /pricing field/i);
});

test('Other U.S. location keeps its own identity while Houston serves it', () => {
  const payload = buildQuotePayload({
    locationId: 'other',
    items: [],
    shippingDestination: { state: 'FL', city: 'Miami', zipCode: '33101' },
  });

  assert.equal(payload.selectedLocation, 'OTHER');
  assert.equal(payload.serviceCenter, 'HOUSTON');
  assert.equal(payload.fresa.location, 'NATION WIDE');
  assert.deepEqual(payload.delivery, { address: '', city: 'Miami', state: 'FL', zipCode: '33101' });
});

test('a request with no products is marked as coming from the website', () => {
  const payload = buildQuotePayload({ locationId: 'houston', items: [] });
  assert.equal(payload.source, 'esfenix-website');
  assert.deepEqual(payload.products, []);
  assert.deepEqual(payload.fresa.products, [], 'the form is left for the visitor to fill in');
});

test('the location maps to the option the form actually offers', () => {
  const expected = {
    houston: 'TX - HOUSTON',
    'the-woodlands': 'TX - THE WOODLANDS',
    seattle: 'WA - SEATTLE',
    dmv: 'DMV',
    other: 'NATION WIDE',
  };
  for (const [id, label] of Object.entries(expected)) {
    const payload = buildQuotePayload({ locationId: id, items: [] });
    assert.equal(payload.fresa.location, label);
  }
});

test('rose lines resolve to the length-qualified option', () => {
  const { option } = resolveFresaProduct(
    'houston',
    { id: 'ecuadorian-roses', name: 'Ecuadorian Roses' },
    { id: 'v', variety: 'Freedom', color: 'Red', lengthCm: 60, availableMeasures: ['stem'] },
  );
  assert.equal(option, 'Ecuadorian Roses - 60cm');
});

test('the same product is spelled per location', () => {
  const variant = { id: 'v', variety: null, color: null, lengthCm: null, availableMeasures: ['bunch'] };
  const houston = resolveFresaProduct('houston', { id: 'solidago', name: 'Solidago' }, variant);
  const seattle = resolveFresaProduct('seattle', { id: 'solidago', name: 'Solidago' }, variant);

  assert.equal(houston.option, 'Solidago golden glory');
  assert.equal(seattle.option, 'Solidago');
});

test('colour is folded into the option label where the form expects it', () => {
  const white = resolveFresaProduct(
    'houston',
    { id: 'peony', name: 'Peony' },
    { id: 'v', color: 'White', lengthCm: null, availableMeasures: ['stem'] },
  );
  const other = resolveFresaProduct(
    'houston',
    { id: 'peony', name: 'Peony' },
    { id: 'v', color: 'Pink', lengthCm: null, availableMeasures: ['stem'] },
  );
  assert.equal(white.option, 'Peony - white');
  assert.equal(other.option, 'Peony - other colors');
});

test('every resolved option is one the form really lists', () => {
  const houstonOptions = new Set(FRESA_FORM.productOptions.houston);
  const { option } = resolveFresaProduct(
    'the-woodlands',
    { id: 'carnation', name: 'Carnation' },
    { id: 'v', color: 'Red', lengthCm: null, availableMeasures: ['stem'] },
  );
  assert.ok(houstonOptions.has(option), 'The Woodlands uses the Houston product list');
});

test('lines that collapse to one form option are merged, and the detail is kept in the notes', () => {
  const payload = buildQuotePayload({
    locationId: 'houston',
    items: [
      line({
        id: 'a',
        productId: 'ecuadorian-roses',
        productName: 'Ecuadorian Roses',
        category: 'roses',
        selectedLocation: 'houston',
        serviceCenter: 'HOUSTON',
        variety: 'Freedom',
        color: 'Red',
        lengthCm: 60,
        measure: 'stem',
        quantity: 25,
      }),
      line({
        id: 'b',
        productId: 'ecuadorian-roses',
        productName: 'Ecuadorian Roses',
        category: 'roses',
        selectedLocation: 'houston',
        serviceCenter: 'HOUSTON',
        variety: 'Vendela',
        color: 'White',
        lengthCm: 60,
        measure: 'stem',
        quantity: 15,
      }),
    ],
  });

  // Rows with the same Fresa product and measure are safely consolidated.
  assert.deepEqual(payload.fresa.products, [{
    product: 'Ecuadorian Roses - 60cm',
    quantity: 40,
    measure: 'stem',
  }]);

  // Nothing is lost: the breakdown moves to the field that can hold it.
  assert.match(payload.fresa.notes, /Freedom/);
  assert.match(payload.fresa.notes, /Vendela/);
  assert.match(payload.fresa.notes, /25 ×/);
  assert.match(payload.fresa.notes, /15 ×/);

  // And the catalog's own representation still has both lines in full.
  assert.equal(payload.products.length, 2);
});

test('different native product tasks create separate subtask rows even when their labels match', () => {
  const payload = buildQuotePayload({
    locationId: 'houston',
    items: [
      line({
        id: 'freedom',
        productId: 'ecuadorian-roses',
        sourceProductId: '11111111-1111-4111-8111-111111111111',
        productName: 'Ecuadorian Roses',
        category: 'roses',
        selectedLocation: 'houston',
        serviceCenter: 'HOUSTON',
        variety: 'Freedom',
        lengthCm: 60,
        measure: 'stem',
        quantity: 25,
      }),
      line({
        id: 'vendela',
        productId: 'ecuadorian-roses',
        sourceProductId: '22222222-2222-4222-8222-222222222222',
        productName: 'Ecuadorian Roses',
        category: 'roses',
        selectedLocation: 'houston',
        serviceCenter: 'HOUSTON',
        variety: 'Vendela',
        lengthCm: 60,
        measure: 'stem',
        quantity: 25,
      }),
    ],
  });

  assert.deepEqual(payload.fresa.products, [
    {
      product: 'Ecuadorian Roses - 60cm',
      quantity: 25,
      measure: 'stem',
      sourceProductId: '11111111-1111-4111-8111-111111111111',
    },
    {
      product: 'Ecuadorian Roses - 60cm',
      quantity: 25,
      measure: 'stem',
      sourceProductId: '22222222-2222-4222-8222-222222222222',
    },
  ]);
  assert.match(payload.fresa.notes, /Freedom/);
  assert.match(payload.fresa.notes, /Vendela/);
});

test('products the form does not list are reported and described in the notes', () => {
  const payload = buildQuotePayload({
    locationId: 'dmv',
    items: [
      line({
        productId: 'made-up',
        productName: 'Made Up Flower',
        selectedLocation: 'dmv',
        serviceCenter: 'DMV',
        quantity: 3,
      }),
    ],
  });

  assert.deepEqual(payload.fresa.products, [], 'nothing invented for the form');
  assert.equal(payload.fresa.unmappedProducts.length, 1);
  assert.match(payload.fresa.notes, /Made Up Flower/);
  assert.match(payload.fresa.notes, /not listed in this form/i);
});

test('the copyable summary is complete and price-free', () => {
  const payload = buildQuotePayload({
    locationId: 'seattle',
    items: [line({ variety: null, color: null, quantity: 5 })],
  });
  const text = buildQuoteSummaryText(payload);

  assert.match(text, /Esfenix — quote request/);
  assert.match(text, /WA - SEATTLE/);
  assert.match(text, /5 × Sunflowers/);
  assert.match(text, /No payment will be collected/);
  assert.ok(!/[$€£]/.test(text), 'no currency in the summary');
});
