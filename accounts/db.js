#!/usr/bin/env node
'use strict';

/**
 * db.js
 *
 * Account/session/favorites storage for ArkHelper. Uses Node's built-in
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
`;

function openDb(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);
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
};
