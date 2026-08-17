#!/usr/bin/env node
'use strict';

/**
 * db.js
 *
 * Account/session/favorites/preset storage for ArkHelper. Uses Node's built-in
 * node:sqlite (DatabaseSync) — confirmed working without any experimental
 * flag on Node 22+ (just prints an ExperimentalWarning, which is fine).
 * Deliberately not adding better-sqlite3 or any other dependency for
 * this — the built-in module does everything needed here.
 *
 * Every function takes the db handle as its first argument rather than
 * wrapping it in a class, matching the plain-function style used
 * throughout the rest of the toolkit. Time and randomness are
 * injectable everywhere for testing (same pattern as the discovery
 * modules' injectable HTTP/sleep).
 */

const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const {
  ACCOUNT_PRESET_CAP,
  sanitizeQueryString,
  normalizePresetName,
} = require('./presets.js');

const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ---------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------
const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id TEXT UNIQUE NOT NULL,
  discord_username TEXT,
  discord_avatar TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS favorites (
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  server_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (account_id, server_id)
);

CREATE TABLE IF NOT EXISTS alert_settings (
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  server_id TEXT NOT NULL,
  notify_online INTEGER NOT NULL DEFAULT 0,
  notify_down INTEGER NOT NULL DEFAULT 0,
  capacity_threshold_pct INTEGER,
  min_free_slots INTEGER,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_id, server_id)
);

CREATE TABLE IF NOT EXISTS filter_presets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  query_string TEXT NOT NULL,
  share_token TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(account_id, name)
);

CREATE TABLE IF NOT EXISTS alert_server_state (
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  server_id TEXT NOT NULL,
  last_status TEXT NOT NULL,
  pending_status TEXT,
  pending_count INTEGER NOT NULL DEFAULT 0,
  capacity_alerted INTEGER NOT NULL DEFAULT 0,
  free_slots_alerted INTEGER NOT NULL DEFAULT 0,
  last_fired_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_id, server_id)
);

CREATE TABLE IF NOT EXISTS alert_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  server_id TEXT NOT NULL,
  server_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at TEXT,
  dispatched_at TEXT
);

CREATE TABLE IF NOT EXISTS account_webhooks (
  account_id INTEGER PRIMARY KEY REFERENCES accounts(id),
  url TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alert_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  event_count INTEGER NOT NULL,
  status_code INTEGER,
  ok INTEGER NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);
`;

const DELIVERY_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

function tableHasColumn(db, tableName, columnName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().some((col) => col.name === columnName);
}

// Existing A1 DBs created alert_events without dispatched_at. Add the
// column once, then stamp current rows so old feed history cannot
// spray into a webhook saved later. New inserts leave dispatched_at
// NULL and go through the dispatcher.
function migrateAlertDispatch(db) {
  if (!tableHasColumn(db, 'alert_events', 'dispatched_at')) {
    db.exec('BEGIN');
    try {
      db.exec('ALTER TABLE alert_events ADD COLUMN dispatched_at TEXT');
      db.exec('UPDATE alert_events SET dispatched_at = created_at');
      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignore rollback failure
      }
      throw err;
    }
  }
}

function openDb(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);
  migrateAlertDispatch(db);
  return db;
}

// ---------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------
// Insert-or-update by discord_id. Returns the resulting account row.
function upsertAccount(db, { discordId, username, avatar }, { now = () => new Date().toISOString() } = {}) {
  if (!discordId) throw new Error('upsertAccount: discordId is required');
  const nowStr = now();

  const existing = db.prepare('SELECT * FROM accounts WHERE discord_id = ?').get(discordId);
  if (existing) {
    db.prepare(
      'UPDATE accounts SET discord_username = ?, discord_avatar = ?, updated_at = ? WHERE discord_id = ?'
    ).run(username ?? existing.discord_username, avatar ?? existing.discord_avatar, nowStr, discordId);
    return db.prepare('SELECT * FROM accounts WHERE discord_id = ?').get(discordId);
  }

  db.prepare(
    'INSERT INTO accounts (discord_id, discord_username, discord_avatar, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run(discordId, username ?? null, avatar ?? null, nowStr, nowStr);
  return db.prepare('SELECT * FROM accounts WHERE discord_id = ?').get(discordId);
}

function getAccountById(db, accountId) {
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) || null;
}

// ---------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------
function createSession(
  db,
  accountId,
  { ttlMs = DEFAULT_SESSION_TTL_MS, now = () => Date.now(), randomToken = () => crypto.randomBytes(32).toString('hex') } = {}
) {
  const token = randomToken();
  const createdAt = new Date(now()).toISOString();
  const expiresAt = new Date(now() + ttlMs).toISOString();
  db.prepare('INSERT INTO sessions (token, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    token,
    accountId,
    createdAt,
    expiresAt
  );
  return { token, accountId, createdAt, expiresAt };
}

// Returns the account row for a valid, unexpired session token, or null.
// Expired sessions are treated as absent (not auto-deleted here — that's
// a cheap periodic cleanup job to add later, not a correctness issue now
// since an expired session simply never matches).
function getAccountBySessionToken(db, token, { now = () => Date.now() } = {}) {
  if (!token) return null;
  const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!session) return null;
  if (new Date(session.expires_at).getTime() <= now()) return null;
  return getAccountById(db, session.account_id);
}

function deleteSession(db, token) {
  const result = db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  return result.changes > 0;
}

// Deletes sessions past their expiry. Returns the number removed. Not
// called automatically — intended to be run periodically (e.g. once a
// day) by whatever process owns the DB, to keep the table from growing
// unbounded.
function deleteExpiredSessions(db, { now = () => Date.now() } = {}) {
  const result = db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date(now()).toISOString());
  return result.changes;
}

// ---------------------------------------------------------------------
// Favorites
// ---------------------------------------------------------------------
function addFavorite(db, accountId, serverId, { now = () => new Date().toISOString() } = {}) {
  db.prepare('INSERT OR IGNORE INTO favorites (account_id, server_id, created_at) VALUES (?, ?, ?)').run(
    accountId,
    serverId,
    now()
  );
}

function removeFavorite(db, accountId, serverId) {
  const result = db.prepare('DELETE FROM favorites WHERE account_id = ? AND server_id = ?').run(accountId, serverId);
  return result.changes > 0;
}

function listFavorites(db, accountId) {
  return db.prepare('SELECT server_id FROM favorites WHERE account_id = ? ORDER BY created_at').all(accountId).map((r) => r.server_id);
}

// ---------------------------------------------------------------------
// Alert settings
// ---------------------------------------------------------------------
function hasAnyActiveAlert(settings) {
  return Boolean(settings.notifyOnline) || Boolean(settings.notifyDown) || settings.capacityThresholdPct != null || settings.minFreeSlots != null;
}

// Upserts alert settings for one account+server pair. If the resulting
// settings represent "nothing turned on" (all false/null), the row is
// deleted instead of stored — keeps the table free of dead rows, and
// means getAlertSettings returning null reliably means "no alerts
// configured" for whatever dispatch logic reads this later.
function upsertAlertSettings(db, accountId, serverId, settings, { now = () => new Date().toISOString() } = {}) {
  const normalized = {
    notifyOnline: Boolean(settings.notifyOnline),
    notifyDown: Boolean(settings.notifyDown),
    capacityThresholdPct: settings.capacityThresholdPct === '' || settings.capacityThresholdPct == null ? null : Number(settings.capacityThresholdPct),
    minFreeSlots: settings.minFreeSlots === '' || settings.minFreeSlots == null ? null : Number(settings.minFreeSlots),
  };

  if (!hasAnyActiveAlert(normalized)) {
    db.prepare('DELETE FROM alert_settings WHERE account_id = ? AND server_id = ?').run(accountId, serverId);
    db.prepare('DELETE FROM alert_server_state WHERE account_id = ? AND server_id = ?').run(accountId, serverId);
    return null;
  }

  db.prepare(
    `INSERT INTO alert_settings (account_id, server_id, notify_online, notify_down, capacity_threshold_pct, min_free_slots, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id, server_id) DO UPDATE SET
       notify_online = excluded.notify_online,
       notify_down = excluded.notify_down,
       capacity_threshold_pct = excluded.capacity_threshold_pct,
       min_free_slots = excluded.min_free_slots,
       updated_at = excluded.updated_at`
  ).run(
    accountId,
    serverId,
    normalized.notifyOnline ? 1 : 0,
    normalized.notifyDown ? 1 : 0,
    normalized.capacityThresholdPct,
    normalized.minFreeSlots,
    now()
  );

  return getAlertSettings(db, accountId, serverId);
}

function getAlertSettings(db, accountId, serverId) {
  const row = db.prepare('SELECT * FROM alert_settings WHERE account_id = ? AND server_id = ?').get(accountId, serverId);
  if (!row) return null;
  return {
    notifyOnline: Boolean(row.notify_online),
    notifyDown: Boolean(row.notify_down),
    capacityThresholdPct: row.capacity_threshold_pct,
    minFreeSlots: row.min_free_slots,
    updatedAt: row.updated_at,
  };
}

function listAlertSettingsForAccount(db, accountId) {
  return db
    .prepare('SELECT * FROM alert_settings WHERE account_id = ? ORDER BY updated_at DESC')
    .all(accountId)
    .map((row) => ({
      serverId: row.server_id,
      notifyOnline: Boolean(row.notify_online),
      notifyDown: Boolean(row.notify_down),
      capacityThresholdPct: row.capacity_threshold_pct,
      minFreeSlots: row.min_free_slots,
      updatedAt: row.updated_at,
    }));
}

function listAllAlertSettings(db) {
  return db.prepare('SELECT * FROM alert_settings').all().map((row) => ({
    accountId: row.account_id,
    serverId: row.server_id,
    notifyOnline: Boolean(row.notify_online),
    notifyDown: Boolean(row.notify_down),
    capacityThresholdPct: row.capacity_threshold_pct,
    minFreeSlots: row.min_free_slots,
    updatedAt: row.updated_at,
  }));
}

function rowToAlertServerState(row) {
  if (!row) return null;
  return {
    accountId: row.account_id,
    serverId: row.server_id,
    lastStatus: row.last_status,
    pendingStatus: row.pending_status,
    pendingCount: row.pending_count,
    capacityAlerted: Boolean(row.capacity_alerted),
    freeSlotsAlerted: Boolean(row.free_slots_alerted),
    lastFiredAt: row.last_fired_at,
    updatedAt: row.updated_at,
  };
}

function listAlertServerStates(db) {
  return db.prepare('SELECT * FROM alert_server_state').all().map(rowToAlertServerState);
}

function upsertAlertServerState(db, state) {
  db.prepare(
    `INSERT INTO alert_server_state (
       account_id, server_id, last_status, pending_status, pending_count,
       capacity_alerted, free_slots_alerted, last_fired_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id, server_id) DO UPDATE SET
       last_status = excluded.last_status,
       pending_status = excluded.pending_status,
       pending_count = excluded.pending_count,
       capacity_alerted = excluded.capacity_alerted,
       free_slots_alerted = excluded.free_slots_alerted,
       last_fired_at = excluded.last_fired_at,
       updated_at = excluded.updated_at`
  ).run(
    state.accountId,
    state.serverId,
    state.lastStatus,
    state.pendingStatus ?? null,
    state.pendingCount || 0,
    state.capacityAlerted ? 1 : 0,
    state.freeSlotsAlerted ? 1 : 0,
    state.lastFiredAt ?? null,
    state.updatedAt
  );
}

function rowToAlertEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    accountId: row.account_id,
    serverId: row.server_id,
    serverName: row.server_name,
    kind: row.kind,
    message: row.message,
    createdAt: row.created_at,
    readAt: row.read_at,
    dispatchedAt: row.dispatched_at,
  };
}

function insertAlertEvent(db, event) {
  const result = db
    .prepare(
      `INSERT INTO alert_events (account_id, server_id, server_name, kind, message, created_at, read_at, dispatched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      event.accountId,
      event.serverId,
      event.serverName,
      event.kind,
      event.message,
      event.createdAt,
      event.readAt ?? null,
      event.dispatchedAt ?? null
    );
  return Number(result.lastInsertRowid);
}

function listAlertEventsForAccount(db, accountId, { limit = 100 } = {}) {
  const cap = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 1000) : 100;
  return db
    .prepare(
      `SELECT * FROM alert_events WHERE account_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`
    )
    .all(accountId, cap)
    .map(rowToAlertEvent);
}

function markAlertEventsRead(db, accountId, eventIds, { now = () => new Date().toISOString() } = {}) {
  if (!Array.isArray(eventIds) || eventIds.length === 0) return 0;
  const nowStr = now();
  const stmt = db.prepare(
    'UPDATE alert_events SET read_at = ? WHERE id = ? AND account_id = ? AND read_at IS NULL'
  );
  let changed = 0;
  for (const id of eventIds) {
    changed += stmt.run(nowStr, id, accountId).changes;
  }
  return changed;
}

// Persists one evaluation cycle: state upserts + new events in a single
// transaction. events is the channel-neutral fire list (in-page feed +
// Discord webhook dispatcher both consume these rows).
function persistAlertCycle(db, { events = [], stateUpdates = [] } = {}) {
  db.exec('BEGIN');
  try {
    for (const state of stateUpdates) upsertAlertServerState(db, state);
    for (const event of events) insertAlertEvent(db, event);
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore rollback failure
    }
    throw err;
  }
}

function listPendingAlertEvents(db) {
  return db
    .prepare('SELECT * FROM alert_events WHERE dispatched_at IS NULL ORDER BY id ASC')
    .all()
    .map(rowToAlertEvent);
}

function markAlertEventsDispatched(db, eventIds, { now = () => new Date().toISOString() } = {}) {
  if (!Array.isArray(eventIds) || eventIds.length === 0) return 0;
  const nowIso = typeof now === 'function' ? now() : now;
  const stmt = db.prepare(
    'UPDATE alert_events SET dispatched_at = ? WHERE id = ? AND dispatched_at IS NULL'
  );
  let changed = 0;
  for (const id of eventIds) {
    changed += stmt.run(nowIso, id).changes;
  }
  return changed;
}

function rowToWebhook(row) {
  if (!row) return null;
  return {
    accountId: row.account_id,
    url: row.url,
    enabled: Boolean(row.enabled),
    consecutiveFailures: row.consecutive_failures,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getAccountWebhook(db, accountId) {
  return rowToWebhook(db.prepare('SELECT * FROM account_webhooks WHERE account_id = ?').get(accountId));
}

function upsertAccountWebhook(db, accountId, url, { now = () => new Date().toISOString() } = {}) {
  const nowIso = typeof now === 'function' ? now() : now;
  db.prepare(
    `INSERT INTO account_webhooks (account_id, url, enabled, consecutive_failures, created_at, updated_at)
     VALUES (?, ?, 1, 0, ?, ?)
     ON CONFLICT(account_id) DO UPDATE SET
       url = excluded.url,
       enabled = 1,
       consecutive_failures = 0,
       updated_at = excluded.updated_at`
  ).run(accountId, url, nowIso, nowIso);
  return getAccountWebhook(db, accountId);
}

function deleteAccountWebhook(db, accountId) {
  const result = db.prepare('DELETE FROM account_webhooks WHERE account_id = ?').run(accountId);
  return result.changes > 0;
}

function resetWebhookFailures(db, accountId, { now = () => new Date().toISOString() } = {}) {
  const nowIso = typeof now === 'function' ? now() : now;
  db.prepare('UPDATE account_webhooks SET consecutive_failures = 0, updated_at = ? WHERE account_id = ?').run(
    nowIso,
    accountId
  );
}

function incrementWebhookFailures(db, accountId, { now = () => new Date().toISOString() } = {}) {
  const nowIso = typeof now === 'function' ? now() : now;
  db.prepare(
    'UPDATE account_webhooks SET consecutive_failures = consecutive_failures + 1, updated_at = ? WHERE account_id = ?'
  ).run(nowIso, accountId);
  const row = db.prepare('SELECT consecutive_failures FROM account_webhooks WHERE account_id = ?').get(accountId);
  return row ? row.consecutive_failures : 0;
}

function disableAccountWebhook(db, accountId, { now = () => new Date().toISOString() } = {}) {
  const nowIso = typeof now === 'function' ? now() : now;
  db.prepare('UPDATE account_webhooks SET enabled = 0, updated_at = ? WHERE account_id = ?').run(nowIso, accountId);
}

function insertAlertDelivery(db, row, { now = () => new Date().toISOString() } = {}) {
  const nowIso = typeof now === 'function' ? now() : now;
  db.prepare(
    `INSERT INTO alert_deliveries (account_id, event_count, status_code, ok, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    row.accountId,
    row.eventCount,
    row.statusCode ?? null,
    row.ok ? 1 : 0,
    row.detail ?? null,
    row.createdAt || nowIso
  );
  const cutoffMs = Date.parse(nowIso) - DELIVERY_RETENTION_MS;
  if (Number.isFinite(cutoffMs)) {
    db.prepare('DELETE FROM alert_deliveries WHERE created_at < ?').run(new Date(cutoffMs).toISOString());
  }
}

function listAlertDeliveries(db, accountId) {
  return db
    .prepare('SELECT * FROM alert_deliveries WHERE account_id = ? ORDER BY id ASC')
    .all(accountId)
    .map((row) => ({
      id: row.id,
      accountId: row.account_id,
      eventCount: row.event_count,
      statusCode: row.status_code,
      ok: Boolean(row.ok),
      detail: row.detail,
      createdAt: row.created_at,
    }));
}

// ---------------------------------------------------------------------
// Filter presets (logged-in)
// ---------------------------------------------------------------------
function rowToPreset(row) {
  if (!row) return null;
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    queryString: row.query_string,
    shareToken: row.share_token,
    createdAt: row.created_at,
  };
}

function countFilterPresets(db, accountId) {
  return db.prepare('SELECT COUNT(*) as c FROM filter_presets WHERE account_id = ?').get(accountId).c;
}

function listFilterPresets(db, accountId) {
  return db
    .prepare('SELECT * FROM filter_presets WHERE account_id = ? ORDER BY created_at, id')
    .all(accountId)
    .map(rowToPreset);
}

function getFilterPresetByShareToken(db, token) {
  if (!token) return null;
  return rowToPreset(db.prepare('SELECT * FROM filter_presets WHERE share_token = ?').get(token));
}

function addFilterPreset(
  db,
  accountId,
  { name, queryString },
  { now = () => new Date().toISOString(), randomToken = () => crypto.randomBytes(32).toString('hex') } = {}
) {
  const normalized = normalizePresetName(name);
  if (normalized.error) return { error: normalized.error };
  const sanitized = sanitizeQueryString(queryString);
  if (!sanitized) return { error: 'empty_query' };
  if (countFilterPresets(db, accountId) >= ACCOUNT_PRESET_CAP) return { error: 'account_cap' };

  const existing = db.prepare('SELECT id FROM filter_presets WHERE account_id = ? AND name = ?').get(accountId, normalized.name);
  if (existing) return { error: 'duplicate' };

  const shareToken = randomToken();
  const createdAt = now();
  const result = db
    .prepare(
      'INSERT INTO filter_presets (account_id, name, query_string, share_token, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    .run(accountId, normalized.name, sanitized, shareToken, createdAt);

  return rowToPreset({
    id: Number(result.lastInsertRowid),
    account_id: accountId,
    name: normalized.name,
    query_string: sanitized,
    share_token: shareToken,
    created_at: createdAt,
  });
}

function deleteFilterPreset(db, accountId, presetId) {
  const result = db.prepare('DELETE FROM filter_presets WHERE id = ? AND account_id = ?').run(presetId, accountId);
  return result.changes > 0;
}

// Copies cookie presets onto the account, skipping names that already
// exist and stopping if the account is at cap. Returns how many were
// inserted. Callers are responsible for clearing the cookie afterwards.
function migrateCookiePresetsToAccount(db, accountId, cookiePresets, opts) {
  if (!Array.isArray(cookiePresets) || cookiePresets.length === 0) return 0;
  const existingNames = new Set(listFilterPresets(db, accountId).map((p) => p.name));
  let migrated = 0;
  for (const raw of cookiePresets) {
    const name = raw && raw.name;
    if (existingNames.has(name)) continue;
    const result = addFilterPreset(db, accountId, { name, queryString: raw.query }, opts);
    if (!result || result.error) {
      if (result && result.error === 'account_cap') break;
      continue;
    }
    existingNames.add(result.name);
    migrated += 1;
  }
  return migrated;
}

module.exports = {
  DEFAULT_SESSION_TTL_MS,
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
  upsertAlertServerState,
  insertAlertEvent,
  listAlertEventsForAccount,
  markAlertEventsRead,
  persistAlertCycle,
  listPendingAlertEvents,
  markAlertEventsDispatched,
  getAccountWebhook,
  upsertAccountWebhook,
  deleteAccountWebhook,
  resetWebhookFailures,
  incrementWebhookFailures,
  disableAccountWebhook,
  insertAlertDelivery,
  listAlertDeliveries,
  countFilterPresets,
  listFilterPresets,
  getFilterPresetByShareToken,
  addFilterPreset,
  deleteFilterPreset,
  migrateCookiePresetsToAccount,
};
