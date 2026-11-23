import assert from 'node:assert/strict';
import test from 'node:test';
import { productCardSpecs } from '../src/catalog/ui/product-card.js';

const variant = (fields) => ({ variety: null, color: null, lengthCm: null, availableMeasures: ['stem', 'bunch'], ...fields });

test('roses show the variety count and the stem length range', () => {
  const product = { variants: [
    variant({ variety: 'Freedom', lengthCm: 50 }),
    variant({ variety: 'Freedom', lengthCm: 100 }),
    variant({ variety: 'Explorer', lengthCm: 70 }),
    variant({ variety: 'Mondial', lengthCm: 60 }),
  ] };
  assert.deepEqual(productCardSpecs(product), [['Varieties', '3'], ['Length', '50–100 cm'], ['Sold by', 'Stem · Bunch']]);
});

test('a single length and a few short variety names are shown as they are', () => {
  assert.deepEqual(productCardSpecs({ variants: [variant({ variety: 'Black', lengthCm: 60 })] }), [['Varieties', 'Black'], ['Length', '60 cm'], ['Sold by', 'Stem · Bunch']]);
  assert.deepEqual(
    productCardSpecs({ variants: [variant({ variety: 'Jumbo', availableMeasures: ['stem'] }), variant({ variety: 'Large', availableMeasures: ['stem'] })] }),
    [['Varieties', 'Jumbo · Large'], ['Sold by', 'Stem']],
  );
});

test('flowers without varieties show their options and how they are sold', () => {
  const tulip = { variants: ['White', 'Red', 'Pink'].map((color) => variant({ color, availableMeasures: ['bunch'] })) };
  assert.deepEqual(productCardSpecs(tulip), [['Options', '3'], ['Sold by', 'Bunch']]);
  assert.deepEqual(productCardSpecs({ variants: [variant({ availableMeasures: ['bunch'] })] }), [['Sold by', 'Bunch']]);
});

test('the list holds at most three facts and never mentions colours', () => {
  const product = { variants: [variant({ variety: 'A', color: 'Red', lengthCm: 40 }), variant({ variety: 'B', color: 'White', lengthCm: 60 }), variant({ variety: 'C', color: 'Pink', lengthCm: 60 })] };
  const specs = productCardSpecs(product);
  assert.equal(specs.length, 3);
  assert.ok(specs.every(([label]) => !/colou?r/i.test(label)));
});
