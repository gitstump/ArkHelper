'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeCountryCode,
  flagEmoji,
  regionLabel,
  countryDisplayName,
  getDistinctCountries,
} = require('./country.js');

const US_FLAG = '\u{1F1FA}\u{1F1F8}';
const DE_FLAG = '\u{1F1E9}\u{1F1EA}';

test('flagEmoji derives regional-indicator pairs from a valid ISO code', () => {
  assert.equal(flagEmoji('US'), US_FLAG);
  assert.equal(flagEmoji('DE'), DE_FLAG);
});

test('flagEmoji accepts lowercase input', () => {
  assert.equal(flagEmoji('us'), US_FLAG);
  assert.equal(flagEmoji(' de '), DE_FLAG);
});

test('flagEmoji returns empty for absent or invalid codes', () => {
  assert.equal(flagEmoji(null), '');
  assert.equal(flagEmoji(undefined), '');
  assert.equal(flagEmoji(''), '');
  assert.equal(flagEmoji('USA'), '');
  assert.equal(flagEmoji('1A'), '');
  assert.equal(flagEmoji(12), '');
});

test('normalizeCountryCode uppercases a 2-letter code and rejects everything else', () => {
  assert.equal(normalizeCountryCode('de'), 'DE');
  assert.equal(normalizeCountryCode('US'), 'US');
  assert.equal(normalizeCountryCode(null), null);
  assert.equal(normalizeCountryCode('Germany'), null);
});

test('regionLabel is flag plus ISO code, or an em-dash when absent', () => {
  assert.equal(regionLabel('DE'), `${DE_FLAG} DE`);
  assert.equal(regionLabel('us'), `${US_FLAG} US`);
  assert.equal(regionLabel(null), '\u2014');
  assert.equal(regionLabel(''), '\u2014');
});

test('countryDisplayName prefers countryName and falls back to the ISO code', () => {
  assert.equal(countryDisplayName({ country: 'DE', countryName: 'Germany' }), 'Germany');
  assert.equal(countryDisplayName({ country: 'de' }), 'DE');
  assert.equal(countryDisplayName({ countryName: 'Germany' }), null);
  assert.equal(countryDisplayName(null), null);
});

test('getDistinctCountries is unique by code and alphabetical by name', () => {
  const countries = getDistinctCountries([
    { country: 'US', countryName: 'United States' },
    { country: 'de', countryName: 'Germany' },
    { country: 'US', countryName: 'United States' },
    { country: null },
    { country: 'FR' },
  ]);
  assert.deepEqual(
    countries.map((c) => c.code),
    ['FR', 'DE', 'US']
  );
  assert.deepEqual(
    countries.map((c) => c.name),
    ['FR', 'Germany', 'United States']
  );
});

test('getDistinctCountries ignores empty input and nameless rows', () => {
  assert.deepEqual(getDistinctCountries(null), []);
  assert.deepEqual(getDistinctCountries([{ map: 'TheIsland_WP' }]), []);
});
