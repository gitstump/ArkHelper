'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const {
  openDb,
  upsertAccount,
  persistAlertCycle,
  insertAlertEvent,
  listAlertEventsForAccount,
  listPendingAlertEvents,
  upsertAccountWebhook,
  getAccountWebhook,
  insertAlertDelivery,
  listAlertDeliveries,
} = require('./db.js');
const {
  validateWebhookUrl,
  buildBatchMessage,
  dispatchPending,
  TEST_WEBHOOK_MESSAGE,
  WEBHOOK_DISABLED_MESSAGE,
} = require('./alert_dispatch.js');

const GOOD_URL = 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwx';
const T0 = '2026-08-17T12:00:00.000Z';
const ORIGIN = 'https://arkhelper.info';

function fresh() {
  const db = openDb(':memory:');
  const account = upsertAccount(db, { discordId: '1', username: 'brian' });
  return { db, account };
}

function insertEvent(db, accountId, overrides = {}) {
  return insertAlertEvent(db, {
    accountId,
    serverId: 's1',
    serverName: 'NA-PVE-GenOne6433',
    kind: 'down',
    message: 'NA-PVE-GenOne6433 went offline.',
    createdAt: T0,
    ...overrides,
  });
}

function stubPost(handler) {
  const calls = [];
  const postFn = async (url, content) => {
    calls.push({ url, content });
    if (typeof handler === 'function') return handler(url, content, calls);
    return handler || { status: 204, ok: true };
  };
  return { calls, postFn };
}

test('validateWebhookUrl accepts the canonical Discord webhook form', () => {
  assert.equal(validateWebhookUrl(GOOD_URL), GOOD_URL);
  assert.equal(validateWebhookUrl(`  ${GOOD_URL}  `), GOOD_URL);
  assert.equal(validateWebhookUrl(`${GOOD_URL}/`), GOOD_URL);
});

test('validateWebhookUrl rejects http, other hosts, and subdomain tricks', () => {
  assert.equal(validateWebhookUrl('http://discord.com/api/webhooks/1/token'), null);
  assert.equal(validateWebhookUrl('https://example.com/api/webhooks/1/token'), null);
  assert.equal(validateWebhookUrl('https://discord.com.evil.com/api/webhooks/1/token'), null);
  assert.equal(validateWebhookUrl('https://evil.discord.com/api/webhooks/1/token'), null);
  assert.equal(validateWebhookUrl('https://canary.discord.com/api/webhooks/1/token'), null);
  assert.equal(validateWebhookUrl('https://discordapp.com/api/webhooks/1/token'), null);
});

test('validateWebhookUrl rejects credentials, ports, query strings, and non-webhook paths', () => {
  assert.equal(validateWebhookUrl('https://user:pass@discord.com/api/webhooks/1/token'), null);
  assert.equal(validateWebhookUrl('https://discord.com:443/api/webhooks/1/token'), null);
  assert.equal(validateWebhookUrl('https://discord.com:8443/api/webhooks/1/token'), null);
  assert.equal(validateWebhookUrl(`${GOOD_URL}?wait=true`), null);
  assert.equal(validateWebhookUrl('https://discord.com/api/webhooks'), null);
  assert.equal(validateWebhookUrl('https://discord.com/api/v10/webhooks/1/token'), null);
  assert.equal(validateWebhookUrl('https://discord.com/oauth2/authorize'), null);
  assert.equal(validateWebhookUrl('not a url'), null);
  assert.equal(validateWebhookUrl(''), null);
  assert.equal(validateWebhookUrl(null), null);
});

test('send-time revalidation: a tampered DB row never reaches postFn', async () => {
  const { db, account } = fresh();
  db.prepare(
    `INSERT INTO account_webhooks (account_id, url, enabled, consecutive_failures, created_at, updated_at)
     VALUES (?, ?, 1, 0, ?, ?)`
  ).run(account.id, 'https://evil.example/steal', T0, T0);
  insertEvent(db, account.id);
  const { calls, postFn } = stubPost();
  await dispatchPending({ db, postFn, origin: ORIGIN, now: T0 });
  assert.equal(calls.length, 0);
  assert.equal(listPendingAlertEvents(db).length, 0);
  const deliveries = listAlertDeliveries(db, account.id);
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].ok, false);
  assert.equal(deliveries[0].detail, 'rejected_url');
});

test('multi-event account is one postFn call with the batch message', async () => {
  const { db, account } = fresh();
  upsertAccountWebhook(db, account.id, GOOD_URL, { now: T0 });
  insertEvent(db, account.id, { message: 'first went offline.', createdAt: T0 });
  insertEvent(db, account.id, { kind: 'online', message: 'first is back online.', createdAt: '2026-08-17T12:01:00.000Z' });
  const { calls, postFn } = stubPost();
  await dispatchPending({ db, postFn, origin: ORIGIN, now: '2026-08-17T12:02:00.000Z' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, GOOD_URL);
  assert.equal(
    calls[0].content,
    ['ArkHelper alerts:', '- first went offline.', '- first is back online.', `${ORIGIN}/alerts`].join('\n')
  );
  assert.equal(listPendingAlertEvents(db).length, 0);
  assert.equal(listAlertDeliveries(db, account.id).length, 1);
  assert.equal(listAlertDeliveries(db, account.id)[0].eventCount, 2);
  assert.equal(listAlertDeliveries(db, account.id)[0].ok, true);
});

test('buildBatchMessage truncates a long list and appends an and-N-more line', () => {
  const events = [];
  for (let i = 0; i < 80; i += 1) {
    events.push({ message: `server-${String(i).padStart(2, '0')} went offline with a fairly long status line.` });
  }
  const msg = buildBatchMessage(events, ORIGIN);
  assert.ok(msg.length <= 1900);
  assert.match(msg, /^ArkHelper alerts:/);
  assert.match(msg, /and \d+ more \(see https:\/\/arkhelper\.info\/alerts\)/);
  assert.match(msg, /https:\/\/arkhelper\.info\/alerts$/m);
  assert.ok(!msg.includes('server-79 went offline'));
});

test('events are marked dispatched on success and on failure', async () => {
  const { db, account } = fresh();
  upsertAccountWebhook(db, account.id, GOOD_URL, { now: T0 });
  insertEvent(db, account.id, { message: 'ok event' });
  const ok = stubPost({ status: 204, ok: true });
  await dispatchPending({ db, postFn: ok.postFn, origin: ORIGIN, now: T0 });
  assert.equal(listPendingAlertEvents(db).length, 0);

  insertEvent(db, account.id, { message: 'fail event', createdAt: '2026-08-17T12:03:00.000Z' });
  const fail = stubPost({ status: 500, ok: false });
  await dispatchPending({ db, postFn: fail.postFn, origin: ORIGIN, now: '2026-08-17T12:04:00.000Z' });
  assert.equal(listPendingAlertEvents(db).length, 0);
  assert.equal(listAlertEventsForAccount(db, account.id).length, 2);
});

test('accounts with no enabled webhook are marked dispatched with no delivery row', async () => {
  const { db, account } = fresh();
  insertEvent(db, account.id);
  const { calls, postFn } = stubPost();
  await dispatchPending({ db, postFn, origin: ORIGIN, now: T0 });
  assert.equal(calls.length, 0);
  assert.equal(listPendingAlertEvents(db).length, 0);
  assert.equal(listAlertDeliveries(db, account.id).length, 0);
});

test('disabled webhook is treated like no webhook: dispatched, no delivery, no post', async () => {
  const { db, account } = fresh();
  upsertAccountWebhook(db, account.id, GOOD_URL, { now: T0 });
  db.prepare('UPDATE account_webhooks SET enabled = 0 WHERE account_id = ?').run(account.id);
  insertEvent(db, account.id);
  const { calls, postFn } = stubPost();
  await dispatchPending({ db, postFn, origin: ORIGIN, now: T0 });
  assert.equal(calls.length, 0);
  assert.equal(listAlertDeliveries(db, account.id).length, 0);
  assert.equal(listPendingAlertEvents(db).length, 0);
});

test('pre-existing backfilled events never dispatch', async () => {
  const { db, account } = fresh();
  upsertAccountWebhook(db, account.id, GOOD_URL, { now: T0 });
  persistAlertCycle(db, {
    events: [
      {
        accountId: account.id,
        serverId: 's1',
        serverName: 'Srv',
        kind: 'down',
        message: 'old history',
        createdAt: '2026-08-01T00:00:00.000Z',
        dispatchedAt: '2026-08-01T00:00:00.000Z',
      },
    ],
    stateUpdates: [],
  });
  const { calls, postFn } = stubPost();
  await dispatchPending({ db, postFn, origin: ORIGIN, now: T0 });
  assert.equal(calls.length, 0);
  assert.equal(listAlertDeliveries(db, account.id).length, 0);
});

test('openDb backfills dispatched_at on legacy alert_events so old feed rows never dispatch', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkhelper-'));
  const file = path.join(dir, 'legacy.db');
  try {
    const legacy = new DatabaseSync(file);
    legacy.exec(`
      CREATE TABLE accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        discord_id TEXT UNIQUE NOT NULL,
        discord_username TEXT,
        discord_avatar TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE alert_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL,
        server_id TEXT NOT NULL,
        server_name TEXT NOT NULL,
        kind TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL,
        read_at TEXT
      );
    `);
    legacy
      .prepare(
        'INSERT INTO accounts (discord_id, discord_username, discord_avatar, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run('legacy', 'brian', null, T0, T0);
    legacy
      .prepare(
        'INSERT INTO alert_events (account_id, server_id, server_name, kind, message, created_at, read_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(1, 's1', 'Srv', 'down', 'old event', '2026-08-10T00:00:00.000Z', null);
    legacy.close();

    const db = openDb(file);
    const row = db.prepare('SELECT dispatched_at, created_at FROM alert_events').get();
    assert.equal(row.dispatched_at, '2026-08-10T00:00:00.000Z');
    upsertAccountWebhook(db, 1, GOOD_URL, { now: T0 });
    const { calls, postFn } = stubPost();
    await dispatchPending({ db, postFn, origin: ORIGIN, now: T0 });
    assert.equal(calls.length, 0);
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('three 404s disable the webhook and insert a dispatched system event that is never posted', async () => {
  const { db, account } = fresh();
  upsertAccountWebhook(db, account.id, GOOD_URL, { now: T0 });
  const { calls, postFn } = stubPost({ status: 404, ok: false });

  for (let i = 0; i < 3; i += 1) {
    insertEvent(db, account.id, { message: `fail ${i}`, createdAt: `2026-08-17T12:0${i}:00.000Z` });
    await dispatchPending({ db, postFn, origin: ORIGIN, now: `2026-08-17T12:1${i}:00.000Z` });
  }

  assert.equal(calls.length, 3);
  const webhook = getAccountWebhook(db, account.id);
  assert.equal(webhook.enabled, false);
  assert.equal(webhook.consecutiveFailures, 3);

  const events = listAlertEventsForAccount(db, account.id);
  const system = events.find((e) => e.kind === 'system');
  assert.ok(system);
  assert.equal(system.serverId, '');
  assert.equal(system.serverName, 'ArkHelper');
  assert.equal(system.message, WEBHOOK_DISABLED_MESSAGE);
  assert.equal(system.dispatchedAt, '2026-08-17T12:12:00.000Z');
  assert.ok(calls.every((c) => !c.content.includes('disabled after repeated failures')));
  assert.equal(listPendingAlertEvents(db).length, 0);
});

test('401 and 403 count toward the disable ladder like 404', async () => {
  const { db, account } = fresh();
  upsertAccountWebhook(db, account.id, GOOD_URL, { now: T0 });
  insertEvent(db, account.id, { message: 'a' });
  await dispatchPending({
    db,
    postFn: stubPost({ status: 401, ok: false }).postFn,
    origin: ORIGIN,
    now: T0,
  });
  insertEvent(db, account.id, { message: 'b', createdAt: '2026-08-17T12:01:00.000Z' });
  await dispatchPending({
    db,
    postFn: stubPost({ status: 403, ok: false }).postFn,
    origin: ORIGIN,
    now: '2026-08-17T12:01:00.000Z',
  });
  assert.equal(getAccountWebhook(db, account.id).consecutiveFailures, 2);
  assert.equal(getAccountWebhook(db, account.id).enabled, true);
});

test('429 and 5xx never increment consecutive_failures or disable', async () => {
  const { db, account } = fresh();
  upsertAccountWebhook(db, account.id, GOOD_URL, { now: T0 });
  insertEvent(db, account.id, { message: '429' });
  await dispatchPending({
    db,
    postFn: stubPost({ status: 429, ok: false }).postFn,
    origin: ORIGIN,
    now: T0,
  });
  insertEvent(db, account.id, { message: '500', createdAt: '2026-08-17T12:01:00.000Z' });
  await dispatchPending({
    db,
    postFn: stubPost({ status: 500, ok: false }).postFn,
    origin: ORIGIN,
    now: '2026-08-17T12:01:00.000Z',
  });
  insertEvent(db, account.id, { message: '503', createdAt: '2026-08-17T12:02:00.000Z' });
  await dispatchPending({
    db,
    postFn: stubPost({ status: 503, ok: false }).postFn,
    origin: ORIGIN,
    now: '2026-08-17T12:02:00.000Z',
  });
  const webhook = getAccountWebhook(db, account.id);
  assert.equal(webhook.consecutiveFailures, 0);
  assert.equal(webhook.enabled, true);
  assert.equal(listAlertDeliveries(db, account.id).length, 3);
  assert.ok(listAlertDeliveries(db, account.id).every((d) => d.ok === false));
});

test('network errors record a delivery row and do not increment failures', async () => {
  const { db, account } = fresh();
  upsertAccountWebhook(db, account.id, GOOD_URL, { now: T0 });
  insertEvent(db, account.id);
  const postFn = async () => {
    throw new Error('fetch failed');
  };
  await dispatchPending({ db, postFn, origin: ORIGIN, now: T0 });
  const webhook = getAccountWebhook(db, account.id);
  assert.equal(webhook.consecutiveFailures, 0);
  assert.equal(webhook.enabled, true);
  const deliveries = listAlertDeliveries(db, account.id);
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].ok, false);
  assert.equal(deliveries[0].statusCode, null);
  assert.equal(deliveries[0].detail, 'fetch failed');
  assert.equal(listPendingAlertEvents(db).length, 0);
});

test('2xx resets the consecutive_failures counter', async () => {
  const { db, account } = fresh();
  upsertAccountWebhook(db, account.id, GOOD_URL, { now: T0 });
  insertEvent(db, account.id, { message: 'fail' });
  await dispatchPending({
    db,
    postFn: stubPost({ status: 404, ok: false }).postFn,
    origin: ORIGIN,
    now: T0,
  });
  assert.equal(getAccountWebhook(db, account.id).consecutiveFailures, 1);

  insertEvent(db, account.id, { message: 'ok', createdAt: '2026-08-17T12:01:00.000Z' });
  await dispatchPending({
    db,
    postFn: stubPost({ status: 204, ok: true }).postFn,
    origin: ORIGIN,
    now: '2026-08-17T12:01:00.000Z',
  });
  assert.equal(getAccountWebhook(db, account.id).consecutiveFailures, 0);
  assert.equal(getAccountWebhook(db, account.id).enabled, true);
});

test('two accounts batch independently — one postFn call each', async () => {
  const { db, account } = fresh();
  const other = upsertAccount(db, { discordId: '2', username: 'other' });
  upsertAccountWebhook(db, account.id, GOOD_URL, { now: T0 });
  upsertAccountWebhook(db, other.id, `${GOOD_URL}z`, { now: T0 });
  insertEvent(db, account.id, { message: 'alice event' });
  insertEvent(db, other.id, { message: 'bob event' });
  const { calls, postFn } = stubPost();
  await dispatchPending({ db, postFn, origin: ORIGIN, now: T0 });
  assert.equal(calls.length, 2);
  assert.ok(calls.some((c) => c.content.includes('alice event')));
  assert.ok(calls.some((c) => c.content.includes('bob event')));
});

test('delivery rows are recorded and rows older than 14 days are pruned on insert', () => {
  const { db, account } = fresh();
  insertAlertDelivery(
    db,
    {
      accountId: account.id,
      eventCount: 1,
      statusCode: 204,
      ok: true,
      detail: null,
      createdAt: '2026-08-01T00:00:00.000Z',
    },
    { now: '2026-08-01T00:00:00.000Z' }
  );
  assert.equal(listAlertDeliveries(db, account.id).length, 1);

  insertAlertDelivery(
    db,
    {
      accountId: account.id,
      eventCount: 2,
      statusCode: 204,
      ok: true,
      detail: null,
      createdAt: '2026-08-17T12:00:00.000Z',
    },
    { now: '2026-08-17T12:00:00.000Z' }
  );
  const rows = listAlertDeliveries(db, account.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].eventCount, 2);
  assert.equal(rows[0].createdAt, '2026-08-17T12:00:00.000Z');
});

test('upsertAccountWebhook replaces the URL, re-enables, and zeroes failures', () => {
  const { db, account } = fresh();
  upsertAccountWebhook(db, account.id, GOOD_URL, { now: T0 });
  db.prepare('UPDATE account_webhooks SET enabled = 0, consecutive_failures = 3 WHERE account_id = ?').run(account.id);
  const next = 'https://discord.com/api/webhooks/9/newtokenvaluehere';
  const saved = upsertAccountWebhook(db, account.id, next, { now: '2026-08-17T13:00:00.000Z' });
  assert.equal(saved.url, next);
  assert.equal(saved.enabled, true);
  assert.equal(saved.consecutiveFailures, 0);
});

test('TEST_WEBHOOK_MESSAGE is a fixed non-empty string', () => {
  assert.equal(typeof TEST_WEBHOOK_MESSAGE, 'string');
  assert.ok(TEST_WEBHOOK_MESSAGE.length > 0);
});
