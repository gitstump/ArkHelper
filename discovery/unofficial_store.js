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
 * Per-cycle, server_mods is replaced from the trimmed `modIds` array
 * (consumers of trimUnofficialServer). mods holds CurseForge metadata
 * resolved out-of-band; adoption counts only currently-listed servers
 * (last_seen == unofficial_meta.last_fetch_at).
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

CREATE TABLE IF NOT EXISTS server_mods (
  server_key TEXT NOT NULL,
  mod_id INTEGER NOT NULL,
  PRIMARY KEY (server_key, mod_id)
);

CREATE TABLE IF NOT EXISTS mods (
  mod_id INTEGER PRIMARY KEY,
  name TEXT,
  author TEXT,
  summary TEXT,
  download_count INTEGER,
  logo_url TEXT,
  website_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  resolved_at TEXT,
  refreshed_at TEXT
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

function positiveInt(value) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
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
  const deleteMods = db.prepare('DELETE FROM server_mods WHERE server_key = ?');
  const insertMod = db.prepare('INSERT OR IGNORE INTO server_mods (server_key, mod_id) VALUES (?, ?)');

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
      deleteMods.run(s.id);
      const ids = Array.isArray(s.modIds) ? s.modIds : [];
      for (const rawId of ids) {
        const modId = positiveInt(rawId);
        if (modId == null) continue;
        insertMod.run(s.id, modId);
      }
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

function getUnknownModIds(db, limit = 200) {
  const cap = Number.isInteger(limit) && limit > 0 ? limit : 200;
  const rows = db.prepare(`
    SELECT sm.mod_id AS mod_id
    FROM server_mods sm
    LEFT JOIN mods m ON m.mod_id = sm.mod_id
    WHERE m.mod_id IS NULL
    GROUP BY sm.mod_id
    ORDER BY COUNT(*) DESC, sm.mod_id ASC
    LIMIT ?
  `).all(cap);
  return rows.map((r) => r.mod_id);
}

function getStaleModIds(db, olderThanIso, limit = 50) {
  const cap = Number.isInteger(limit) && limit > 0 ? limit : 50;
  const cutoff = olderThanIso || '';
  const rows = db.prepare(`
    SELECT mod_id
    FROM mods
    WHERE refreshed_at IS NOT NULL AND refreshed_at < ?
    ORDER BY refreshed_at ASC, mod_id ASC
    LIMIT ?
  `).all(cutoff, cap);
  return rows.map((r) => r.mod_id);
}

function rowField(row, ...keys) {
  for (const key of keys) {
    if (row[key] !== undefined) return row[key];
  }
  return undefined;
}

function upsertMods(db, modRows, { now = () => new Date().toISOString() } = {}) {
  const nowIso = now();
  const stmt = db.prepare(`
    INSERT INTO mods (
      mod_id, name, author, summary, download_count, logo_url, website_url,
      status, resolved_at, refreshed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ok', ?, ?)
    ON CONFLICT(mod_id) DO UPDATE SET
      name = excluded.name,
      author = excluded.author,
      summary = excluded.summary,
      download_count = excluded.download_count,
      logo_url = excluded.logo_url,
      website_url = excluded.website_url,
      status = 'ok',
      resolved_at = excluded.resolved_at,
      refreshed_at = excluded.refreshed_at
  `);
  for (const row of modRows || []) {
    if (!row) continue;
    const modId = positiveInt(rowField(row, 'mod_id', 'id'));
    if (modId == null) continue;
    const download = rowField(row, 'download_count', 'downloadCount');
    stmt.run(
      modId,
      rowField(row, 'name') ?? null,
      rowField(row, 'author') ?? null,
      rowField(row, 'summary') ?? null,
      typeof download === 'number' && Number.isFinite(download) ? download : null,
      rowField(row, 'logo_url', 'logoUrl') ?? null,
      rowField(row, 'website_url', 'websiteUrl') ?? null,
      nowIso,
      nowIso
    );
  }
}

function markModsFailed(db, modIds, { now = () => new Date().toISOString() } = {}) {
  const nowIso = now();
  const stmt = db.prepare(`
    INSERT INTO mods (mod_id, status, resolved_at, refreshed_at)
    VALUES (?, 'error', ?, ?)
    ON CONFLICT(mod_id) DO UPDATE SET
      status = 'error',
      resolved_at = excluded.resolved_at,
      refreshed_at = excluded.refreshed_at
  `);
  for (const rawId of modIds || []) {
    const modId = positiveInt(rawId);
    if (modId == null) continue;
    stmt.run(modId, nowIso, nowIso);
  }
}

function resolveLastFetchAt(db, lastFetchAt) {
  if (lastFetchAt) return lastFetchAt;
  const meta = getUnofficialMeta(db);
  return meta.last_fetch_at || null;
}

function mapModSummaryRow(row) {
  return {
    mod_id: row.mod_id,
    name: row.name ?? null,
    author: row.author ?? null,
    summary: row.summary ?? null,
    download_count: row.download_count ?? null,
    logo_url: row.logo_url ?? null,
    website_url: row.website_url ?? null,
    status: row.status ?? null,
    server_count: row.server_count,
    players_now: row.players_now,
  };
}

function getModsSummary(db, { limit = 100, lastFetchAt } = {}) {
  const cap = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 100;
  const fetchAt = resolveLastFetchAt(db, lastFetchAt);
  if (!fetchAt) return [];
  const rows = db.prepare(`
    SELECT
      sm.mod_id AS mod_id,
      m.name AS name,
      m.author AS author,
      m.summary AS summary,
      m.download_count AS download_count,
      m.logo_url AS logo_url,
      m.website_url AS website_url,
      m.status AS status,
      COUNT(*) AS server_count,
      COALESCE(SUM(us.players_now), 0) AS players_now
    FROM server_mods sm
    INNER JOIN unofficial_servers us ON us.server_key = sm.server_key
    LEFT JOIN mods m ON m.mod_id = sm.mod_id
    WHERE us.last_seen = ?
    GROUP BY sm.mod_id
    ORDER BY server_count DESC, players_now DESC, sm.mod_id ASC
    LIMIT ?
  `).all(fetchAt, cap);
  return rows.map(mapModSummaryRow);
}

function getMod(db, modId, { lastFetchAt, serverLimit = 200 } = {}) {
  const id = positiveInt(modId);
  if (id == null) return null;
  const meta = db.prepare('SELECT * FROM mods WHERE mod_id = ?').get(id) || null;
  const used = db.prepare('SELECT 1 AS ok FROM server_mods WHERE mod_id = ? LIMIT 1').get(id);
  if (!meta && !used) return null;

  const fetchAt = resolveLastFetchAt(db, lastFetchAt);
  const cap = Number.isInteger(serverLimit) && serverLimit > 0 ? serverLimit : 200;
  const servers = fetchAt
    ? db.prepare(`
        SELECT us.server_key AS server_key, us.name AS name, us.map AS map, us.players_now AS players_now
        FROM server_mods sm
        INNER JOIN unofficial_servers us ON us.server_key = sm.server_key
        WHERE sm.mod_id = ? AND us.last_seen = ?
        ORDER BY us.players_now DESC, us.server_key ASC
        LIMIT ?
      `).all(id, fetchAt, cap)
    : [];

  return {
    mod_id: id,
    name: meta ? meta.name : null,
    author: meta ? meta.author : null,
    summary: meta ? meta.summary : null,
    download_count: meta ? meta.download_count : null,
    logo_url: meta ? meta.logo_url : null,
    website_url: meta ? meta.website_url : null,
    status: meta ? meta.status : null,
    servers: servers.map((s) => ({
      server_key: s.server_key,
      name: s.name ?? null,
      map: s.map ?? null,
      players_now: s.players_now ?? null,
    })),
  };
}

module.exports = {
  openUnofficialDb,
  recordUnofficialCycle,
  recordUnofficialFetchFailure,
  getUnofficialMeta,
  getUnofficialServer,
  getUnknownModIds,
  getStaleModIds,
  upsertMods,
  markModsFailed,
  getModsSummary,
  getMod,
};
