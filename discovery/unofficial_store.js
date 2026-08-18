#!/usr/bin/env node
'use strict';

/**
 * unofficial_store.js
 *
 * Aggregate-only SQLite store for unofficial servers. Separate file
 * from official history (unofficial.sqlite). One row per server key
 * with the latest trimmed fields plus first_seen / last_seen /
 * cycles_seen. A single meta row holds cycles_total and the last
 * fetch timestamp/status.
 *
 * Each successful cycle is one upsert pass: present servers are
 * updated and cycles_seen is bumped; absent servers are left
 * untouched. first_seen is never overwritten, so a server that
 * disappears and comes back keeps its original first_seen.
 *
 * Phase A does not record per-cycle history rows.
 */

const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS unofficial_servers (
  server_key TEXT PRIMARY KEY,
  name TEXT,
  map TEXT,
  game_mode TEXT,
  players_now INTEGER,
  max_players INTEGER,
  version TEXT,
  platform TEXT,
  ping INTEGER,
  has_password INTEGER,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  cycles_seen INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS unofficial_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  cycles_total INTEGER NOT NULL DEFAULT 0,
  last_fetch_at TEXT,
  last_fetch_status TEXT
);
`;

function openUnofficialDb(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(SCHEMA);
  db.prepare(
    'INSERT OR IGNORE INTO unofficial_meta (id, cycles_total, last_fetch_at, last_fetch_status) VALUES (1, 0, NULL, NULL)'
  ).run();
  return db;
}

function passwordFlag(value) {
  if (value === true) return 1;
  if (value === false) return 0;
  return null;
}

function recordUnofficialCycle(db, servers, { now = () => new Date().toISOString() } = {}) {
  const nowIso = now();
  const upsert = db.prepare(`
    INSERT INTO unofficial_servers (
      server_key, name, map, game_mode, players_now, max_players,
      version, platform, ping, has_password, first_seen, last_seen, cycles_seen
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(server_key) DO UPDATE SET
      name = excluded.name,
      map = excluded.map,
      game_mode = excluded.game_mode,
      players_now = excluded.players_now,
      max_players = excluded.max_players,
      version = excluded.version,
      platform = excluded.platform,
      ping = excluded.ping,
      has_password = excluded.has_password,
      last_seen = excluded.last_seen,
      cycles_seen = unofficial_servers.cycles_seen + 1
  `);
  const getRow = db.prepare('SELECT cycles_seen FROM unofficial_servers WHERE server_key = ?');
  const bumpMeta = db.prepare(
    `UPDATE unofficial_meta SET cycles_total = cycles_total + 1, last_fetch_at = ?, last_fetch_status = 'ok' WHERE id = 1`
  );

  db.exec('BEGIN');
  try {
    for (const s of servers || []) {
      if (!s || !s.id) continue;
      upsert.run(
        s.id,
        s.name ?? null,
        s.map ?? null,
        s.gameMode ?? null,
        typeof s.playersNow === 'number' ? s.playersNow : null,
        typeof s.maxPlayers === 'number' ? s.maxPlayers : null,
        s.version ?? null,
        s.platformType ?? s.platform ?? null,
        typeof s.ping === 'number' ? s.ping : typeof s.wildcardReportedPing === 'number' ? s.wildcardReportedPing : null,
        passwordFlag(s.hasPassword),
        nowIso,
        nowIso
      );
      const row = getRow.get(s.id);
      if (row) s.cycles_seen = row.cycles_seen;
    }
    bumpMeta.run(nowIso);
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore rollback failure
    }
    throw err;
  }
  return getUnofficialMeta(db);
}

function recordUnofficialFetchFailure(db, { now = () => new Date().toISOString(), error = 'error' } = {}) {
  const nowIso = now();
  const status = `error: ${String(error).slice(0, 200)}`;
  db.prepare(
    `UPDATE unofficial_meta SET last_fetch_at = ?, last_fetch_status = ? WHERE id = 1`
  ).run(nowIso, status);
  return getUnofficialMeta(db);
}

function getUnofficialMeta(db) {
  const row = db.prepare('SELECT cycles_total, last_fetch_at, last_fetch_status FROM unofficial_meta WHERE id = 1').get();
  const countRow = db.prepare('SELECT COUNT(*) AS n FROM unofficial_servers').get();
  const tracked_total = countRow && typeof countRow.n === 'number' ? countRow.n : 0;
  if (!row) {
    return { cycles_total: 0, last_fetch_at: null, last_fetch_status: null, tracked_total };
  }
  return {
    cycles_total: row.cycles_total,
    last_fetch_at: row.last_fetch_at,
    last_fetch_status: row.last_fetch_status,
    tracked_total,
  };
}

function getUnofficialServer(db, serverKey) {
  return db.prepare('SELECT * FROM unofficial_servers WHERE server_key = ?').get(serverKey) || null;
}

module.exports = {
  openUnofficialDb,
  recordUnofficialCycle,
  recordUnofficialFetchFailure,
  getUnofficialMeta,
  getUnofficialServer,
};
