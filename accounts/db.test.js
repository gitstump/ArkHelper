'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  openDb,
  upsertAccount,
  getAccountById,
  createSession,
  getAccountBySessionToken,
  deleteSession,
  deleteExpiredSessions,
  addFavorite,
  removeFavorite,
  listFavorites,
  upsertAlertSettings,
  getAlertSettings,
  listAlertSettingsForAccount,
} = require('./db.js');

function freshDb() {
  return openDb(':memory:');
}

// ---------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------
test('upsertAccount creates a new account on first call', () => {
  const db = freshDb();
  const account = upsertAccount(db, { discordId: '123', username: 'brian', avatar: 'abc.png' });
  assert.equal(account.discord_id, '123');
  assert.equal(account.discord_username, 'brian');
  assert.equal(account.discord_avatar, 'abc.png');
  assert.ok(account.id);
});

test('upsertAccount updates an existing account instead of duplicating it', () => {
  const db = freshDb();
  const first = upsertAccount(db, { discordId: '123', username: 'brian', avatar: 'old.png' });
  const second = upsertAccount(db, { discordId: '123', username: 'brian_new', avatar: 'new.png' });
  assert.equal(first.id, second.id); // same row, not a new one
  assert.equal(second.discord_username, 'brian_new');
  assert.equal(second.discord_avatar, 'new.png');

  const all = db.prepare('SELECT COUNT(*) as count FROM accounts').get();
  assert.equal(all.count, 1);
});

test('upsertAccount throws a clear error without a discordId', () => {
  const db = freshDb();
  assert.throws(() => upsertAccount(db, { username: 'no-id' }), /discordId is required/);
});

test('getAccountById returns null for a nonexistent account', () => {
  const db = freshDb();
  assert.equal(getAccountById(db, 9999), null);
});

test('getAccountById finds an account that exists', () => {
  const db = freshDb();
  const created = upsertAccount(db, { discordId: '123', username: 'brian' });
  const found = getAccountById(db, created.id);
  assert.equal(found.discord_id, '123');
});

// ---------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------
test('createSession generates a token and getAccountBySessionToken resolves it', () => {
  const db = freshDb();
  const account = upsertAccount(db, { discordId: '123', username: 'brian' });
  const session = createSession(db, account.id);
  assert.ok(session.token.length > 20); // real random hex token, not a placeholder

  const resolved = getAccountBySessionToken(db, session.token);
  assert.equal(resolved.discord_id, '123');
});

test('getAccountBySessionToken returns null for an unknown token', () => {
  const db = freshDb();
  assert.equal(getAccountBySessionToken(db, 'totally-made-up-token'), null);
});

test('getAccountBySessionToken returns null for a null/undefined token', () => {
  const db = freshDb();
  assert.equal(getAccountBySessionToken(db, null), null);
  assert.equal(getAccountBySessionToken(db, undefined), null);
});

test('getAccountBySessionToken returns null once the session has expired', () => {
  const db = freshDb();
  const account = upsertAccount(db, { discordId: '123' });
  const fakeNow = () => 1_000_000;
  const session = createSession(db, account.id, { ttlMs: 1000, now: fakeNow });

  // Still valid right up to expiry
  assert.ok(getAccountBySessionToken(db, session.token, { now: () => 1_000_999 }));
  // Expired the instant it hits expiresAt
  assert.equal(getAccountBySessionToken(db, session.token, { now: () => 1_001_000 }), null);
});

test('createSession token is unique across multiple calls', () => {
  const db = freshDb();
  const account = upsertAccount(db, { discordId: '123' });
  const s1 = createSession(db, account.id);
  const s2 = createSession(db, account.id);
  assert.notEqual(s1.token, s2.token);
});

test('deleteSession removes a session and returns true, false if it never existed', () => {
  const db = freshDb();
  const account = upsertAccount(db, { discordId: '123' });
  const session = createSession(db, account.id);

  assert.equal(deleteSession(db, session.token), true);
  assert.equal(getAccountBySessionToken(db, session.token), null);
  assert.equal(deleteSession(db, session.token), false); // already gone
});

test('deleteExpiredSessions removes only expired sessions and reports the count', () => {
  const db = freshDb();
  const account = upsertAccount(db, { discordId: '123' });
  const fakeNow = () => 1_000_000;
  const expired = createSession(db, account.id, { ttlMs: -1, now: fakeNow }); // already expired at creation
  const valid = createSession(db, account.id, { ttlMs: 999999, now: fakeNow });

  const removed = deleteExpiredSessions(db, { now: fakeNow });
  assert.equal(removed, 1);
  assert.equal(getAccountBySessionToken(db, expired.token, { now: fakeNow }), null);
  assert.ok(getAccountBySessionToken(db, valid.token, { now: fakeNow }));
});

// ---------------------------------------------------------------------
// Favorites
// ---------------------------------------------------------------------
test('addFavorite and listFavorites round-trip', () => {
  const db = freshDb();
  const account = upsertAccount(db, { discordId: '123' });
  addFavorite(db, account.id, 'server-a');
  addFavorite(db, account.id, 'server-b');
  assert.deepEqual(listFavorites(db, account.id), ['server-a', 'server-b']);
});

test('addFavorite is idempotent — favoriting the same server twice does not duplicate it', () => {
  const db = freshDb();
  const account = upsertAccount(db, { discordId: '123' });
  addFavorite(db, account.id, 'server-a');
  addFavorite(db, account.id, 'server-a');
  assert.deepEqual(listFavorites(db, account.id), ['server-a']);
});

test('removeFavorite removes a favorite and reports true, false if it was never there', () => {
  const db = freshDb();
  const account = upsertAccount(db, { discordId: '123' });
  addFavorite(db, account.id, 'server-a');

  assert.equal(removeFavorite(db, account.id, 'server-a'), true);
  assert.deepEqual(listFavorites(db, account.id), []);
  assert.equal(removeFavorite(db, account.id, 'server-a'), false);
});

test('favorites are scoped per-account, not shared', () => {
  const db = freshDb();
  const alice = upsertAccount(db, { discordId: 'alice' });
  const bob = upsertAccount(db, { discordId: 'bob' });
  addFavorite(db, alice.id, 'server-a');
  addFavorite(db, bob.id, 'server-b');

  assert.deepEqual(listFavorites(db, alice.id), ['server-a']);
  assert.deepEqual(listFavorites(db, bob.id), ['server-b']);
});

// ---------------------------------------------------------------------
// Alert settings
// ---------------------------------------------------------------------
test('upsertAlertSettings stores settings and getAlertSettings reads them back', () => {
  const db = freshDb();
  const account = upsertAccount(db, { discordId: '123' });
  upsertAlertSettings(db, account.id, 'server-a', { notifyDown: true, capacityThresholdPct: 90 });

  const settings = getAlertSettings(db, account.id, 'server-a');
  assert.equal(settings.notifyDown, true);
  assert.equal(settings.notifyOnline, false);
  assert.equal(settings.capacityThresholdPct, 90);
  assert.equal(settings.minFreeSlots, null);
});

test('upsertAlertSettings updates existing settings instead of duplicating the row', () => {
  const db = freshDb();
  const account = upsertAccount(db, { discordId: '123' });
  upsertAlertSettings(db, account.id, 'server-a', { notifyDown: true });
  upsertAlertSettings(db, account.id, 'server-a', { notifyDown: false, notifyOnline: true });

  const settings = getAlertSettings(db, account.id, 'server-a');
  assert.equal(settings.notifyDown, false);
  assert.equal(settings.notifyOnline, true);

  const count = db.prepare('SELECT COUNT(*) as c FROM alert_settings').get();
  assert.equal(count.c, 1);
});

test('upsertAlertSettings with everything off deletes the row instead of storing dead zeros', () => {
  const db = freshDb();
  const account = upsertAccount(db, { discordId: '123' });
  upsertAlertSettings(db, account.id, 'server-a', { notifyDown: true });
  upsertAlertSettings(db, account.id, 'server-a', { notifyDown: false, notifyOnline: false });

  assert.equal(getAlertSettings(db, account.id, 'server-a'), null);
  const count = db.prepare('SELECT COUNT(*) as c FROM alert_settings').get();
  assert.equal(count.c, 0);
});

test('getAlertSettings returns null when nothing has been configured', () => {
  const db = freshDb();
  const account = upsertAccount(db, { discordId: '123' });
  assert.equal(getAlertSettings(db, account.id, 'never-configured'), null);
});

test('upsertAlertSettings treats empty-string thresholds as null (form inputs come in as strings)', () => {
  const db = freshDb();
  const account = upsertAccount(db, { discordId: '123' });
  upsertAlertSettings(db, account.id, 'server-a', { notifyDown: true, capacityThresholdPct: '', minFreeSlots: '' });
  const settings = getAlertSettings(db, account.id, 'server-a');
  assert.equal(settings.capacityThresholdPct, null);
  assert.equal(settings.minFreeSlots, null);
});

test('upsertAlertSettings coerces string numeric thresholds (as form inputs send them)', () => {
  const db = freshDb();
  const account = upsertAccount(db, { discordId: '123' });
  upsertAlertSettings(db, account.id, 'server-a', { notifyDown: true, capacityThresholdPct: '75', minFreeSlots: '2' });
  const settings = getAlertSettings(db, account.id, 'server-a');
  assert.equal(settings.capacityThresholdPct, 75);
  assert.equal(settings.minFreeSlots, 2);
});

test('listAlertSettingsForAccount lists all configured alerts for that account only', () => {
  const db = freshDb();
  const alice = upsertAccount(db, { discordId: 'alice' });
  const bob = upsertAccount(db, { discordId: 'bob' });
  upsertAlertSettings(db, alice.id, 'server-a', { notifyDown: true });
  upsertAlertSettings(db, alice.id, 'server-b', { notifyOnline: true });
  upsertAlertSettings(db, bob.id, 'server-c', { notifyDown: true });

  const aliceAlerts = listAlertSettingsForAccount(db, alice.id);
  assert.equal(aliceAlerts.length, 2);
  assert.deepEqual(aliceAlerts.map((a) => a.serverId).sort(), ['server-a', 'server-b']);
});

test('listAlertSettingsForAccount returns an empty array when nothing is configured', () => {
  const db = freshDb();
  const account = upsertAccount(db, { discordId: '123' });
  assert.deepEqual(listAlertSettingsForAccount(db, account.id), []);
});
