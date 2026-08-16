#!/usr/bin/env node
'use strict';

/**
 * history.js
 *
 * Every discovery refresh cycle overwrites roster.json, so there was
 * nowhere for history to accumulate. This records a lightweight
 * snapshot of who was present at each run, so uptime % and per-server
 * history become computable once enough runs have happened.
 *
 * HONEST LIMITATION: our data source (Wildcard's official server list)
 * only tells us a server is CURRENTLY REGISTERED, not explicitly
 * "online"/"offline"/"restarting" the way direct A2S querying would.
 * So "uptime %" here really means "% of discovery runs in which this
 * server appeared in the official list" — a reasonable proxy, but not
 * as precise as a tool that pings each server directly. Worth knowing
 * before treating this number as gospel.
 *
 * Uses node:sqlite, same as the accounts DB — no new dependency.
 */

const { DatabaseSync } = require('node:sqlite');
const { scoreServer, RANKING_WINDOW_DAYS } = require('./ranking.js');
const {
  THRESHOLDS,
  advanceDetector,
  computeOfflineStats,
  verdictKeyForState,
  round1,
} = require('./incidents.js');

const DAY_MS = 24 * 60 * 60 * 1000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS snapshot_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshot_runs_at ON snapshot_runs(run_at);

CREATE TABLE IF NOT EXISTS server_snapshots (
  run_id INTEGER NOT NULL REFERENCES snapshot_runs(id),
  server_id TEXT NOT NULL,
  seen_at TEXT NOT NULL,
  players_now INTEGER,
  max_players INTEGER,
  day INTEGER,
  PRIMARY KEY (run_id, server_id)
);
CREATE INDEX IF NOT EXISTS idx_server_snapshots_server ON server_snapshots(server_id, seen_at);

CREATE TABLE IF NOT EXISTS change_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id TEXT NOT NULL,
  seen_at TEXT NOT NULL,
  change_type TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT
);
CREATE INDEX IF NOT EXISTS idx_change_log_server ON change_log(server_id, seen_at);

CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  peak_offline_pct REAL,
  servers_affected INTEGER
);
CREATE INDEX IF NOT EXISTS idx_incidents_started ON incidents(started_at DESC);

CREATE TABLE IF NOT EXISTS incident_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  observed_at TEXT NOT NULL,
  offline_pct REAL,
  online_count INTEGER,
  total_known INTEGER,
  roster_fetch_failed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_incident_obs_at ON incident_observations(observed_at);

CREATE TABLE IF NOT EXISTS incident_detector_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  consecutive_fetch_failures INTEGER NOT NULL DEFAULT 0,
  consecutive_normal_cycles INTEGER NOT NULL DEFAULT 0,
  active_incident_id INTEGER,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS incident_status (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  payload TEXT NOT NULL,
  computed_at TEXT NOT NULL
);
`;

function openHistoryDb(dbPath) {
  const db = new DatabaseSync(dbPath);
  // WAL mode lets a reader (the auth service, via the HTTP endpoint) read
  // concurrently with the writer (discovery's refresh cycle) without
  // blocking on each other — the two run as separate processes.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(SCHEMA);
  // Lightweight migration: `version` was added to server_snapshots after
  // some DBs may already exist without it. SQLite has no "ADD COLUMN IF
  // NOT EXISTS", so this just tries and swallows the "already exists"
  // error — fine for a single-file local DB at this stage; a real
  // migration framework would be overkill here.
  try {
    db.exec('ALTER TABLE server_snapshots ADD COLUMN version TEXT');
  } catch (err) {
    if (!/duplicate column name/i.test(err.message)) throw err;
  }
  try {
    db.exec('ALTER TABLE server_snapshots ADD COLUMN ping INTEGER');
  } catch (err) {
    if (!/duplicate column name/i.test(err.message)) throw err;
  }
  return db;
}

// ---------------------------------------------------------------------
// Change detection (version changes, wipes) — runs BEFORE the new
// snapshot is inserted, so "previous" correctly means "as of the last
// run," not this one.
//
// Wipe heuristic: day count was 3+ and just dropped to 1 (or lower).
// A day count that merely goes down slightly isn't a wipe signal by
// itself — servers can report day count inconsistently around
// restarts — but a drop from an established game (3+ days in) back to
// day 1 is the same signal arkstatus.com documented using.
// ---------------------------------------------------------------------
function detectAndLogChanges(db, servers, runAt) {
  const getPrevious = db.prepare('SELECT day, version FROM server_snapshots WHERE server_id = ? ORDER BY seen_at DESC LIMIT 1');
  const insertChange = db.prepare('INSERT INTO change_log (server_id, seen_at, change_type, old_value, new_value) VALUES (?, ?, ?, ?, ?)');

  for (const s of servers) {
    if (!s.id) continue;
    const prev = getPrevious.get(s.id);
    if (!prev) continue; // first time seeing this server — nothing to compare against yet

    if (prev.version != null && s.version != null && prev.version !== s.version) {
      insertChange.run(s.id, runAt, 'version', prev.version, s.version);
    }
    if (prev.day != null && s.day != null && prev.day >= 3 && s.day <= 1 && s.day < prev.day) {
      insertChange.run(s.id, runAt, 'wipe', String(prev.day), String(s.day));
    }
  }
}

function getChangeLog(db, serverId, { limit = 20 } = {}) {
  return db
    .prepare('SELECT seen_at, change_type, old_value, new_value FROM change_log WHERE server_id = ? ORDER BY seen_at DESC LIMIT ?')
    .all(serverId, limit)
    .map((r) => ({ seenAt: r.seen_at, changeType: r.change_type, oldValue: r.old_value, newValue: r.new_value }));
}

function getRecentWipes(db, { sinceIso, limit = 5000 } = {}) {
  const rows = sinceIso
    ? db
        .prepare(
          `SELECT server_id, MAX(seen_at) as seen_at FROM change_log
           WHERE change_type = 'wipe' AND seen_at >= ?
           GROUP BY server_id ORDER BY seen_at DESC LIMIT ?`
        )
        .all(sinceIso, limit)
    : db
        .prepare(
          `SELECT server_id, MAX(seen_at) as seen_at FROM change_log
           WHERE change_type = 'wipe'
           GROUP BY server_id ORDER BY seen_at DESC LIMIT ?`
        )
        .all(limit);

  return rows.map((r) => ({ serverId: r.server_id, seenAt: r.seen_at }));
}

// ---------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------
function recordSnapshotRun(db, servers, { now = () => new Date().toISOString() } = {}) {
  const runAt = now();

  detectAndLogChanges(db, servers, runAt); // must run before inserting this run's rows

  const insertRun = db.prepare('INSERT INTO snapshot_runs (run_at) VALUES (?)');
  const runInfo = insertRun.run(runAt);
  const runId = runInfo.lastInsertRowid;

  const insertServer = db.prepare(
    'INSERT INTO server_snapshots (run_id, server_id, seen_at, players_now, max_players, day, version, ping) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  for (const s of servers) {
    if (!s.id) continue; // defensive — never let one bad record break the whole run
    insertServer.run(runId, s.id, runAt, s.playersNow ?? null, s.maxPlayers ?? null, s.day ?? null, s.version ?? null, s.wildcardReportedPing ?? null);
  }

  return { runId, runAt, serverCount: servers.length };
}

// ---------------------------------------------------------------------
// Uptime
// ---------------------------------------------------------------------
function computeUptimePercent(db, serverId, { sinceIso } = {}) {
  const totalRuns = sinceIso
    ? db.prepare('SELECT COUNT(*) as c FROM snapshot_runs WHERE run_at >= ?').get(sinceIso).c
    : db.prepare('SELECT COUNT(*) as c FROM snapshot_runs').get().c;

  if (totalRuns === 0) return { presentCount: 0, totalRuns: 0, uptimePercent: null };

  const presentCount = sinceIso
    ? db.prepare('SELECT COUNT(*) as c FROM server_snapshots WHERE server_id = ? AND seen_at >= ?').get(serverId, sinceIso).c
    : db.prepare('SELECT COUNT(*) as c FROM server_snapshots WHERE server_id = ?').get(serverId).c;

  return {
    presentCount,
    totalRuns,
    uptimePercent: Math.round((presentCount / totalRuns) * 1000) / 10, // one decimal place
  };
}

// ---------------------------------------------------------------------
// Per-server history (for charting later)
// ---------------------------------------------------------------------
function getServerHistory(db, serverId, { sinceIso, limit = 500 } = {}) {
  const rows = sinceIso
    ? db
        .prepare('SELECT seen_at, players_now, max_players, day FROM server_snapshots WHERE server_id = ? AND seen_at >= ? ORDER BY seen_at ASC LIMIT ?')
        .all(serverId, sinceIso, limit)
    : db
        .prepare('SELECT seen_at, players_now, max_players, day FROM server_snapshots WHERE server_id = ? ORDER BY seen_at ASC LIMIT ?')
        .all(serverId, limit);

  return rows.map((r) => ({ seenAt: r.seen_at, playersNow: r.players_now, maxPlayers: r.max_players, day: r.day }));
}

// ---------------------------------------------------------------------
// Full run history for one server — unlike getServerHistory (which only
// returns rows where the server was PRESENT), this returns every run in
// the window, present or not. That's what the heatmaps below need: a
// downtime pattern can only be seen by knowing which runs the server
// was ABSENT for, not just the ones where it showed up.
// ---------------------------------------------------------------------
function getServerRunHistory(db, serverId, { sinceIso } = {}) {
  const rows = sinceIso
    ? db
        .prepare(
          `SELECT sr.run_at as run_at, ss.server_id IS NOT NULL as present, ss.players_now as players_now
           FROM snapshot_runs sr
           LEFT JOIN server_snapshots ss ON ss.run_id = sr.id AND ss.server_id = ?
           WHERE sr.run_at >= ?
           ORDER BY sr.run_at ASC`
        )
        .all(serverId, sinceIso)
    : db
        .prepare(
          `SELECT sr.run_at as run_at, ss.server_id IS NOT NULL as present, ss.players_now as players_now
           FROM snapshot_runs sr
           LEFT JOIN server_snapshots ss ON ss.run_id = sr.id AND ss.server_id = ?
           ORDER BY sr.run_at ASC`
        )
        .all(serverId);

  return rows.map((r) => ({ runAt: r.run_at, present: Boolean(r.present), playersNow: r.players_now }));
}

// ---------------------------------------------------------------------
// Peak-times heatmap — average players by (day of week, hour), UTC.
// Only counts runs where the server was present (a heatmap of "how
// crowded is it when it's up," not conflated with downtime).
// ---------------------------------------------------------------------
function computePeakTimes(db, serverId, { sinceIso } = {}) {
  const runs = getServerRunHistory(db, serverId, { sinceIso });
  const buckets = new Map(); // key: "dow-hour" -> { sum, count }

  for (const r of runs) {
    if (!r.present || typeof r.playersNow !== 'number') continue;
    const d = new Date(r.runAt);
    const key = `${d.getUTCDay()}-${d.getUTCHours()}`;
    const bucket = buckets.get(key) || { sum: 0, count: 0 };
    bucket.sum += r.playersNow;
    bucket.count += 1;
    buckets.set(key, bucket);
  }

  const grid = [];
  for (let dow = 0; dow < 7; dow += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      const bucket = buckets.get(`${dow}-${hour}`);
      grid.push({
        dayOfWeek: dow,
        hour,
        avgPlayers: bucket ? Math.round((bucket.sum / bucket.count) * 10) / 10 : null,
        sampleCount: bucket ? bucket.count : 0,
      });
    }
  }
  return grid;
}

// ---------------------------------------------------------------------
// Downtime-patterns heatmap — % of runs the server was ABSENT for, by
// (day of week, hour), UTC. High values mean "this server tends to be
// down/restarting around this time."
// ---------------------------------------------------------------------
function computeDowntimePatterns(db, serverId, { sinceIso } = {}) {
  const runs = getServerRunHistory(db, serverId, { sinceIso });
  const buckets = new Map(); // key: "dow-hour" -> { total, absent }

  for (const r of runs) {
    const d = new Date(r.runAt);
    const key = `${d.getUTCDay()}-${d.getUTCHours()}`;
    const bucket = buckets.get(key) || { total: 0, absent: 0 };
    bucket.total += 1;
    if (!r.present) bucket.absent += 1;
    buckets.set(key, bucket);
  }

  const grid = [];
  for (let dow = 0; dow < 7; dow += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      const bucket = buckets.get(`${dow}-${hour}`);
      grid.push({
        dayOfWeek: dow,
        hour,
        downtimePercent: bucket && bucket.total > 0 ? Math.round((bucket.absent / bucket.total) * 1000) / 10 : null,
        totalRuns: bucket ? bucket.total : 0,
      });
    }
  }
  return grid;
}

// ---------------------------------------------------------------------
// Retention (not wired into the automatic refresh cycle yet — call this
// periodically yourself, e.g. from a daily cron/task, once you have an
// opinion about how much history to keep. Deleting old snapshot_runs
// rows cascades to their server_snapshots via the WHERE below.)
// ---------------------------------------------------------------------
function pruneOldSnapshots(db, beforeIso) {
  const oldRunIds = db.prepare('SELECT id FROM snapshot_runs WHERE run_at < ?').all(beforeIso).map((r) => r.id);
  if (oldRunIds.length === 0) return { runsRemoved: 0, snapshotsRemoved: 0 };

  const placeholders = oldRunIds.map(() => '?').join(',');
  const snapshotsRemoved = db.prepare(`DELETE FROM server_snapshots WHERE run_id IN (${placeholders})`).run(...oldRunIds).changes;
  const runsRemoved = db.prepare(`DELETE FROM snapshot_runs WHERE id IN (${placeholders})`).run(...oldRunIds).changes;

  return { runsRemoved, snapshotsRemoved };
}

// ---------------------------------------------------------------------
// Top-uptime leaderboard. Orders by raw presence count rather than
// computing a percentage per row and sorting on that — since totalRuns
// is the same denominator for every server within a given window,
// ordering by presentCount DESC is exactly equivalent to ordering by
// uptimePercent DESC, and is a much simpler query.
//
// minRuns exists to avoid a server that's only appeared once or twice
// looking like a "100% uptime" leader by coincidence — it needs a
// reasonable amount of history before it's eligible to rank at all.
// ---------------------------------------------------------------------
function computeTopUptimeServers(db, { sinceIso, limit = 20, minRuns = 5 } = {}) {
  const totalRuns = sinceIso
    ? db.prepare('SELECT COUNT(*) as c FROM snapshot_runs WHERE run_at >= ?').get(sinceIso).c
    : db.prepare('SELECT COUNT(*) as c FROM snapshot_runs').get().c;

  if (totalRuns === 0) return { totalRuns: 0, servers: [] };

  const rows = sinceIso
    ? db
        .prepare(
          `SELECT server_id, COUNT(*) as present_count FROM server_snapshots WHERE seen_at >= ?
           GROUP BY server_id HAVING present_count >= ? ORDER BY present_count DESC LIMIT ?`
        )
        .all(sinceIso, minRuns, limit)
    : db
        .prepare(
          `SELECT server_id, COUNT(*) as present_count FROM server_snapshots
           GROUP BY server_id HAVING present_count >= ? ORDER BY present_count DESC LIMIT ?`
        )
        .all(minRuns, limit);

  return {
    totalRuns,
    servers: rows.map((r) => ({
      serverId: r.server_id,
      presentCount: r.present_count,
      uptimePercent: Math.round((r.present_count / totalRuns) * 1000) / 10,
    })),
  };
}

// ---------------------------------------------------------------------
// Composite ranking.
//
// Scoring itself is pure and lives in ranking.js. This gathers the
// inputs from history (one bulk SQL pass — looping per-server would
// be too slow at a few thousand tracked servers) and hands them to
// scoreServer. Uptime is computed over runs since the server was
// first seen in the window ("use what exists" when history is thin);
// confidence, not a minRuns gate, is what stops a brand-new server
// from outranking an established one on a single lucky snapshot.
//
// pingByServerId, when provided, is the live roster ping (the
// monitoring-path value). Without it we fall back to the average
// ping stored on snapshots.
// ---------------------------------------------------------------------
function latestRunAt(db) {
  const row = db.prepare('SELECT MAX(run_at) as t FROM snapshot_runs').get();
  return row && row.t ? row.t : null;
}

function countRunsOnOrAfter(runAts, firstSeen) {
  let count = 0;
  for (const t of runAts) {
    if (t >= firstSeen) count += 1;
  }
  return count;
}

function gatherRankingStats(db, { sinceIso, nowIso } = {}) {
  const now = nowIso || latestRunAt(db);
  if (!now) return { nowIso: null, sinceIso: sinceIso || null, runAts: [], byServerId: new Map(), totalRuns: 0 };

  const windowStart = sinceIso || new Date(Date.parse(now) - RANKING_WINDOW_DAYS * DAY_MS).toISOString();
  const runAts = db
    .prepare('SELECT run_at FROM snapshot_runs WHERE run_at >= ? ORDER BY run_at ASC')
    .all(windowStart)
    .map((r) => r.run_at);

  if (runAts.length === 0) {
    return { nowIso: now, sinceIso: windowStart, runAts, byServerId: new Map(), totalRuns: 0 };
  }

  const rows = db
    .prepare(
      `SELECT
         server_id,
         COUNT(*) as present_count,
         MIN(seen_at) as first_seen,
         AVG(CASE WHEN max_players > 0 THEN CAST(players_now AS REAL) / max_players END) as avg_pop_ratio,
         AVG(CASE WHEN ping IS NOT NULL THEN ping END) as avg_ping
       FROM server_snapshots
       WHERE seen_at >= ?
       GROUP BY server_id`
    )
    .all(windowStart);

  const byServerId = new Map();
  for (const r of rows) {
    const firstSeen = r.first_seen;
    const runsSinceFirst = Math.max(1, countRunsOnOrAfter(runAts, firstSeen));
    byServerId.set(r.server_id, {
      serverId: r.server_id,
      presentCount: r.present_count,
      uptimePercent: (r.present_count / runsSinceFirst) * 100,
      avgPopulationPercent: (r.avg_pop_ratio ?? 0) * 100,
      avgPing: r.avg_ping,
      historyAgeDays: Math.max(0, (Date.parse(now) - Date.parse(firstSeen)) / DAY_MS),
    });
  }

  return { nowIso: now, sinceIso: windowStart, runAts, byServerId, totalRuns: runAts.length };
}

function computeNetworkRanking(db, { sinceIso, nowIso, minRuns = 0, limit, pingByServerId } = {}) {
  const gathered = gatherRankingStats(db, { sinceIso, nowIso });
  if (gathered.totalRuns === 0) return { totalRuns: 0, eligibleServerCount: 0, servers: [] };

  const scored = [];
  for (const stats of gathered.byServerId.values()) {
    if (stats.presentCount < minRuns) continue;
    const pingMs = pingByServerId && pingByServerId.has(stats.serverId) ? pingByServerId.get(stats.serverId) : stats.avgPing;
    const result = scoreServer({
      uptimePercent: stats.uptimePercent,
      pingMs,
      avgPopulationPercent: stats.avgPopulationPercent,
      historyAgeDays: stats.historyAgeDays,
    });
    scored.push({
      serverId: stats.serverId,
      rankScore: result.rankScore,
      components: result.components,
    });
  }

  scored.sort((a, b) => b.rankScore - a.rankScore || String(a.serverId).localeCompare(String(b.serverId)));
  const limited = typeof limit === 'number' ? scored.slice(0, limit) : scored;
  const ranked = limited.map((s, i) => ({ ...s, rank: i + 1 }));

  return { totalRuns: gathered.totalRuns, eligibleServerCount: scored.length, servers: ranked };
}

// Stamps rankScore / rank / rankComponents onto the live roster
// servers (mutates in place, same pattern as country enrichment) so
// the accounts service can sort and render ranks from /roster without
// a second query. Ordinal `rank` is among the current roster, not
// among historical servers that have since dropped off.
function applyRankingToServers(servers, db, { sinceIso, nowIso } = {}) {
  const pingByServerId = new Map();
  for (const s of servers) {
    if (s && s.id) pingByServerId.set(s.id, s.wildcardReportedPing);
  }

  const ranking = computeNetworkRanking(db, { sinceIso, nowIso, pingByServerId });
  const byId = new Map(ranking.servers.map((r) => [r.serverId, r]));

  const withScores = [];
  for (const s of servers) {
    const r = s && s.id ? byId.get(s.id) : null;
    if (r) {
      withScores.push({ server: s, rankScore: r.rankScore, components: r.components });
    } else if (s) {
      s.rankScore = null;
      s.rank = null;
      s.rankComponents = null;
    }
  }

  withScores.sort((a, b) => b.rankScore - a.rankScore || String(a.server.id).localeCompare(String(b.server.id)));
  withScores.forEach((entry, i) => {
    entry.server.rankScore = entry.rankScore;
    entry.server.rank = i + 1;
    entry.server.rankComponents = entry.components;
  });

  return ranking;
}

// Finds one server's rank plus its neighbors in the full ranking —
// call computeNetworkRanking without a limit first, then this. Kept
// separate (pure JS, no DB call) so callers who already have the full
// ranked list don't need to recompute it just to slice a neighborhood.
function getRankNeighborhood(rankedServers, serverId, { radius = 5 } = {}) {
  const index = rankedServers.findIndex((s) => s.serverId === serverId);
  if (index === -1) return null;
  const start = Math.max(0, index - radius);
  const end = Math.min(rankedServers.length, index + radius + 1);
  return {
    rank: rankedServers[index].rank,
    percentile: Math.round((1 - index / rankedServers.length) * 1000) / 10,
    totalRanked: rankedServers.length,
    neighbors: rankedServers.slice(start, end),
  };
}

// ---------------------------------------------------------------------
// Incident detection (runs after a snapshot is recorded, or on a
// failed roster fetch). The public status page reads the stored
// snapshot — it never recomputes these numbers per request.
// ---------------------------------------------------------------------
function isoMinus(nowIso, ms) {
  return new Date(Date.parse(nowIso) - ms).toISOString();
}

function listKnownServerIds(db, sinceIso) {
  return db.prepare('SELECT DISTINCT server_id FROM server_snapshots WHERE seen_at >= ?').all(sinceIso).map((r) => r.server_id);
}

function getBaselineOfflinePct(db, { sinceIso, beforeIso }) {
  const row = db
    .prepare(
      `SELECT AVG(offline_pct) as avg_pct FROM incident_observations
       WHERE observed_at >= ? AND observed_at < ? AND roster_fetch_failed = 0 AND offline_pct IS NOT NULL`
    )
    .get(sinceIso, beforeIso);
  return row && typeof row.avg_pct === 'number' && Number.isFinite(row.avg_pct) ? row.avg_pct : 0;
}

function getVersionRolloutPct(db, { sinceIso, totalKnown }) {
  if (!totalKnown) return 0;
  const row = db.prepare("SELECT COUNT(DISTINCT server_id) as c FROM change_log WHERE change_type = 'version' AND seen_at >= ?").get(sinceIso);
  return (((row && row.c) || 0) / totalKnown) * 100;
}

function ensureDetectorState(db, nowIso) {
  db.prepare(
    `INSERT OR IGNORE INTO incident_detector_state (id, consecutive_fetch_failures, consecutive_normal_cycles, active_incident_id, updated_at)
     VALUES (1, 0, 0, NULL, ?)`
  ).run(nowIso);
  return db.prepare('SELECT * FROM incident_detector_state WHERE id = 1').get();
}

function getActiveIncident(db) {
  return rowToIncident(db.prepare('SELECT * FROM incidents WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1').get());
}

function listIncidents(db, { limit = 20 } = {}) {
  return db
    .prepare('SELECT * FROM incidents ORDER BY started_at DESC, id DESC LIMIT ?')
    .all(limit)
    .map(rowToIncident);
}

function rowToIncident(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    peakOfflinePct: row.peak_offline_pct,
    serversAffected: row.servers_affected,
  };
}

function durationMs(startedAt, endedAt) {
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return end - start;
}

function getIncidentStatus(db) {
  const row = db.prepare('SELECT payload FROM incident_status WHERE id = 1').get();
  if (!row) return null;
  try {
    return JSON.parse(row.payload);
  } catch {
    return null;
  }
}

function recordIncidentCycle(db, { rosterFetchFailed = false, presentServerIds = [], now = () => new Date().toISOString() } = {}) {
  const nowIso = now();
  const detector = ensureDetectorState(db, nowIso);
  const active = detector.active_incident_id
    ? rowToIncident(db.prepare('SELECT * FROM incidents WHERE id = ?').get(detector.active_incident_id))
    : getActiveIncident(db);

  let offlinePct = null;
  let onlineCount = null;
  let totalKnown = 0;
  let serversAffected = 0;
  let versionRolloutPct = 0;

  if (!rosterFetchFailed) {
    const knownIds = listKnownServerIds(db, isoMinus(nowIso, THRESHOLDS.KNOWN_SERVERS_LOOKBACK_MS));
    const stats = computeOfflineStats(knownIds, presentServerIds);
    offlinePct = stats.offlinePct;
    onlineCount = stats.onlineCount;
    totalKnown = stats.totalKnown;
    serversAffected = stats.serversAffected;
    versionRolloutPct = getVersionRolloutPct(db, {
      sinceIso: isoMinus(nowIso, THRESHOLDS.VERSION_ROLLOUT_WINDOW_MS),
      totalKnown: totalKnown || presentServerIds.length,
    });
  }

  const baselinePct = round1(getBaselineOfflinePct(db, { sinceIso: isoMinus(nowIso, THRESHOLDS.BASELINE_WINDOW_MS), beforeIso: nowIso })) || 0;

  db.prepare(
    'INSERT INTO incident_observations (observed_at, offline_pct, online_count, total_known, roster_fetch_failed) VALUES (?, ?, ?, ?, ?)'
  ).run(nowIso, offlinePct, onlineCount, totalKnown || null, rosterFetchFailed ? 1 : 0);

  const next = advanceDetector({
    consecutiveFetchFailures: detector.consecutive_fetch_failures,
    consecutiveNormalCycles: detector.consecutive_normal_cycles,
    activeIncident: active,
    rosterFetchFailed,
    offlinePct,
    baselinePct,
    versionRolloutPct: round1(versionRolloutPct) || 0,
    serversAffected,
  });

  let activeIncidentId = detector.active_incident_id || (active && active.id) || null;

  if (next.closeIncident && activeIncidentId) {
    db.prepare('UPDATE incidents SET ended_at = ? WHERE id = ? AND ended_at IS NULL').run(nowIso, activeIncidentId);
    activeIncidentId = null;
  } else if (next.openNew && next.incident) {
    const result = db
      .prepare('INSERT INTO incidents (type, started_at, ended_at, peak_offline_pct, servers_affected) VALUES (?, ?, NULL, ?, ?)')
      .run(next.incident.type, nowIso, next.incident.peakOfflinePct, next.incident.serversAffected);
    activeIncidentId = Number(result.lastInsertRowid);
  } else if (next.incident && activeIncidentId) {
    db.prepare('UPDATE incidents SET type = ?, peak_offline_pct = ?, servers_affected = ? WHERE id = ? AND ended_at IS NULL').run(
      next.incident.type,
      next.incident.peakOfflinePct,
      next.incident.serversAffected,
      activeIncidentId
    );
  }

  db.prepare(
    `UPDATE incident_detector_state
     SET consecutive_fetch_failures = ?, consecutive_normal_cycles = ?, active_incident_id = ?, updated_at = ?
     WHERE id = 1`
  ).run(next.consecutiveFetchFailures, next.consecutiveNormalCycles, activeIncidentId, nowIso);

  const storedActive = activeIncidentId ? rowToIncident(db.prepare('SELECT * FROM incidents WHERE id = ?').get(activeIncidentId)) : null;
  const incidents = listIncidents(db, { limit: 20 }).map((inc) => ({
    ...inc,
    durationMs: durationMs(inc.startedAt, inc.endedAt || nowIso),
  }));

  const payload = {
    state: next.displayedState,
    verdictKey: verdictKeyForState(next.displayedState, rosterFetchFailed),
    offlinePct,
    baselinePct,
    onlineCount,
    totalKnown,
    serversAffected,
    versionRolloutPct: round1(versionRolloutPct) || 0,
    rosterFetchFailed: Boolean(rosterFetchFailed),
    consecutiveFetchFailures: next.consecutiveFetchFailures,
    computedAt: nowIso,
    activeIncident: storedActive,
    incidents,
  };

  db.prepare(
    `INSERT INTO incident_status (id, payload, computed_at) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, computed_at = excluded.computed_at`
  ).run(JSON.stringify(payload), nowIso);

  return payload;
}

module.exports = {
  openHistoryDb,
  recordSnapshotRun,
  detectAndLogChanges,
  getChangeLog,
  getRecentWipes,
  computeUptimePercent,
  getServerHistory,
  getServerRunHistory,
  computePeakTimes,
  computeDowntimePatterns,
  computeTopUptimeServers,
  computeNetworkRanking,
  applyRankingToServers,
  getRankNeighborhood,
  pruneOldSnapshots,
  recordIncidentCycle,
  getIncidentStatus,
  getActiveIncident,
  listIncidents,
};
