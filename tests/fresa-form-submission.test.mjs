import assert from 'node:assert/strict';
import test from 'node:test';

import { buildQuotePayload } from '../src/catalog/core/quote-payload.js';
import {
  buildFresaFormSubmission,
  resolveFresaFormApi,
} from '../src/catalog/core/fresa-form-submission.js';

function formResponse() {
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
        { id: 'company', label: 'Company', type: 'short_text' },
        { id: 'social', label: 'Social media profiles (business)', type: 'long_text' },
        { id: 'location', label: 'Location', type: 'select', options: [{ value: 'tx__houston', label: 'TX - HOUSTON' }] },
        catalogField('regular-products', false),
        catalogField('vip-products', true),
        { id: 'type', label: 'Type of Order', type: 'select', options: [
          { value: 'delivery', label: 'Delivery' },
          { value: 'pickup', label: 'Pickup' },
        ] },
        { id: 'delivery', label: 'Delivery', type: 'date' },
        { id: 'address', label: 'Address', type: 'short_text' },
        { id: 'city', label: 'City', type: 'short_text' },
        { id: 'state', label: 'State', type: 'short_text' },
        { id: 'zip', label: 'Zip Code', type: 'short_text' },
        { id: 'pickup', label: 'pickup', type: 'date' },
        { id: 'notes', label: 'Notes for the seller', type: 'long_text' },
      ],
    },
  };
}

function catalogField(id, vip) {
  return {
    id,
    label: `Products TX - HOUSTON${vip ? ' VIP' : ''}`,
    type: 'catalog_items',
    actionRules: [{
      enabled: true,
      conditions: [
        { sourceFieldId: 'location', operator: 'equals', value: 'tx__houston' },
        { sourceFieldId: 'vip', operator: vip ? 'is_true' : 'is_false' },
      ],
    }],
    catalogConfig: {
      items: [{
        value: 'fresa-rose-task',
        label: 'Ecuadorian Roses - 60cm',
        referenceValues: { stem_price: 0.92, bunch_price: 23 },
      }],
    },
  };
}

function payload(vip = false) {
  return buildQuotePayload({
    locationId: 'houston',
    email: 'ana@example.com',
    vip,
    contact: {
      firstName: 'Ana',
      lastName: 'Flower',
      phone: '+57 350 576 5962',
      company: 'Esfenix Test',
      socialMediaProfiles: '@esfenix-test',
    },
    orderType: 'Delivery',
    delivery: {
      dateTime: '2026-08-14T08:00',
      timeZone: 'America/Bogota',
      address: '123 Flower Street',
      city: 'Houston',
      state: 'TX',
      zipCode: '77001',
    },
    items: [{
      id: 'rose-red-60',
      productId: 'ecuadorian-roses',
      sourceProductId: '6bf5f887-207f-448a-97b8-946d8f6f3e5e',
      sourceProductName: 'EC ROSES 60',
      sku: 'RO601000',
      productName: 'Ecuadorian Roses',
      category: 'roses',
      selectedLocation: 'houston',
      serviceCenter: 'HOUSTON',
      variety: 'Freedom',
      color: 'Red',
      lengthCm: 60,
      measure: 'stem',
      quantity: 25,
    }],
  });
}

test('derives the public form API and submit URLs from the shared form URL', () => {
  assert.deepEqual(resolveFresaFormApi('https://fresaai.app/f/abc123'), {
    token: 'abc123',
    formApiUrl: 'https://fresaai.app/api/forms/abc123',
    lookupUrl: 'https://fresaai.app/api/forms/abc123/lookup',
    submitUrl: 'https://fresaai.app/api/forms/abc123/submit',
  });
});

test('maps all contact, delivery and product fields to live Fresa ids', () => {
  const submission = buildFresaFormSubmission(payload(false), formResponse());

  assert.equal(submission.listId, 'esfenix-orders');
  assert.equal(submission.productFieldId, 'regular-products');
  assert.equal(submission.answers.email, 'ana@example.com');
  assert.equal(submission.answers.vip, false);
  assert.equal(submission.answers.first, 'Ana');
  assert.equal(submission.answers.phone, '+57 350 576 5962');
  assert.equal(submission.answers.company, 'Esfenix Test');
  assert.equal(submission.answers.social, '@esfenix-test');
  assert.equal(submission.answers.location, 'tx__houston');
  assert.equal(submission.answers.type, 'delivery');
  assert.equal(submission.answers.delivery, '2026-08-14T08:00');
  assert.equal(submission.answers.address, '123 Flower Street');
  assert.deepEqual(submission.answers['regular-products'], [{
    productId: 'fresa-rose-task',
    quantity: 25,
    size: null,
    measure: 'stem',
    values: {
      __fresa_source_product_id: '6bf5f887-207f-448a-97b8-946d8f6f3e5e',
    },
  }]);
  assert.match(submission.answers.notes, /Company: Esfenix Test/);
  assert.match(submission.answers.notes, /Freedom/);
});

test('keeps social media profiles when the live form has no dedicated field yet', () => {
  const response = formResponse();
  response.form.fields = response.form.fields.filter((field) => field.id !== 'social');

  const submission = buildFresaFormSubmission(payload(false), response);

  assert.match(submission.answers.notes, /Social media profiles \(business\): @esfenix-test/);
});

test('matches a live catalog item by native task id before considering its label', () => {
  const directPayload = payload(false);
  directPayload.fresa.products[0].product = 'A label that is intentionally different';
  const response = formResponse();
  response.form.fields
    .filter((field) => field.type === 'catalog_items')
    .forEach((field) => {
      field.catalogConfig.items[0].value = directPayload.fresa.products[0].sourceProductId;
      field.catalogConfig.items[0].label = 'Canonical Fresa task label';
    });

  const submission = buildFresaFormSubmission(directPayload, response);
  assert.equal(
    submission.answers['regular-products'][0].productId,
    directPayload.fresa.products[0].sourceProductId,
  );
});

test('selects the VIP product field from Fresa visibility rules', () => {
  const submission = buildFresaFormSubmission(payload(true), formResponse());
  assert.equal(submission.productFieldId, 'vip-products');
  assert.equal(submission.answers.vip, true);
  assert.equal(submission.answers['regular-products'], undefined);
  assert.equal(submission.answers['vip-products'][0].productId, 'fresa-rose-task');
});

test('populates every configured Fresa subtask input from the exact catalog line', () => {
  const response = formResponse();
  response.form.fields
    .filter((field) => field.type === 'catalog_items')
    .forEach((field) => {
      field.catalogConfig.lineInputs = [
        { id: 'api-source-id', label: 'Source Product ID', type: 'text', targetFieldId: 'item-id' },
        { id: 'api-product-name', label: 'Product Name', type: 'text', targetFieldId: 'product-name' },
        { id: 'api-sku', label: 'Product SKU', type: 'text', targetFieldId: 'product-sku' },
        { id: 'api-unit-price', label: 'Unit Price', type: 'number', targetFieldId: 'product-price' },
        { id: 'api-quantity', label: 'Quantity', type: 'number', targetFieldId: 'quantity' },
        { id: 'api-measure', label: 'Measure', type: 'text', targetFieldId: 'measure' },
      ];
    });

  const submission = buildFresaFormSubmission(payload(false), response);
  assert.deepEqual(submission.answers['regular-products'][0].values, {
    __fresa_source_product_id: '6bf5f887-207f-448a-97b8-946d8f6f3e5e',
    'api-source-id': '6bf5f887-207f-448a-97b8-946d8f6f3e5e',
    'api-product-name': 'EC ROSES 60',
    'api-sku': 'RO601000',
    'api-unit-price': 0.92,
    'api-quantity': 25,
    'api-measure': 'stem',
  });
});

test('stops before creating a partial Fresa subtask when a configured value is missing', () => {
  const response = formResponse();
  response.form.fields
    .filter((field) => field.type === 'catalog_items')
    .forEach((field) => {
      field.catalogConfig.lineInputs = [
        { id: 'api-sku', label: 'Product SKU', type: 'text', targetFieldId: 'product-sku', required: true },
      ];
    });
  const missingSku = payload(false);
  delete missingSku.fresa.products[0].sku;

  assert.throws(
    () => buildFresaFormSubmission(missingSku, response),
    /cannot populate Product SKU/i,
  );
});

test('stops before submission when a requested product cannot create a Fresa subtask', () => {
  const response = formResponse();
  response.form.fields
    .filter((field) => field.type === 'catalog_items')
    .forEach((field) => { field.catalogConfig.items = []; });

  assert.throws(
    () => buildFresaFormSubmission(payload(false), response),
    /not available in the selected Fresa list/i,
  );
});

test('stops before submission when the selected measure is not available in Fresa', () => {
  const invalid = payload(false);
  invalid.fresa.products[0].measure = 'unit';

  assert.throws(
    () => buildFresaFormSubmission(invalid, formResponse()),
    /must be one of: stem, bunch/i,
  );
});

test('reports the live Fresa minimum before sending an invalid quantity', () => {
  const response = formResponse();
  response.form.fields
    .filter((field) => field.type === 'catalog_items')
    .forEach((field) => { field.catalogConfig.items[0].minimumQuantity = 30; });

  assert.throws(
    () => buildFresaFormSubmission(payload(false), response),
    /minimum quantity.*is 30/i,
  );
});
