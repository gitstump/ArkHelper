'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const {
  CURSEFORGE_MODS_URL,
  fetchModsBatch,
  normalizeMod,
  realHttpPost,
} = require('./curseforge_api.js');

const FAKE_KEY = 'cf-test-key-not-real';

function assertNoKey(err) {
  const text = err && err.message ? err.message : String(err);
  assert.doesNotMatch(text, new RegExp(FAKE_KEY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}

test('fetchModsBatch POSTs the documented batch shape without leaking the key in errors', async () => {
  let captured;
  const rows = await fetchModsBatch({
    apiKey: FAKE_KEY,
    modIds: [928793, 947033],
    httpPost: async (url, opts) => {
      captured = { url, opts };
      return {
        status: 200,
        body: JSON.stringify({
          data: [
            {
              id: 928793,
              name: 'Super Structures',
              summary: 'Build.',
              authors: [{ name: 'Splus' }],
              downloadCount: 123456,
              logo: { thumbnailUrl: 'https://media.forgecdn.net/avatars/thumb.png' },
              links: { websiteUrl: 'https://www.curseforge.com/ark-survival-ascended/mods/splus' },
            },
          ],
        }),
      };
    },
  });
  assert.equal(captured.url, CURSEFORGE_MODS_URL);
  assert.equal(captured.opts.headers['Content-Type'], 'application/json');
  assert.equal(captured.opts.headers.Accept, 'application/json');
  assert.equal(captured.opts.headers['x-api-key'], FAKE_KEY);
  assert.deepEqual(JSON.parse(captured.opts.body), { modIds: [928793, 947033] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 928793);
  assert.equal(rows[0].name, 'Super Structures');
  assert.equal(rows[0].author, 'Splus');
  assert.equal(rows[0].downloadCount, 123456);
  assert.equal(rows[0].logoUrl, 'https://media.forgecdn.net/avatars/thumb.png');
  assert.equal(rows[0].websiteUrl, 'https://www.curseforge.com/ark-survival-ascended/mods/splus');
});

test('normalizeMod treats every field as optional', () => {
  assert.deepEqual(normalizeMod({}), {
    id: null,
    name: null,
    summary: null,
    author: null,
    downloadCount: null,
    logoUrl: null,
    websiteUrl: null,
  });
  const partial = normalizeMod({ id: 1, name: 'Only name', authors: [{}], logo: {}, links: {} });
  assert.equal(partial.id, 1);
  assert.equal(partial.name, 'Only name');
  assert.equal(partial.author, null);
  assert.equal(partial.logoUrl, null);
  assert.equal(partial.websiteUrl, null);
});

test('fetchModsBatch timeout and parse failures never include the key', async () => {
  await assert.rejects(
    () =>
      fetchModsBatch({
        apiKey: FAKE_KEY,
        modIds: [1],
        httpPost: async () => {
          throw new Error(`boom ${FAKE_KEY}`);
        },
      }),
    (err) => {
      assertNoKey(err);
      assert.match(err.message, /CurseForge mods request failed/);
      return true;
    }
  );
  await assert.rejects(
    () =>
      fetchModsBatch({
        apiKey: FAKE_KEY,
        modIds: [1],
        httpPost: async () => ({ status: 200, body: '{not json' }),
      }),
    (err) => {
      assertNoKey(err);
      return true;
    }
  );
  await assert.rejects(
    () =>
      fetchModsBatch({
        apiKey: FAKE_KEY,
        modIds: [1],
        httpPost: async () => ({ status: 403, body: 'nope' }),
      }),
    (err) => {
      assertNoKey(err);
      assert.match(err.message, /HTTP 403/);
      return true;
    }
  );
});

test('fetchModsBatch rejects a body over the byte cap', async () => {
  await assert.rejects(
    () =>
      fetchModsBatch({
        apiKey: FAKE_KEY,
        modIds: [1],
        maxBytes: 8,
        httpPost: async () => ({ status: 200, body: '{"data":[]}' }),
      }),
    (err) => {
      assertNoKey(err);
      assert.match(err.message, /byte cap/);
      return true;
    }
  );
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('x'.repeat(2000));
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  await assert.rejects(
    () =>
      realHttpPost(`http://127.0.0.1:${port}/`, {
        body: '{}',
        timeoutMs: 2000,
        maxBytes: 100,
      }),
    /byte cap/
  );
  server.close();
});
