import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COUNTRY_CALLING_CODES,
  DEFAULT_COUNTRY,
  DEFAULT_COUNTRY_CODE,
  dialCodeForCountry,
  formatInternationalPhone,
  splitPhoneNumber,
} from '../src/catalog/data/country-calling-codes.js';

test('the country selector includes every country/territory entry and defaults to the United States', () => {
  assert.equal(COUNTRY_CALLING_CODES.length, 249);
  assert.equal(COUNTRY_CALLING_CODES[0].code, DEFAULT_COUNTRY);
  assert.equal(dialCodeForCountry(DEFAULT_COUNTRY), DEFAULT_COUNTRY_CODE);
  assert.ok(COUNTRY_CALLING_CODES.every(({ code, name, dialCode }) => code && name && /^\+\d+$/.test(dialCode)));
  assert.equal(new Set(COUNTRY_CALLING_CODES.map(({ code }) => code)).size, COUNTRY_CALLING_CODES.length);
});

test('international phone values are split and rebuilt without duplicating their calling code', () => {
  assert.deepEqual(splitPhoneNumber('+57 350 576 5962'), {
    countryCode: 'CO',
    dialCode: '+57',
    nationalNumber: '350 576 5962',
  });
  assert.equal(formatInternationalPhone('+57', '350 576 5962'), '+57 350 576 5962');
  assert.equal(formatInternationalPhone('+1', '+1 555 0100'), '+1 555 0100');
});
