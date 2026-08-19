import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeCatalog } from '../src/catalog/core/fresa-catalog.js';
import {
  DELIVERY_MINIMUM_CENTS,
  getQuotePricing,
  priceToCents,
} from '../src/catalog/core/pricing.js';

const columns = [
  { list_id: 'flowers', key: 'type_product', field_name: 'type_product', field_type: 'select' },
  { list_id: 'flowers', key: 'sales_unit', field_name: 'sales_unit', field_type: 'select' },
  { list_id: 'flowers', key: 'stem_price', field_name: 'stem_price', field_type: 'currency' },
  { list_id: 'flowers', key: 'bunch_price', field_name: 'bunch_price', field_type: 'currency' },
];

function productWithPrices() {
  return normalizeCatalog({
    catalog: {
      columns,
      products: [{
        id: 'rose-1',
        listId: 'flowers',
        listName: 'Products',
        name: 'Roses',
        fields: {
          type_product: 'Roses',
          sales_unit: 'Stem',
          stem_price: 0.84,
          bunch_price: '',
        },
      }],
    },
  })[0];
}

test('Fresa prices are serialized as cents only for populated measures', () => {
  const product = productWithPrices();
  const variant = product.locations[0].variants[0];

  assert.deepEqual(variant.availableMeasures, ['stem']);
  assert.deepEqual(variant.prices, { stem: 84 });
  assert.equal(JSON.stringify(product).includes('bunch_price'), false);
});

test('delivery is enabled only when the priced total reaches $150', () => {
  const product = productWithPrices();
  const item = {
    productId: product.id,
    productName: product.name,
    variety: null,
    color: null,
    lengthCm: null,
    measure: 'stem',
    quantity: 180,
  };

  const pricing = getQuotePricing([item], [{
    id: product.id,
    variants: product.locations[0].variants,
  }]);
  assert.equal(pricing.totalCents, 15120);
  assert.equal(pricing.deliveryProgress, 100);
  assert.equal(pricing.deliveryAllowed, true);

  const justBelowMinimum = getQuotePricing([{ ...item, quantity: 178 }], [{
    id: product.id,
    variants: product.locations[0].variants,
  }]);
  assert.equal(justBelowMinimum.totalCents, 14952);
  assert.equal(justBelowMinimum.deliveryProgress, 99);
  assert.equal(justBelowMinimum.deliveryAllowed, false);

  const underMinimum = getQuotePricing([{ ...item, quantity: 100 }], [{
    id: product.id,
    variants: product.locations[0].variants,
  }]);
  assert.equal(underMinimum.totalCents, 8400);
  assert.equal(underMinimum.deliveryProgress, 56);
  assert.equal(underMinimum.deliveryAllowed, false);
  assert.equal(DELIVERY_MINIMUM_CENTS, 15000);
});

test('an empty metric price is treated as unavailable and keeps the order on pickup', () => {
  const product = productWithPrices();
  const pricing = getQuotePricing([{
    productId: product.id,
    productName: product.name,
    variety: null,
    color: null,
    lengthCm: null,
    measure: 'bunch',
    quantity: 20,
  }], [{ id: product.id, variants: product.locations[0].variants }]);

  assert.equal(pricing.hasUnknownPricing, true);
  assert.equal(pricing.deliveryProgress, 0);
  assert.equal(pricing.deliveryAllowed, false);
  assert.equal(priceToCents(''), null);
  assert.equal(priceToCents('$1.25'), 125);
});
