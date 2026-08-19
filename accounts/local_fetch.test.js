'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  fetchJsonSafe,
  createTtlCache,
  LOCAL_FETCH_TIMEOUT_FAST_MS,
  LOCAL_FETCH_TIMEOUT_HEAVY_MS,
  LOCAL_FETCH_TIMEOUT_BACKGROUND_MS,
  UNOFFICIAL_ROSTER_CACHE_TTL_MS,
  OFFICIAL_ROSTER_CACHE_TTL_MS,
} = require('./local_fetch.js');

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

test('OFFICIAL_ROSTER_CACHE_TTL_MS is five minutes', () => {
  assert.equal(OFFICIAL_ROSTER_CACHE_TTL_MS, 5 * 60 * 1000);
  assert.equal(UNOFFICIAL_ROSTER_CACHE_TTL_MS, 5 * 60 * 1000);
});

test('createTtlCache on the official roster URL does not cache a null miss', async () => {
  let calls = 0;
  const cache = createTtlCache({ ttlMs: OFFICIAL_ROSTER_CACHE_TTL_MS, now: () => 1_000 });
  const fetchFn = async () => {
    calls += 1;
    return null;
  };
  await cache.get('http://localhost:8792/roster', fetchFn);
  await cache.get('http://localhost:8792/roster', fetchFn);
  assert.equal(calls, 2);
});

test('fetchJsonSafe default budget is FAST and explicit budgets are honored', async () => {
  const seen = [];
  const httpGet = async (_url, opts) => {
    seen.push(opts && opts.timeoutMs);
    return { status: 200, body: '{"ok":true}' };
  };
  const first = await fetchJsonSafe('http://x/default-budget', { httpGet });
  await fetchJsonSafe('http://x/heavy-budget', { httpGet, timeoutMs: LOCAL_FETCH_TIMEOUT_HEAVY_MS });
  await fetchJsonSafe('http://x/background-budget', { httpGet, timeoutMs: LOCAL_FETCH_TIMEOUT_BACKGROUND_MS });
  assert.deepEqual(first, { ok: true });
  assert.equal(LOCAL_FETCH_TIMEOUT_FAST_MS, 3000);
  assert.equal(LOCAL_FETCH_TIMEOUT_HEAVY_MS, 8000);
  assert.equal(LOCAL_FETCH_TIMEOUT_BACKGROUND_MS, 15000);
  assert.deepEqual(seen, [
    LOCAL_FETCH_TIMEOUT_FAST_MS,
    LOCAL_FETCH_TIMEOUT_HEAVY_MS,
    LOCAL_FETCH_TIMEOUT_BACKGROUND_MS,
  ]);
});

test('fetchJsonSafe logs each failure reason once with url and ms and never logs bodies', async () => {
  const logs = [];
  const log = { warn: (msg) => logs.push(msg) };
  let t = 0;
  const now = () => t;

  t = 0;
  await fetchJsonSafe('http://x/fail-timeout', {
    httpGet: async () => {
      t = 25;
      throw new Error('timeout fetching http://x/fail-timeout');
    },
    log,
    now,
  });

  t = 0;
  await fetchJsonSafe('http://x/fail-http', {
    httpGet: async () => {
      t = 12;
      return { status: 502, body: 'secret-body' };
    },
    log,
    now,
  });

  t = 0;
  await fetchJsonSafe('http://x/fail-parse', {
    httpGet: async () => {
      t = 3;
      return { status: 200, body: '{not json' };
    },
    log,
    now,
  });

  t = 0;
  await fetchJsonSafe('http://x/fail-net', {
    httpGet: async () => {
      t = 7;
      const err = new Error('connect ECONNREFUSED');
      err.code = 'ECONNREFUSED';
      throw err;
    },
    log,
    now,
  });

  assert.equal(logs.length, 4);
  assert.equal(logs[0], '[local-fetch] timeout http://x/fail-timeout after 25ms');
  assert.equal(logs[1], '[local-fetch] http_502 http://x/fail-http after 12ms');
  assert.equal(logs[2], '[local-fetch] parse_error http://x/fail-parse after 3ms');
  assert.equal(logs[3], '[local-fetch] network_ECONNREFUSED http://x/fail-net after 7ms');
  assert.doesNotMatch(logs.join('\n'), /secret-body/);
  assert.doesNotMatch(logs.join('\n'), /not json/);
});

test('identical reason+url logs are suppressed within 60s and logged again after', async () => {
  const logs = [];
  let t = 1_000;
  const opts = {
    httpGet: async () => ({ status: 503, body: 'hidden-body' }),
    log: { warn: (msg) => logs.push(msg) },
    now: () => t,
  };
  const url = 'http://x/rate-limit-unique';
  await fetchJsonSafe(url, opts);
  await fetchJsonSafe(url, opts);
  t = 1_000 + 59_999;
  await fetchJsonSafe(url, opts);
  assert.equal(logs.length, 1);
  assert.equal(logs[0], '[local-fetch] http_503 http://x/rate-limit-unique after 0ms');
  t = 1_000 + 60_000;
  await fetchJsonSafe(url, opts);
  assert.equal(logs.length, 2);
  assert.equal(logs[1], logs[0]);
  assert.doesNotMatch(logs.join('\n'), /hidden-body/);
});

test('slow success warns above half the budget and not at or below', async () => {
  const logs = [];
  const log = { warn: (msg) => logs.push(msg) };
  const budget = LOCAL_FETCH_TIMEOUT_HEAVY_MS;
  const half = budget / 2;

  let t = 0;
  await fetchJsonSafe('http://x/slow-below', {
    timeoutMs: budget,
    httpGet: async () => {
      t = half - 1;
      return { status: 200, body: '{"ok":true}' };
    },
    log,
    now: () => t,
  });
  t = 0;
  await fetchJsonSafe('http://x/slow-at', {
    timeoutMs: budget,
    httpGet: async () => {
      t = half;
      return { status: 200, body: '{"ok":true}' };
    },
    log,
    now: () => t,
  });
  assert.equal(logs.length, 0);

  t = 0;
  const result = await fetchJsonSafe('http://x/slow-above', {
    timeoutMs: budget,
    httpGet: async () => {
      t = half + 1;
      return { status: 200, body: '{"ok":true}' };
    },
    log,
    now: () => t,
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(logs.length, 1);
  assert.equal(logs[0], `[local-fetch] slow http://x/slow-above ${half + 1}ms (budget ${budget}ms)`);
});

test('fetchJsonSafe returns null and never throws on every failure path', async () => {
  const silent = { warn() {} };
  const now = () => 1;
  const paths = [
    {
      url: 'http://x/nothrow-timeout',
      httpGet: async () => {
        throw new Error('timeout fetching http://x/nothrow-timeout');
      },
    },
    {
      url: 'http://x/nothrow-http',
      httpGet: async () => ({ status: 404, body: '{}' }),
    },
    {
      url: 'http://x/nothrow-parse',
      httpGet: async () => ({ status: 200, body: 'nope' }),
    },
    {
      url: 'http://x/nothrow-net',
      httpGet: async () => {
        const err = new Error('ECONNRESET');
        err.code = 'ECONNRESET';
        throw err;
      },
    },
  ];
  for (const path of paths) {
    const result = await fetchJsonSafe(path.url, { httpGet: path.httpGet, log: silent, now });
    assert.equal(result, null);
  }
});
