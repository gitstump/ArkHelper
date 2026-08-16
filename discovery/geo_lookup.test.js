'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openCountryDb, lookupCountry, enrichServersWithCountry } = require('./geo_lookup.js');

function fakeReader(responsesByIp) {
  return {
    get(ip) {
      if (!(ip in responsesByIp)) return null;
      const entry = responsesByIp[ip];
      if (entry === 'THROW') throw new Error('simulated malformed IP');
      return entry;
    },
  };
}

// ---------------------------------------------------------------------
// openCountryDb
// ---------------------------------------------------------------------
test('openCountryDb calls the injected open function with the given path', async () => {
  let capturedPath;
  const fakeOpen = async (path) => {
    capturedPath = path;
    return { get: () => null };
  };
  await openCountryDb('/some/path/GeoLite2-Country.mmdb', { openFn: fakeOpen });
  assert.equal(capturedPath, '/some/path/GeoLite2-Country.mmdb');
});

test('openCountryDb throws a clear error when no path is given', async () => {
  await assert.rejects(() => openCountryDb(undefined, { openFn: async () => ({}) }), /no database path/);
});

// ---------------------------------------------------------------------
// lookupCountry
// ---------------------------------------------------------------------
test('lookupCountry returns code and name for a matched IP', () => {
  const reader = fakeReader({
    '8.8.8.8': { country: { iso_code: 'US', names: { en: 'United States' } } },
  });
  const result = lookupCountry(reader, '8.8.8.8');
  assert.deepEqual(result, { code: 'US', name: 'United States' });
});

test('lookupCountry returns null when the IP has no match', () => {
  const reader = fakeReader({});
  assert.equal(lookupCountry(reader, '203.0.113.1'), null);
});

test('lookupCountry returns null when the result has no country record', () => {
  const reader = fakeReader({ '10.0.0.1': { traits: { is_anonymous_proxy: true } } });
  assert.equal(lookupCountry(reader, '10.0.0.1'), null);
});

test('lookupCountry swallows a throwing reader instead of crashing', () => {
  const reader = fakeReader({ 'not-an-ip': 'THROW' });
  assert.doesNotThrow(() => lookupCountry(reader, 'not-an-ip'));
  assert.equal(lookupCountry(reader, 'not-an-ip'), null);
});

test('lookupCountry handles a null reader or missing ip gracefully', () => {
  assert.equal(lookupCountry(null, '8.8.8.8'), null);
  assert.equal(lookupCountry(fakeReader({}), null), null);
  assert.equal(lookupCountry(fakeReader({}), ''), null);
});

test('lookupCountry falls back to null name when names.en is missing', () => {
  const reader = fakeReader({ '1.1.1.1': { country: { iso_code: 'AU' } } });
  const result = lookupCountry(reader, '1.1.1.1');
  assert.equal(result.code, 'AU');
  assert.equal(result.name, null);
});

// ---------------------------------------------------------------------
// enrichServersWithCountry
// ---------------------------------------------------------------------
test('enrichServersWithCountry adds country fields without dropping servers', () => {
  const reader = fakeReader({
    '1.1.1.1': { country: { iso_code: 'US', names: { en: 'United States' } } },
  });
  const servers = [
    { id: '1', ip: '1.1.1.1' },
    { id: '2', ip: '203.0.113.1' }, // no match in fake reader
    { id: '3', ip: null }, // no IP at all
  ];
  const enriched = enrichServersWithCountry(servers, reader);
  assert.equal(enriched.length, 3);
  assert.equal(enriched[0].country, 'US');
  assert.equal(enriched[0].countryName, 'United States');
  assert.equal(enriched[1].country, null);
  assert.equal(enriched[2].country, null);
});

test('enrichServersWithCountry does not mutate the original server objects', () => {
  const reader = fakeReader({ '1.1.1.1': { country: { iso_code: 'US', names: { en: 'United States' } } } });
  const original = { id: '1', ip: '1.1.1.1' };
  const [enriched] = enrichServersWithCountry([original], reader);
  assert.equal(original.country, undefined);
  assert.equal(enriched.country, 'US');
});

test('enrichServersWithCountry works on an empty list', () => {
  assert.deepEqual(enrichServersWithCountry([], fakeReader({})), []);
});
