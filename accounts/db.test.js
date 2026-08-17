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
  listAllAlertSettings,
  listAlertServerStates,
  persistAlertCycle,
  listAlertEventsForAccount,
  markAlertEventsRead,
  countFilterPresets,
  listFilterPresets,
  getFilterPresetByShareToken,
  addFilterPreset,
  deleteFilterPreset,
  migrateCookiePresetsToAccount,
} = require('./db.js');
const { ACCOUNT_PRESET_CAP } = require('./presets.js');

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

test('listAllAlertSettings returns every account\'s subscriptions', () => {
  const db = freshDb();
  const alice = upsertAccount(db, { discordId: 'alice' });
  const bob = upsertAccount(db, { discordId: 'bob' });
  upsertAlertSettings(db, alice.id, 'server-a', { notifyDown: true });
  upsertAlertSettings(db, bob.id, 'server-c', { notifyOnline: true });

  const all = listAllAlertSettings(db);
  assert.equal(all.length, 2);
  assert.deepEqual(all.map((a) => a.serverId).sort(), ['server-a', 'server-c']);
  assert.ok(all.every((a) => a.accountId === alice.id || a.accountId === bob.id));
});

test('clearing alert settings also drops the matching server state', () => {
  const db = freshDb();
  const account = upsertAccount(db, { discordId: '123' });
  upsertAlertSettings(db, account.id, 'server-a', { notifyDown: true });
  persistAlertCycle(db, {
    events: [],
    stateUpdates: [
      {
        accountId: account.id,
        serverId: 'server-a',
        lastStatus: 'online',
        pendingStatus: null,
        pendingCount: 0,
        capacityAlerted: false,
        freeSlotsAlerted: false,
        lastFiredAt: null,
        updatedAt: '2026-08-17T00:00:00.000Z',
      },
    ],
  });
  assert.equal(listAlertServerStates(db).length, 1);

  upsertAlertSettings(db, account.id, 'server-a', { notifyDown: false });
  assert.equal(getAlertSettings(db, account.id, 'server-a'), null);
  assert.equal(listAlertServerStates(db).length, 0);
});

test('persistAlertCycle writes events and state together, and list/mark-read round-trip', () => {
  const db = freshDb();
  const account = upsertAccount(db, { discordId: '123' });
  persistAlertCycle(db, {
    stateUpdates: [
      {
        accountId: account.id,
        serverId: 's1',
        lastStatus: 'offline',
        pendingStatus: null,
        pendingCount: 0,
        capacityAlerted: false,
        freeSlotsAlerted: false,
        lastFiredAt: '2026-08-17T12:00:00.000Z',
        updatedAt: '2026-08-17T12:00:00.000Z',
      },
    ],
    events: [
      {
        accountId: account.id,
        serverId: 's1',
        serverName: 'NA-PVE-GenOne6433',
        kind: 'down',
        message: 'NA-PVE-GenOne6433 went offline.',
        createdAt: '2026-08-17T12:00:00.000Z',
      },
    ],
  });

  const states = listAlertServerStates(db);
  assert.equal(states.length, 1);
  assert.equal(states[0].lastStatus, 'offline');
  assert.equal(states[0].lastFiredAt, '2026-08-17T12:00:00.000Z');

  const events = listAlertEventsForAccount(db, account.id);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'down');
  assert.equal(events[0].readAt, null);
  assert.equal(events[0].serverName, 'NA-PVE-GenOne6433');

  const marked = markAlertEventsRead(db, account.id, [events[0].id], { now: () => '2026-08-17T12:05:00.000Z' });
  assert.equal(marked, 1);
  assert.equal(listAlertEventsForAccount(db, account.id)[0].readAt, '2026-08-17T12:05:00.000Z');
  assert.equal(markAlertEventsRead(db, account.id, [events[0].id], { now: () => '2026-08-17T12:06:00.000Z' }), 0);
});

test('listAlertEventsForAccount is newest-first, capped at 100, and scoped per account', () => {
  const db = freshDb();
  const alice = upsertAccount(db, { discordId: 'alice' });
  const bob = upsertAccount(db, { discordId: 'bob' });
  const events = [];
  for (let i = 0; i < 105; i += 1) {
    events.push({
      accountId: alice.id,
      serverId: 's1',
      serverName: 'Srv',
      kind: 'down',
      message: `event ${i}`,
      createdAt: `2026-08-17T12:00:00.${String(i).padStart(3, '0')}Z`,
    });
  }
  events.push({
    accountId: bob.id,
    serverId: 's2',
    serverName: 'Other',
    kind: 'online',
    message: 'bob only',
    createdAt: '2026-08-17T23:00:00.000Z',
  });
  persistAlertCycle(db, { events, stateUpdates: [] });

  const aliceEvents = listAlertEventsForAccount(db, alice.id);
  assert.equal(aliceEvents.length, 100);
  assert.equal(aliceEvents[0].message, 'event 104');
  assert.doesNotMatch(aliceEvents.map((e) => e.message).join(' '), /bob only/);
  assert.equal(listAlertEventsForAccount(db, bob.id).length, 1);
});

// ---------------------------------------------------------------------
// Filter presets
// ---------------------------------------------------------------------
test('addFilterPreset stores a preset and listFilterPresets reads it back', () => {
  const db = freshDb();
  const account = upsertAccount(db, { discordId: '123' });
  const saved = addFilterPreset(db, account.id, { name: 'PvE', queryString: 'gameMode=pve&evil=1' }, { randomToken: () => 'share-aaa' });

  assert.equal(saved.name, 'PvE');
  assert.equal(saved.queryString, 'gameMode=pve'); // unknown params dropped on save
  assert.equal(saved.shareToken, 'share-aaa');

  const listed = listFilterPresets(db, account.id);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].shareToken, 'share-aaa');
});

test('addFilterPreset trims names, rejects empty, and rejects names over 40 chars', () => {
  const db = freshDb();
  const account = upsertAccount(db, { discordId: '123' });
  assert.equal(addFilterPreset(db, account.id, { name: '  Ranked  ', queryString: 'sort=rank' }).name, 'Ranked');
  assert.equal(addFilterPreset(db, account.id, { name: '  ', queryString: 'sort=rank' }).error, 'empty_name');
  assert.equal(addFilterPreset(db, account.id, { name: 'x'.repeat(41), queryString: 'sort=rank' }).error, 'name_too_long');
});

test('addFilterPreset rejects a query that sanitizes to nothing', () => {
  const db = freshDb();
  const account = upsertAccount(db, { discordId: '123' });
  assert.equal(addFilterPreset(db, account.id, { name: 'Nope', queryString: 'redirect=https://evil.example/' }).error, 'empty_query');
});

test('addFilterPreset rejects a duplicate name on the same account', () => {
  const db = freshDb();
  const account = upsertAccount(db, { discordId: '123' });
  addFilterPreset(db, account.id, { name: 'PvE', queryString: 'gameMode=pve' });
  assert.equal(addFilterPreset(db, account.id, { name: 'PvE', queryString: 'gameMode=pvp' }).error, 'duplicate');
});

test('addFilterPreset enforces the logged-in cap of 15', () => {
  const db = freshDb();
  const account = upsertAccount(db, { discordId: '123' });
  for (let i = 0; i < ACCOUNT_PRESET_CAP; i += 1) {
    const result = addFilterPreset(db, account.id, { name: `P${i}`, queryString: `map=M${i}` }, { randomToken: () => `tok-${i}` });
    assert.ok(result.id, `expected preset ${i} to save`);
  }
  assert.equal(countFilterPresets(db, account.id), ACCOUNT_PRESET_CAP);
  assert.equal(addFilterPreset(db, account.id, { name: 'overflow', queryString: 'map=Z' }, { randomToken: () => 'tok-overflow' }).error, 'account_cap');
});

test('deleteFilterPreset removes a preset and invalidates its share token', () => {
  const db = freshDb();
  const account = upsertAccount(db, { discordId: '123' });
  const saved = addFilterPreset(db, account.id, { name: 'PvE', queryString: 'gameMode=pve' }, { randomToken: () => 'share-del' });
  assert.ok(getFilterPresetByShareToken(db, 'share-del'));

  assert.equal(deleteFilterPreset(db, account.id, saved.id), true);
  assert.equal(getFilterPresetByShareToken(db, 'share-del'), null);
  assert.equal(deleteFilterPreset(db, account.id, saved.id), false);
});

test('deleteFilterPreset cannot remove another account\'s preset', () => {
  const db = freshDb();
  const alice = upsertAccount(db, { discordId: 'alice' });
  const bob = upsertAccount(db, { discordId: 'bob' });
  const saved = addFilterPreset(db, alice.id, { name: 'PvE', queryString: 'gameMode=pve' }, { randomToken: () => 'share-alice' });
  assert.equal(deleteFilterPreset(db, bob.id, saved.id), false);
  assert.ok(getFilterPresetByShareToken(db, 'share-alice'));
});

test('getFilterPresetByShareToken returns null for a missing token', () => {
  const db = freshDb();
  assert.equal(getFilterPresetByShareToken(db, 'nope'), null);
  assert.equal(getFilterPresetByShareToken(db, ''), null);
  assert.equal(getFilterPresetByShareToken(db, null), null);
});

test('presets are scoped per-account', () => {
  const db = freshDb();
  const alice = upsertAccount(db, { discordId: 'alice' });
  const bob = upsertAccount(db, { discordId: 'bob' });
  addFilterPreset(db, alice.id, { name: 'PvE', queryString: 'gameMode=pve' }, { randomToken: () => 'a' });
  addFilterPreset(db, bob.id, { name: 'PvP', queryString: 'gameMode=pvp' }, { randomToken: () => 'b' });
  assert.deepEqual(listFilterPresets(db, alice.id).map((p) => p.name), ['PvE']);
  assert.deepEqual(listFilterPresets(db, bob.id).map((p) => p.name), ['PvP']);
});

test('migrateCookiePresetsToAccount copies cookie presets, skipping name collisions', () => {
  const db = freshDb();
  const account = upsertAccount(db, { discordId: '123' });
  addFilterPreset(db, account.id, { name: 'PvE', queryString: 'gameMode=pve' }, { randomToken: () => 'existing' });

  const migrated = migrateCookiePresetsToAccount(
    db,
    account.id,
    [
      { name: 'PvE', query: 'gameMode=pve&search=island' }, // collision — skip
      { name: 'Ranked', query: 'sort=rank&evil=1' },
      { name: 'Public', query: 'hasPassword=false' },
    ],
    { randomToken: () => `mig-${Math.random()}` }
  );

  assert.equal(migrated, 2);
  const names = listFilterPresets(db, account.id).map((p) => p.name).sort();
  assert.deepEqual(names, ['Public', 'PvE', 'Ranked']);
  const pve = listFilterPresets(db, account.id).find((p) => p.name === 'PvE');
  assert.equal(pve.queryString, 'gameMode=pve'); // original, not overwritten by the cookie copy
  const ranked = listFilterPresets(db, account.id).find((p) => p.name === 'Ranked');
  assert.equal(ranked.queryString, 'sort=rank'); // sanitized on migrate
});

test('migrateCookiePresetsToAccount is a no-op for an empty cookie', () => {
  const db = freshDb();
  const account = upsertAccount(db, { discordId: '123' });
  assert.equal(migrateCookiePresetsToAccount(db, account.id, []), 0);
  assert.equal(migrateCookiePresetsToAccount(db, account.id, null), 0);
});
