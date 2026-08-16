'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchJsonSafe, createTtlCache } = require('./local_fetch.js');

test('createTtlCache reuses the first successful value within the TTL', async () => {
  let calls = 0;
  let now = 1_000;
  const cache = createTtlCache({ ttlMs: 5 * 60 * 1000, now: () => now });
  const fetchFn = async () => {
    calls += 1;
    return { servers: [{ id: 'u1' }], count: 1 };
  };
  const first = await cache.get('http://x/unofficial/roster', fetchFn);
  const second = await cache.get('http://x/unofficial/roster', fetchFn);
  assert.equal(calls, 1);
  assert.equal(first.count, 1);
  assert.equal(second, first);
});

test('createTtlCache refetches after the TTL expires', async () => {
  let calls = 0;
  let now = 1_000;
  const cache = createTtlCache({ ttlMs: 5 * 60 * 1000, now: () => now });
  const fetchFn = async () => {
    calls += 1;
    return { count: calls };
  };
  await cache.get('http://x/unofficial/roster', fetchFn);
  now = 1_000 + 5 * 60 * 1000;
  const again = await cache.get('http://x/unofficial/roster', fetchFn);
  assert.equal(calls, 2);
  assert.equal(again.count, 2);
});

test('createTtlCache does not cache a null miss', async () => {
  let calls = 0;
  const cache = createTtlCache({ ttlMs: 60_000, now: () => 1 });
  const fetchFn = async () => {
    calls += 1;
    return null;
  };
  await cache.get('http://x/unofficial/roster', fetchFn);
  await cache.get('http://x/unofficial/roster', fetchFn);
  assert.equal(calls, 2);
});

test('fetchJsonSafe forwards timeoutMs to httpGet', async () => {
  let seen;
  const fakeGet = async (url, opts) => {
    seen = opts;
    return { status: 200, body: '{"ok":true}' };
  };
  const result = await fetchJsonSafe('http://x', { httpGet: fakeGet, timeoutMs: 15000 });
  assert.deepEqual(result, { ok: true });
  assert.equal(seen.timeoutMs, 15000);
});
