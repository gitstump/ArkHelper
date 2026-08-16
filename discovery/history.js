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
// Composite ranking algorithm.
//
// Modeled on the same three factors arkstatus.com documents using for
// its own leaderboards (reliability, activity, connection stability),
// weighted the same way (45/35/20) — but this is our own
// implementation, not a copy of theirs; the exact normalization
// approach below is a design choice, not a reverse-engineered formula.
// Worth knowing that if you ever compare our ranks to arkstatus's
// directly, they won't match exactly even for the same server.
//
//   Reliability (45%)  — uptime % in the window (same metric the
//                         uptime leaderboard already uses)
//   Activity (35%)     — average player count, normalized against the
//                         highest average seen among eligible servers
//                         in this same computation (so it's relative
//                         to the current network, not an absolute
//                         player-count threshold)
//   Stability (20%)    — inverse of ping variance (std deviation),
//                         normalized the same relative way. Servers
//                         with fewer than 2 ping samples get a neutral
//                         50 rather than being penalized for missing
//                         data they haven't had time to accumulate.
//
// This runs as ONE bulk SQL pass across every eligible server rather
// than looping per-server — with thousands of tracked servers, N
// separate queries each would be far too slow.
// ---------------------------------------------------------------------
function computeNetworkRanking(db, { sinceIso, minRuns = 5, limit } = {}) {
  const totalRuns = sinceIso
    ? db.prepare('SELECT COUNT(*) as c FROM snapshot_runs WHERE run_at >= ?').get(sinceIso).c
    : db.prepare('SELECT COUNT(*) as c FROM snapshot_runs').get().c;

  if (totalRuns === 0) return { totalRuns: 0, servers: [] };

  const query = `
    SELECT
      server_id,
      COUNT(*) as present_count,
      AVG(players_now) as avg_players,
      AVG(CASE WHEN ping IS NOT NULL THEN ping END) as avg_ping,
      AVG(CASE WHEN ping IS NOT NULL THEN ping * ping END) as avg_ping_sq,
      SUM(CASE WHEN ping IS NOT NULL THEN 1 ELSE 0 END) as ping_sample_count
    FROM server_snapshots
    ${sinceIso ? 'WHERE seen_at >= ?' : ''}
    GROUP BY server_id
    HAVING present_count >= ?
  `;
  const rows = sinceIso ? db.prepare(query).all(sinceIso, minRuns) : db.prepare(query).all(minRuns);

  const withRaw = rows.map((r) => {
    let stdDev = null;
    if (r.ping_sample_count >= 2) {
      const variance = Math.max(0, r.avg_ping_sq - r.avg_ping * r.avg_ping); // clamp tiny negative float error to 0
      stdDev = Math.sqrt(variance);
    }
    return {
      serverId: r.server_id,
      presentCount: r.present_count,
      reliabilityScore: (r.present_count / totalRuns) * 100,
      avgPlayers: r.avg_players ?? 0,
      pingStdDev: stdDev,
    };
  });

  const maxAvgPlayers = Math.max(0, ...withRaw.map((r) => r.avgPlayers));
  const maxPingStdDev = Math.max(0, ...withRaw.filter((r) => r.pingStdDev !== null).map((r) => r.pingStdDev));

  const scored = withRaw.map((r) => {
    const activityScore = maxAvgPlayers > 0 ? (r.avgPlayers / maxAvgPlayers) * 100 : 0;
    const stabilityScore = r.pingStdDev === null ? 50 : maxPingStdDev > 0 ? 100 - (r.pingStdDev / maxPingStdDev) * 100 : 100;
    const compositeScore = r.reliabilityScore * 0.45 + activityScore * 0.35 + stabilityScore * 0.2;
    return {
      serverId: r.serverId,
      reliabilityScore: Math.round(r.reliabilityScore * 10) / 10,
      activityScore: Math.round(activityScore * 10) / 10,
      stabilityScore: Math.round(stabilityScore * 10) / 10,
      compositeScore: Math.round(compositeScore * 10) / 10,
    };
  });

  scored.sort((a, b) => b.compositeScore - a.compositeScore);
  const limited = typeof limit === 'number' ? scored.slice(0, limit) : scored;
  const ranked = limited.map((s, i) => ({ ...s, rank: i + 1 }));

  return { totalRuns, eligibleServerCount: scored.length, servers: ranked };
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

module.exports = {
  openHistoryDb,
  recordSnapshotRun,
  detectAndLogChanges,
  getChangeLog,
  computeUptimePercent,
  getServerHistory,
  getServerRunHistory,
  computePeakTimes,
  computeDowntimePatterns,
  computeTopUptimeServers,
  computeNetworkRanking,
  getRankNeighborhood,
  pruneOldSnapshots,
};
