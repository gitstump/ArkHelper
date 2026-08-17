#!/usr/bin/env node
'use strict';

/**
 * info_store.js
 *
 * SQLite store for CDN info feeds (feeds.sqlite). Rates keep a current
 * snapshot per network variant plus a change log written only when a
 * value actually changes. News entries are keyed by a stable hash of
 * (imagePath + action): first_seen is set once, last_seen updates each
 * poll, and entries that drop out of the feed stay as inactive history.
 */

const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS rate_snapshots (
  variant TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  PRIMARY KEY (variant, key)
);

CREATE TABLE IF NOT EXISTS rate_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  variant TEXT NOT NULL,
  key TEXT NOT NULL,
  old_value_json TEXT,
  new_value_json TEXT,
  changed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS news_entries (
  entry_hash TEXT PRIMARY KEY,
  type TEXT,
  image_path TEXT,
  title TEXT,
  body TEXT,
  action TEXT,
  url TEXT,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS feeds_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  cycles_total INTEGER NOT NULL DEFAULT 0,
  last_fetch_at TEXT,
  last_fetch_status TEXT
);
`;

function openInfoDb(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(SCHEMA);
  db.prepare(
    'INSERT OR IGNORE INTO feeds_meta (id, cycles_total, last_fetch_at, last_fetch_status) VALUES (1, 0, NULL, NULL)'
  ).run();
  return db;
}

function encodeValue(value) {
  return JSON.stringify(value);
}

function decodeValue(json) {
  if (json == null) return null;
  try {
    return JSON.parse(json);
  } catch {
    return json;
  }
}

function newsEntryHash(entry) {
  const imagePath = entry && entry.imagePath != null ? String(entry.imagePath) : '';
  const action = entry && entry.action != null ? String(entry.action) : '';
  return crypto.createHash('sha256').update(`${imagePath}\n${action}`).digest('hex');
}

function getFeedsMeta(db) {
  const row = db.prepare('SELECT cycles_total, last_fetch_at, last_fetch_status FROM feeds_meta WHERE id = 1').get();
  if (!row) return { cycles_total: 0, last_fetch_at: null, last_fetch_status: null };
  return {
    cycles_total: row.cycles_total,
    last_fetch_at: row.last_fetch_at,
    last_fetch_status: row.last_fetch_status,
  };
}

function setMeta(db, { nowIso, status, bumpCycle }) {
  if (bumpCycle) {
    db.prepare(
      `UPDATE feeds_meta SET cycles_total = cycles_total + 1, last_fetch_at = ?, last_fetch_status = ? WHERE id = 1`
    ).run(nowIso, status);
  } else {
    db.prepare(`UPDATE feeds_meta SET last_fetch_at = ?, last_fetch_status = ? WHERE id = 1`).run(nowIso, status);
  }
}

function getVariantSnapshot(db, variant) {
  const rows = db.prepare('SELECT key, value_json FROM rate_snapshots WHERE variant = ?').all(variant);
  const out = {};
  for (const row of rows) out[row.key] = decodeValue(row.value_json);
  return out;
}

function recordVariantRates(db, variant, values, nowIso) {
  const existing = getVariantSnapshot(db, variant);
  const hadSnapshot = Object.keys(existing).length > 0;
  const incoming = values && typeof values === 'object' ? values : {};
  const insert = db.prepare(
    'INSERT INTO rate_snapshots (variant, key, value_json) VALUES (?, ?, ?) ON CONFLICT(variant, key) DO UPDATE SET value_json = excluded.value_json'
  );
  const del = db.prepare('DELETE FROM rate_snapshots WHERE variant = ? AND key = ?');
  const log = db.prepare(
    'INSERT INTO rate_changes (variant, key, old_value_json, new_value_json, changed_at) VALUES (?, ?, ?, ?, ?)'
  );

  for (const [key, value] of Object.entries(incoming)) {
    const prev = Object.prototype.hasOwnProperty.call(existing, key) ? existing[key] : undefined;
    const nextJson = encodeValue(value);
    if (prev === undefined) {
      insert.run(variant, key, nextJson);
      if (hadSnapshot) log.run(variant, key, null, nextJson, nowIso);
    } else if (encodeValue(prev) !== nextJson) {
      insert.run(variant, key, nextJson);
      log.run(variant, key, encodeValue(prev), nextJson, nowIso);
    }
  }
  for (const key of Object.keys(existing)) {
    if (!Object.prototype.hasOwnProperty.call(incoming, key)) {
      del.run(variant, key);
      log.run(variant, key, encodeValue(existing[key]), null, nowIso);
    }
  }
}

function recordNewsEntries(db, entries, nowIso) {
  const incoming = Array.isArray(entries) ? entries : [];
  const hashes = new Set();
  const upsert = db.prepare(`
    INSERT INTO news_entries (
      entry_hash, type, image_path, title, body, action, url, first_seen, last_seen, active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(entry_hash) DO UPDATE SET
      type = excluded.type,
      image_path = excluded.image_path,
      title = excluded.title,
      body = excluded.body,
      action = excluded.action,
      url = excluded.url,
      last_seen = excluded.last_seen,
      active = 1
  `);
  for (const entry of incoming) {
    if (!entry || typeof entry !== 'object') continue;
    const hash = newsEntryHash(entry);
    hashes.add(hash);
    upsert.run(
      hash,
      entry.type ?? null,
      entry.imagePath ?? null,
      entry.title ?? null,
      entry.body ?? null,
      entry.action ?? null,
      entry.url ?? null,
      nowIso,
      nowIso
    );
  }
  const known = db.prepare('SELECT entry_hash FROM news_entries').all();
  const deactivate = db.prepare('UPDATE news_entries SET active = 0 WHERE entry_hash = ?');
  for (const row of known) {
    if (!hashes.has(row.entry_hash)) deactivate.run(row.entry_hash);
  }
}

function statusFromErrors(errors) {
  if (!errors || Object.keys(errors).length === 0) return 'ok';
  const parts = Object.entries(errors).map(([k, v]) => `${k}: ${v}`);
  return `partial: ${parts.join('; ')}`.slice(0, 400);
}

function recordInfoCycle(db, { rates, news, errors } = {}, { now = () => new Date().toISOString() } = {}) {
  const nowIso = now();
  db.exec('BEGIN');
  try {
    for (const [variant, values] of Object.entries(rates || {})) {
      recordVariantRates(db, variant, values, nowIso);
    }
    if (Array.isArray(news)) {
      recordNewsEntries(db, news, nowIso);
    }
    setMeta(db, { nowIso, status: statusFromErrors(errors), bumpCycle: true });
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore rollback failure
    }
    throw err;
  }
  return getFeedsMeta(db);
}

function recordInfoFetchFailure(db, { now = () => new Date().toISOString(), error = 'error' } = {}) {
  const nowIso = now();
  const status = `error: ${String(error).slice(0, 200)}`;
  setMeta(db, { nowIso, status, bumpCycle: false });
  return getFeedsMeta(db);
}

function getCurrentRates(db) {
  const rows = db.prepare('SELECT variant, key, value_json FROM rate_snapshots ORDER BY variant, key').all();
  const variants = {};
  for (const row of rows) {
    if (!variants[row.variant]) variants[row.variant] = {};
    variants[row.variant][row.key] = decodeValue(row.value_json);
  }
  return variants;
}

function getRecentRateChanges(db, { limit = 50 } = {}) {
  const rows = db
    .prepare(
      'SELECT variant, key, old_value_json, new_value_json, changed_at FROM rate_changes ORDER BY id DESC LIMIT ?'
    )
    .all(limit);
  return rows.map((row) => ({
    variant: row.variant,
    key: row.key,
    old: decodeValue(row.old_value_json),
    new: decodeValue(row.new_value_json),
    changedAt: row.changed_at,
  }));
}

function rowToNewsEntry(row) {
  return {
    hash: row.entry_hash,
    type: row.type,
    imagePath: row.image_path,
    title: row.title,
    body: row.body,
    action: row.action,
    url: row.url,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    active: row.active === 1,
  };
}

function getNewsEntries(db) {
  const rows = db.prepare('SELECT * FROM news_entries ORDER BY first_seen DESC, entry_hash ASC').all();
  return rows.map(rowToNewsEntry);
}

function getNewsEntry(db, hash) {
  const row = db.prepare('SELECT * FROM news_entries WHERE entry_hash = ?').get(hash);
  return row ? rowToNewsEntry(row) : null;
}

function hasRateData(db) {
  const row = db.prepare('SELECT 1 AS ok FROM rate_snapshots LIMIT 1').get();
  return Boolean(row);
}

function hasNewsData(db) {
  const row = db.prepare('SELECT 1 AS ok FROM news_entries LIMIT 1').get();
  return Boolean(row);
}

function getRatesFeed(db) {
  const meta = getFeedsMeta(db);
  return {
    variants: getCurrentRates(db),
    changes: getRecentRateChanges(db),
    lastFetchAt: meta.last_fetch_at,
    lastFetchStatus: meta.last_fetch_status,
  };
}

function getNewsFeed(db) {
  const meta = getFeedsMeta(db);
  return {
    entries: getNewsEntries(db),
    lastFetchAt: meta.last_fetch_at,
    lastFetchStatus: meta.last_fetch_status,
  };
}

module.exports = {
  openInfoDb,
  newsEntryHash,
  recordInfoCycle,
  recordInfoFetchFailure,
  getFeedsMeta,
  getCurrentRates,
  getRecentRateChanges,
  getNewsEntries,
  getNewsEntry,
  hasRateData,
  hasNewsData,
  getRatesFeed,
  getNewsFeed,
};
