'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const {
  openHistoryDb,
  recordSnapshotRun,
  detectAndLogChanges,
  getChangeEvents,
  pruneChangeEvents,
  maybePruneChangeEvents,
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
  detectStableChanges,
  recordIncidentCycle,
  getIncidentStatus,
  getActiveIncident,
  listIncidents,
} = require('./history.js');

function freshDb() {
  return openHistoryDb(':memory:');
}

function tmpHistoryDbFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ark-history-')), 'history.sqlite');
}

function servers(ids) {
  return ids.map((id) => ({ id, playersNow: 5, maxPlayers: 70, day: 100 }));
}

function changeLogRows(db, serverId) {
  return db
    .prepare(
      'SELECT change_type as changeType, old_value as oldValue, new_value as newValue FROM change_log WHERE server_id = ? ORDER BY seen_at DESC'
    )
    .all(serverId);
}

// ---------------------------------------------------------------------
// recordSnapshotRun
// ---------------------------------------------------------------------
test('recordSnapshotRun records a run and its servers', () => {
  const db = freshDb();
  const result = recordSnapshotRun(db, servers(['a', 'b', 'c']), { now: () => '2026-08-15T00:00:00.000Z' });
  assert.equal(result.serverCount, 3);
  assert.ok(result.runId);

  const runs = db.prepare('SELECT COUNT(*) as c FROM snapshot_runs').get();
  assert.equal(runs.c, 1);
  const snaps = db.prepare('SELECT COUNT(*) as c FROM server_snapshots').get();
  assert.equal(snaps.c, 3);
});

test('recordSnapshotRun skips servers without an id rather than failing the whole run', () => {
  const db = freshDb();
  const result = recordSnapshotRun(db, [{ id: 'a', playersNow: 1 }, { id: null, playersNow: 2 }, { playersNow: 3 }], {
    now: () => '2026-08-15T00:00:00.000Z',
  });
  assert.equal(result.serverCount, 3); // input count reported as-is
  const snaps = db.prepare('SELECT COUNT(*) as c FROM server_snapshots').get();
  assert.equal(snaps.c, 1); // only the one with a real id was actually recorded
});

test('recordSnapshotRun across multiple calls accumulates separate runs', () => {
  const db = freshDb();
  recordSnapshotRun(db, servers(['a']), { now: () => '2026-08-15T00:00:00.000Z' });
  recordSnapshotRun(db, servers(['a']), { now: () => '2026-08-15T01:00:00.000Z' });
  const runs = db.prepare('SELECT COUNT(*) as c FROM snapshot_runs').get();
  assert.equal(runs.c, 2);
});

// ---------------------------------------------------------------------
// computeUptimePercent
// ---------------------------------------------------------------------
test('computeUptimePercent is 100% when a server appeared in every run', () => {
  const db = freshDb();
  recordSnapshotRun(db, servers(['a', 'b']), { now: () => '2026-08-15T00:00:00.000Z' });
  recordSnapshotRun(db, servers(['a', 'b']), { now: () => '2026-08-15T01:00:00.000Z' });
  const result = computeUptimePercent(db, 'a');
  assert.equal(result.uptimePercent, 100);
  assert.equal(result.presentCount, 2);
  assert.equal(result.totalRuns, 2);
});

test('computeUptimePercent reflects a server missing from some runs', () => {
  const db = freshDb();
  recordSnapshotRun(db, servers(['a', 'b']), { now: () => '2026-08-15T00:00:00.000Z' });
  recordSnapshotRun(db, servers(['b']), { now: () => '2026-08-15T01:00:00.000Z' }); // "a" absent this run
  recordSnapshotRun(db, servers(['a', 'b']), { now: () => '2026-08-15T02:00:00.000Z' });
  const result = computeUptimePercent(db, 'a');
  assert.equal(result.presentCount, 2);
  assert.equal(result.totalRuns, 3);
  assert.equal(result.uptimePercent, 66.7);
});

test('computeUptimePercent returns null (not a crash) when no runs exist yet', () => {
  const db = freshDb();
  const result = computeUptimePercent(db, 'a');
  assert.equal(result.uptimePercent, null);
  assert.equal(result.totalRuns, 0);
});

test('computeUptimePercent is 0% for a server that never appeared, but runs did happen', () => {
  const db = freshDb();
  recordSnapshotRun(db, servers(['b']), { now: () => '2026-08-15T00:00:00.000Z' });
  const result = computeUptimePercent(db, 'never-seen');
  assert.equal(result.uptimePercent, 0);
  assert.equal(result.totalRuns, 1);
});

test('computeUptimePercent respects a sinceIso window', () => {
  const db = freshDb();
  recordSnapshotRun(db, servers(['a']), { now: () => '2026-08-01T00:00:00.000Z' }); // outside window
  recordSnapshotRun(db, servers([]), { now: () => '2026-08-15T00:00:00.000Z' }); // in window, "a" absent
  const result = computeUptimePercent(db, 'a', { sinceIso: '2026-08-10T00:00:00.000Z' });
  assert.equal(result.totalRuns, 1); // only the in-window run counts
  assert.equal(result.presentCount, 0);
  assert.equal(result.uptimePercent, 0);
});

// ---------------------------------------------------------------------
// getServerHistory
// ---------------------------------------------------------------------
test('getServerHistory returns chronologically ordered snapshots for one server', () => {
  const db = freshDb();
  recordSnapshotRun(db, [{ id: 'a', playersNow: 3, maxPlayers: 70, day: 10 }], { now: () => '2026-08-15T00:00:00.000Z' });
  recordSnapshotRun(db, [{ id: 'a', playersNow: 7, maxPlayers: 70, day: 11 }], { now: () => '2026-08-15T01:00:00.000Z' });

  const history = getServerHistory(db, 'a');
  assert.equal(history.length, 2);
  assert.equal(history[0].playersNow, 3);
  assert.equal(history[1].playersNow, 7);
  assert.equal(history[1].day, 11);
});

test('getServerHistory returns an empty array for a server with no history', () => {
  const db = freshDb();
  assert.deepEqual(getServerHistory(db, 'never-seen'), []);
});

test('getServerHistory respects the limit option', () => {
  const db = freshDb();
  for (let i = 0; i < 5; i += 1) {
    recordSnapshotRun(db, [{ id: 'a', playersNow: i }], { now: () => `2026-08-15T0${i}:00:00.000Z` });
  }
  assert.equal(getServerHistory(db, 'a', { limit: 2 }).length, 2);
});

// ---------------------------------------------------------------------
// pruneOldSnapshots
// ---------------------------------------------------------------------
test('pruneOldSnapshots removes runs and their snapshots before a cutoff, keeps newer ones', () => {
  const db = freshDb();
  recordSnapshotRun(db, servers(['a']), { now: () => '2026-01-01T00:00:00.000Z' }); // old
  recordSnapshotRun(db, servers(['a']), { now: () => '2026-08-15T00:00:00.000Z' }); // recent

  const result = pruneOldSnapshots(db, '2026-06-01T00:00:00.000Z');
  assert.equal(result.runsRemoved, 1);
  assert.equal(result.snapshotsRemoved, 1);

  const remainingRuns = db.prepare('SELECT COUNT(*) as c FROM snapshot_runs').get();
  assert.equal(remainingRuns.c, 1);
});

test('pruneOldSnapshots is a no-op when nothing is old enough to remove', () => {
  const db = freshDb();
  recordSnapshotRun(db, servers(['a']), { now: () => '2026-08-15T00:00:00.000Z' });
  const result = pruneOldSnapshots(db, '2020-01-01T00:00:00.000Z');
  assert.equal(result.runsRemoved, 0);
  assert.equal(result.snapshotsRemoved, 0);
});

// ---------------------------------------------------------------------
// computeTopUptimeServers
// ---------------------------------------------------------------------
test('computeTopUptimeServers ranks by presence count, which is equivalent to uptime% since totalRuns is constant', () => {
  const db = freshDb();
  // 5 runs total. "a" present in all 5, "b" present in 3, "c" present in 1.
  for (let i = 0; i < 5; i += 1) {
    const ids = i < 5 ? ['a'] : [];
    const present = ['a'];
    if (i < 3) present.push('b');
    if (i < 1) present.push('c');
    recordSnapshotRun(db, servers(present), { now: () => `2026-08-15T0${i}:00:00.000Z` });
  }

  const result = computeTopUptimeServers(db, { minRuns: 1 });
  assert.equal(result.totalRuns, 5);
  assert.deepEqual(result.servers.map((s) => s.serverId), ['a', 'b', 'c']);
  assert.equal(result.servers[0].uptimePercent, 100);
  assert.equal(result.servers[1].uptimePercent, 60);
  assert.equal(result.servers[2].uptimePercent, 20);
});

test('computeTopUptimeServers excludes servers below minRuns (avoids one-appearance "100%" noise)', () => {
  const db = freshDb();
  recordSnapshotRun(db, servers(['a', 'b']), { now: () => '2026-08-15T00:00:00.000Z' });
  recordSnapshotRun(db, servers(['a']), { now: () => '2026-08-15T01:00:00.000Z' }); // "b" only appeared once

  const result = computeTopUptimeServers(db, { minRuns: 2 });
  assert.deepEqual(result.servers.map((s) => s.serverId), ['a']);
});

test('computeTopUptimeServers respects the limit', () => {
  const db = freshDb();
  recordSnapshotRun(db, servers(['a', 'b', 'c']), { now: () => '2026-08-15T00:00:00.000Z' });
  const result = computeTopUptimeServers(db, { minRuns: 1, limit: 2 });
  assert.equal(result.servers.length, 2);
});

test('computeTopUptimeServers returns an empty leaderboard (not a crash) with no runs yet', () => {
  const db = freshDb();
  const result = computeTopUptimeServers(db);
  assert.equal(result.totalRuns, 0);
  assert.deepEqual(result.servers, []);
});

test('computeTopUptimeServers respects a sinceIso window', () => {
  const db = freshDb();
  recordSnapshotRun(db, servers(['a']), { now: () => '2026-01-01T00:00:00.000Z' }); // outside window
  recordSnapshotRun(db, servers(['b']), { now: () => '2026-08-15T00:00:00.000Z' }); // in window

  const result = computeTopUptimeServers(db, { minRuns: 1, sinceIso: '2026-08-01T00:00:00.000Z' });
  assert.equal(result.totalRuns, 1);
  assert.deepEqual(result.servers.map((s) => s.serverId), ['b']);
});

// ---------------------------------------------------------------------
// Change detection (version changes, wipes)
// ---------------------------------------------------------------------
test('detectAndLogChanges logs nothing on the very first sighting of a server (nothing to compare against)', () => {
  const db = freshDb();
  recordSnapshotRun(db, [{ id: 'a', day: 5, version: '92.41' }], { now: () => '2026-08-15T00:00:00.000Z' });
  assert.deepEqual(changeLogRows(db, 'a'), []);
});

test('recordSnapshotRun logs a version change between two runs', () => {
  const db = freshDb();
  recordSnapshotRun(db, [{ id: 'a', day: 5, version: '92.41' }], { now: () => '2026-08-15T00:00:00.000Z' });
  recordSnapshotRun(db, [{ id: 'a', day: 6, version: '92.42' }], { now: () => '2026-08-15T01:00:00.000Z' });

  const log = changeLogRows(db, 'a');
  assert.equal(log.length, 1);
  assert.equal(log[0].changeType, 'version');
  assert.equal(log[0].oldValue, '92.41');
  assert.equal(log[0].newValue, '92.42');
});

test('recordSnapshotRun does not write a wipe into change_log after the switchover', () => {
  const db = freshDb();
  recordSnapshotRun(db, [{ id: 'a', day: 45, version: '92.41' }], { now: () => '2026-08-15T00:00:00.000Z' });
  recordSnapshotRun(db, [{ id: 'a', day: 1, version: '92.41' }], { now: () => '2026-08-15T01:00:00.000Z' });
  recordSnapshotRun(db, [{ id: 'a', day: 1, version: '92.41' }], { now: () => '2026-08-15T02:00:00.000Z' });

  assert.deepEqual(changeLogRows(db, 'a'), []);
  const wipeRows = db.prepare("SELECT COUNT(*) as c FROM change_log WHERE change_type = 'wipe'").get();
  assert.equal(wipeRows.c, 0);
});

test('recordSnapshotRun does NOT log a wipe for a normal day-count increment', () => {
  const db = freshDb();
  recordSnapshotRun(db, [{ id: 'a', day: 45, version: '92.41' }], { now: () => '2026-08-15T00:00:00.000Z' });
  recordSnapshotRun(db, [{ id: 'a', day: 46, version: '92.41' }], { now: () => '2026-08-15T01:00:00.000Z' });
  assert.deepEqual(changeLogRows(db, 'a'), []);
});

test('recordSnapshotRun does NOT treat an early low day count as a wipe (needs 3+ before the drop counts)', () => {
  const db = freshDb();
  recordSnapshotRun(db, [{ id: 'a', day: 2, version: '92.41' }], { now: () => '2026-08-15T00:00:00.000Z' });
  recordSnapshotRun(db, [{ id: 'a', day: 1, version: '92.41' }], { now: () => '2026-08-15T01:00:00.000Z' });
  assert.deepEqual(changeLogRows(db, 'a'), []);
});

test('recordSnapshotRun still logs a version change when a day reset happens in the same run', () => {
  const db = freshDb();
  recordSnapshotRun(db, [{ id: 'a', day: 45, version: '92.41' }], { now: () => '2026-08-15T00:00:00.000Z' });
  recordSnapshotRun(db, [{ id: 'a', day: 1, version: '93.0' }], { now: () => '2026-08-15T01:00:00.000Z' });

  const log = changeLogRows(db, 'a');
  assert.equal(log.length, 1);
  assert.equal(log[0].changeType, 'version');
  assert.equal(log[0].oldValue, '92.41');
  assert.equal(log[0].newValue, '93.0');
  const wipeRows = db.prepare("SELECT COUNT(*) as c FROM change_log WHERE change_type = 'wipe'").get();
  assert.equal(wipeRows.c, 0);
});

test('recordSnapshotRun version changes are scoped per-server', () => {
  const db = freshDb();
  recordSnapshotRun(db, [{ id: 'a', day: 5, version: 'v1' }, { id: 'b', day: 5, version: 'v1' }], { now: () => '2026-08-15T00:00:00.000Z' });
  recordSnapshotRun(db, [{ id: 'a', day: 6, version: 'v2' }, { id: 'b', day: 6, version: 'v1' }], { now: () => '2026-08-15T01:00:00.000Z' });

  assert.equal(changeLogRows(db, 'a').length, 1);
  assert.equal(changeLogRows(db, 'b').length, 0);
});

test('getRecentWipes returns the latest probable_wipe per server inside the window', () => {
  const db = freshDb();
  const insert = db.prepare(
    'INSERT INTO server_change_events (server_id, event_type, field, old_value, new_value, detected_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  insert.run('a', 'probable_wipe', null, '45', '1', '2026-08-01T01:00:00.000Z');
  insert.run('b', 'probable_wipe', null, '45', '1', '2026-08-10T01:00:00.000Z');
  insert.run('b', 'version_change', 'version', '1', '2', '2026-08-10T01:00:00.000Z');

  const recent = getRecentWipes(db, { sinceIso: '2026-08-05T00:00:00.000Z' });
  assert.equal(recent.length, 1);
  assert.equal(recent[0].serverId, 'b');
  assert.equal(recent[0].seenAt, '2026-08-10T01:00:00.000Z');
});

// ---------------------------------------------------------------------
// Two-cycle stable change events (server_change_events)
// ---------------------------------------------------------------------
function changeEventsFor(db, serverId) {
  return getChangeEvents(db, serverId, { limit: 50 });
}

test('a changed field that holds two cycles writes exactly one event', () => {
  const db = freshDb();
  recordSnapshotRun(db, [{ id: 'a', version: '92.45', map: 'TheIsland_WP', maxPlayers: 70, day: 10 }], { now: () => '2026-08-15T00:00:00.000Z' });
  recordSnapshotRun(db, [{ id: 'a', version: '92.47', map: 'TheIsland_WP', maxPlayers: 70, day: 10 }], { now: () => '2026-08-15T01:00:00.000Z' });
  assert.deepEqual(changeEventsFor(db, 'a'), []);
  recordSnapshotRun(db, [{ id: 'a', version: '92.47', map: 'TheIsland_WP', maxPlayers: 70, day: 10 }], { now: () => '2026-08-15T02:00:00.000Z' });

  const events = changeEventsFor(db, 'a');
  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, 'version_change');
  assert.equal(events[0].field, 'version');
  assert.equal(events[0].oldValue, '92.45');
  assert.equal(events[0].newValue, '92.47');
});

test('a changed field that reverts on the second cycle writes no event', () => {
  const db = freshDb();
  recordSnapshotRun(db, [{ id: 'a', version: '92.45', map: 'TheIsland_WP', maxPlayers: 70, day: 10 }], { now: () => '2026-08-15T00:00:00.000Z' });
  recordSnapshotRun(db, [{ id: 'a', version: '92.47', map: 'TheIsland_WP', maxPlayers: 70, day: 10 }], { now: () => '2026-08-15T01:00:00.000Z' });
  recordSnapshotRun(db, [{ id: 'a', version: '92.45', map: 'TheIsland_WP', maxPlayers: 70, day: 10 }], { now: () => '2026-08-15T02:00:00.000Z' });
  assert.deepEqual(changeEventsFor(db, 'a'), []);
});

test('a field changing twice across four cycles writes two chained events', () => {
  const db = freshDb();
  recordSnapshotRun(db, [{ id: 'a', version: 'A', map: 'TheIsland_WP', maxPlayers: 70, day: 10 }], { now: () => '2026-08-15T00:00:00.000Z' });
  recordSnapshotRun(db, [{ id: 'a', version: 'B', map: 'TheIsland_WP', maxPlayers: 70, day: 10 }], { now: () => '2026-08-15T01:00:00.000Z' });
  recordSnapshotRun(db, [{ id: 'a', version: 'B', map: 'TheIsland_WP', maxPlayers: 70, day: 10 }], { now: () => '2026-08-15T02:00:00.000Z' });
  recordSnapshotRun(db, [{ id: 'a', version: 'C', map: 'TheIsland_WP', maxPlayers: 70, day: 10 }], { now: () => '2026-08-15T03:00:00.000Z' });
  recordSnapshotRun(db, [{ id: 'a', version: 'C', map: 'TheIsland_WP', maxPlayers: 70, day: 10 }], { now: () => '2026-08-15T04:00:00.000Z' });

  const events = changeEventsFor(db, 'a');
  assert.equal(events.length, 2);
  assert.equal(events[0].oldValue, 'B');
  assert.equal(events[0].newValue, 'C');
  assert.equal(events[1].oldValue, 'A');
  assert.equal(events[1].newValue, 'B');
});

test('day 5 to day 1 held two cycles writes probable_wipe', () => {
  const db = freshDb();
  recordSnapshotRun(db, [{ id: 'a', version: '92.45', map: 'TheIsland_WP', maxPlayers: 70, day: 5 }], { now: () => '2026-08-15T00:00:00.000Z' });
  recordSnapshotRun(db, [{ id: 'a', version: '92.45', map: 'TheIsland_WP', maxPlayers: 70, day: 1 }], { now: () => '2026-08-15T01:00:00.000Z' });
  assert.deepEqual(changeEventsFor(db, 'a'), []);
  recordSnapshotRun(db, [{ id: 'a', version: '92.45', map: 'TheIsland_WP', maxPlayers: 70, day: 1 }], { now: () => '2026-08-15T02:00:00.000Z' });

  const events = changeEventsFor(db, 'a');
  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, 'probable_wipe');
  assert.equal(events[0].field, null);
  assert.equal(events[0].oldValue, '5');
  assert.equal(events[0].newValue, '1');
});

test('day 2 to day 1 writes no wipe event', () => {
  const db = freshDb();
  recordSnapshotRun(db, [{ id: 'a', version: '92.45', map: 'TheIsland_WP', maxPlayers: 70, day: 2 }], { now: () => '2026-08-15T00:00:00.000Z' });
  recordSnapshotRun(db, [{ id: 'a', version: '92.45', map: 'TheIsland_WP', maxPlayers: 70, day: 1 }], { now: () => '2026-08-15T01:00:00.000Z' });
  recordSnapshotRun(db, [{ id: 'a', version: '92.45', map: 'TheIsland_WP', maxPlayers: 70, day: 1 }], { now: () => '2026-08-15T02:00:00.000Z' });
  assert.deepEqual(changeEventsFor(db, 'a'), []);
});

test('day 5 to day 1 that reverts to day 5 writes nothing', () => {
  const db = freshDb();
  recordSnapshotRun(db, [{ id: 'a', version: '92.45', map: 'TheIsland_WP', maxPlayers: 70, day: 5 }], { now: () => '2026-08-15T00:00:00.000Z' });
  recordSnapshotRun(db, [{ id: 'a', version: '92.45', map: 'TheIsland_WP', maxPlayers: 70, day: 1 }], { now: () => '2026-08-15T01:00:00.000Z' });
  recordSnapshotRun(db, [{ id: 'a', version: '92.45', map: 'TheIsland_WP', maxPlayers: 70, day: 5 }], { now: () => '2026-08-15T02:00:00.000Z' });
  assert.deepEqual(changeEventsFor(db, 'a'), []);
});

test('first sighting of a server writes no change events', () => {
  const db = freshDb();
  recordSnapshotRun(db, [{ id: 'a', version: '92.45', map: 'TheIsland_WP', maxPlayers: 70, day: 10 }], { now: () => '2026-08-15T00:00:00.000Z' });
  assert.deepEqual(changeEventsFor(db, 'a'), []);
});

test('a server absent for a cycle then returning with different values writes no events', () => {
  const db = freshDb();
  recordSnapshotRun(db, [{ id: 'a', version: '92.45', map: 'TheIsland_WP', maxPlayers: 70, day: 10 }], { now: () => '2026-08-15T00:00:00.000Z' });
  recordSnapshotRun(db, [{ id: 'b', version: '92.45', map: 'TheIsland_WP', maxPlayers: 70, day: 10 }], { now: () => '2026-08-15T01:00:00.000Z' });
  recordSnapshotRun(db, [{ id: 'a', version: '92.47', map: 'Extinction_WP', maxPlayers: 50, day: 1 }], { now: () => '2026-08-15T02:00:00.000Z' });
  recordSnapshotRun(db, [{ id: 'a', version: '92.47', map: 'Extinction_WP', maxPlayers: 50, day: 1 }], { now: () => '2026-08-15T03:00:00.000Z' });
  assert.deepEqual(changeEventsFor(db, 'a'), []);
});

test('pruneChangeEvents removes events older than 90 days and retains newer ones', () => {
  const db = freshDb();
  db.prepare(
    'INSERT INTO server_change_events (server_id, event_type, field, old_value, new_value, detected_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run('a', 'version_change', 'version', '1', '2', '2026-05-01T00:00:00.000Z');
  db.prepare(
    'INSERT INTO server_change_events (server_id, event_type, field, old_value, new_value, detected_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run('a', 'map_change', 'map', 'Old', 'New', '2026-08-01T00:00:00.000Z');

  const result = pruneChangeEvents(db, '2026-05-24T00:00:00.000Z');
  assert.equal(result.eventsRemoved, 1);
  const remaining = changeEventsFor(db, 'a');
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].eventType, 'map_change');
  assert.equal(remaining[0].detectedAt, '2026-08-01T00:00:00.000Z');
});

test('openHistoryDb migrates a pre-updated_at server_change_state and creates its index', () => {
  const file = tmpHistoryDbFile();
  const raw = new DatabaseSync(file);
  raw.exec(`
    CREATE TABLE server_change_state (
      server_id TEXT NOT NULL,
      field TEXT NOT NULL,
      confirmed_value TEXT,
      pending_value TEXT,
      PRIMARY KEY (server_id, field)
    );
  `);
  raw.prepare(
    'INSERT INTO server_change_state (server_id, field, confirmed_value, pending_value) VALUES (?, ?, ?, ?)'
  ).run('legacy', 'version', '92.41', null);
  raw.close();

  let db;
  assert.doesNotThrow(() => {
    db = openHistoryDb(file);
  });
  const cols = db.prepare('PRAGMA table_info(server_change_state)').all().map((c) => c.name);
  assert.ok(cols.includes('updated_at'));
  const index = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_server_change_state_updated'")
    .get();
  assert.ok(index);
  const row = db.prepare('SELECT server_id, confirmed_value FROM server_change_state WHERE server_id = ?').get('legacy');
  assert.equal(row.confirmed_value, '92.41');
  db.close();
});

test('maybePruneChangeEvents drops state rows older than 14 days and keeps fresh ones', () => {
  const db = freshDb();
  const upsert = db.prepare(
    `INSERT INTO server_change_state (server_id, field, confirmed_value, pending_value, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  );
  upsert.run('dead', 'version', '1', null, '2026-08-01T00:00:00.000Z');
  upsert.run('live', 'version', '2', null, '2026-08-20T00:00:00.000Z');
  upsert.run('null-ts', 'map', 'TheIsland_WP', null, null);

  const result = maybePruneChangeEvents(db, '2026-08-22T00:00:00.000Z');
  assert.equal(result.skipped, false);
  assert.equal(result.stateRemoved, 1);

  const rows = db
    .prepare('SELECT server_id FROM server_change_state ORDER BY server_id')
    .all()
    .map((r) => r.server_id);
  assert.deepEqual(rows, ['live', 'null-ts']);
});

test('a transfer flag toggle held two cycles writes one transfer_change with correct old/new', () => {
  const db = freshDb();
  const base = { id: 'a', version: '92.45', map: 'TheIsland_WP', maxPlayers: 70, day: 10 };
  recordSnapshotRun(db, [{ ...base, allowCharTransfers: false, allowItemTransfers: true }], { now: () => '2026-08-15T00:00:00.000Z' });
  recordSnapshotRun(db, [{ ...base, allowCharTransfers: true, allowItemTransfers: false }], { now: () => '2026-08-15T01:00:00.000Z' });
  assert.deepEqual(changeEventsFor(db, 'a'), []);
  recordSnapshotRun(db, [{ ...base, allowCharTransfers: true, allowItemTransfers: false }], { now: () => '2026-08-15T02:00:00.000Z' });

  const events = changeEventsFor(db, 'a');
  assert.equal(events.length, 2);
  const byField = Object.fromEntries(events.map((e) => [e.field, e]));
  assert.equal(byField.allowCharTransfers.eventType, 'transfer_change');
  assert.equal(byField.allowCharTransfers.oldValue, 'false');
  assert.equal(byField.allowCharTransfers.newValue, 'true');
  assert.equal(byField.allowItemTransfers.eventType, 'transfer_change');
  assert.equal(byField.allowItemTransfers.oldValue, 'true');
  assert.equal(byField.allowItemTransfers.newValue, 'false');
});

test('first sighting of transfer flags writes no events', () => {
  const db = freshDb();
  recordSnapshotRun(db, [{
    id: 'a',
    version: '92.45',
    map: 'TheIsland_WP',
    maxPlayers: 70,
    day: 10,
    allowCharTransfers: true,
    allowItemTransfers: false,
  }], { now: () => '2026-08-15T00:00:00.000Z' });
  assert.deepEqual(changeEventsFor(db, 'a'), []);
});

test('first post-baseline sighting of transfer flags on an existing server writes no events', () => {
  const db = freshDb();
  const base = { id: 'a', version: '92.45', map: 'TheIsland_WP', maxPlayers: 70, day: 10 };
  recordSnapshotRun(db, [base], { now: () => '2026-08-15T00:00:00.000Z' });
  recordSnapshotRun(db, [{ ...base, allowCharTransfers: true, allowItemTransfers: true }], { now: () => '2026-08-15T01:00:00.000Z' });
  recordSnapshotRun(db, [{ ...base, allowCharTransfers: true, allowItemTransfers: true }], { now: () => '2026-08-15T02:00:00.000Z' });
  assert.deepEqual(changeEventsFor(db, 'a'), []);
});

test('a one-cycle transfer flag flap writes no event', () => {
  const db = freshDb();
  const base = { id: 'a', version: '92.45', map: 'TheIsland_WP', maxPlayers: 70, day: 10, allowCharTransfers: true, allowItemTransfers: true };
  recordSnapshotRun(db, [base], { now: () => '2026-08-15T00:00:00.000Z' });
  recordSnapshotRun(db, [{ ...base, allowCharTransfers: false }], { now: () => '2026-08-15T01:00:00.000Z' });
  recordSnapshotRun(db, [base], { now: () => '2026-08-15T02:00:00.000Z' });
  assert.deepEqual(changeEventsFor(db, 'a'), []);
});

test('first confirmation of transfer flags on a 100-server fixture writes 200 transfer state rows and no events', () => {
  const db = freshDb();
  const roster = Array.from({ length: 100 }, (_, i) => ({
    id: `s${i}`,
    version: '92.45',
    map: 'TheIsland_WP',
    maxPlayers: 70,
    day: 10,
    allowCharTransfers: true,
    allowItemTransfers: i % 2 === 0,
  }));
  const events = detectStableChanges(db, roster, '2026-08-23T00:00:00.000Z', { presentLastCycle: new Set() });
  assert.equal(events.length, 0);
  const transferRows = db
    .prepare("SELECT COUNT(*) as c FROM server_change_state WHERE field IN ('allowCharTransfers', 'allowItemTransfers')")
    .get().c;
  assert.equal(transferRows, 200);
  const allRows = db.prepare('SELECT COUNT(*) as c FROM server_change_state').get().c;
  assert.equal(allRows, 600);
});

test('servers without transfer fields still emit version_change as before', () => {
  const db = freshDb();
  recordSnapshotRun(db, [{ id: 'a', version: '92.45', map: 'TheIsland_WP', maxPlayers: 70, day: 10 }], { now: () => '2026-08-15T00:00:00.000Z' });
  recordSnapshotRun(db, [{ id: 'a', version: '92.47', map: 'TheIsland_WP', maxPlayers: 70, day: 10 }], { now: () => '2026-08-15T01:00:00.000Z' });
  recordSnapshotRun(db, [{ id: 'a', version: '92.47', map: 'TheIsland_WP', maxPlayers: 70, day: 10 }], { now: () => '2026-08-15T02:00:00.000Z' });
  const events = changeEventsFor(db, 'a');
  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, 'version_change');
  assert.equal(events[0].oldValue, '92.45');
  assert.equal(events[0].newValue, '92.47');
});

test('map and max-player changes that hold two cycles write map_change and capacity_change', () => {
  const db = freshDb();
  recordSnapshotRun(db, [{ id: 'a', version: '92.45', map: 'TheIsland_WP', maxPlayers: 70, day: 10 }], { now: () => '2026-08-15T00:00:00.000Z' });
  recordSnapshotRun(db, [{ id: 'a', version: '92.45', map: 'Extinction_WP', maxPlayers: 50, day: 10 }], { now: () => '2026-08-15T01:00:00.000Z' });
  recordSnapshotRun(db, [{ id: 'a', version: '92.45', map: 'Extinction_WP', maxPlayers: 50, day: 10 }], { now: () => '2026-08-15T02:00:00.000Z' });

  const events = changeEventsFor(db, 'a');
  assert.equal(events.length, 2);
  const byType = Object.fromEntries(events.map((e) => [e.eventType, e]));
  assert.equal(byType.map_change.oldValue, 'TheIsland_WP');
  assert.equal(byType.map_change.newValue, 'Extinction_WP');
  assert.equal(byType.capacity_change.oldValue, '70');
  assert.equal(byType.capacity_change.newValue, '50');
});

// ---------------------------------------------------------------------
// getServerRunHistory
// ---------------------------------------------------------------------
test('getServerRunHistory includes runs where the server was absent, marked present:false', () => {
  const db = freshDb();
  recordSnapshotRun(db, [{ id: 'a', playersNow: 5 }], { now: () => '2026-08-15T00:00:00.000Z' });
  recordSnapshotRun(db, [], { now: () => '2026-08-15T01:00:00.000Z' }); // "a" absent this run
  recordSnapshotRun(db, [{ id: 'a', playersNow: 8 }], { now: () => '2026-08-15T02:00:00.000Z' });

  const runs = getServerRunHistory(db, 'a');
  assert.equal(runs.length, 3);
  assert.deepEqual(runs.map((r) => r.present), [true, false, true]);
  assert.equal(runs[1].playersNow, null);
});

test('getServerRunHistory respects a sinceIso window', () => {
  const db = freshDb();
  recordSnapshotRun(db, [{ id: 'a' }], { now: () => '2026-01-01T00:00:00.000Z' });
  recordSnapshotRun(db, [{ id: 'a' }], { now: () => '2026-08-15T00:00:00.000Z' });
  const runs = getServerRunHistory(db, 'a', { sinceIso: '2026-06-01T00:00:00.000Z' });
  assert.equal(runs.length, 1);
});

// ---------------------------------------------------------------------
// computePeakTimes
// ---------------------------------------------------------------------
test('computePeakTimes returns a full 168-bucket grid (7 days x 24 hours)', () => {
  const db = freshDb();
  recordSnapshotRun(db, [{ id: 'a', playersNow: 10 }], { now: () => '2026-08-15T12:00:00.000Z' }); // Saturday, noon UTC
  const grid = computePeakTimes(db, 'a');
  assert.equal(grid.length, 168);
});

test('computePeakTimes averages players correctly within a bucket, nulls for empty buckets', () => {
  const db = freshDb();
  // Both runs land in the same day-of-week/hour bucket (one week apart, both Saturdays at 12:00 UTC)
  recordSnapshotRun(db, [{ id: 'a', playersNow: 10 }], { now: () => '2026-08-15T12:00:00.000Z' });
  recordSnapshotRun(db, [{ id: 'a', playersNow: 20 }], { now: () => '2026-08-22T12:00:00.000Z' });

  const grid = computePeakTimes(db, 'a');
  const d = new Date('2026-08-15T12:00:00.000Z');
  const bucket = grid.find((b) => b.dayOfWeek === d.getUTCDay() && b.hour === d.getUTCHours());
  assert.equal(bucket.avgPlayers, 15);
  assert.equal(bucket.sampleCount, 2);

  const emptyBucket = grid.find((b) => b.dayOfWeek === (d.getUTCDay() + 1) % 7);
  assert.equal(emptyBucket.avgPlayers, null);
  assert.equal(emptyBucket.sampleCount, 0);
});

test('computePeakTimes excludes runs where the server was absent', () => {
  const db = freshDb();
  recordSnapshotRun(db, [], { now: () => '2026-08-15T12:00:00.000Z' }); // absent
  const grid = computePeakTimes(db, 'a');
  const d = new Date('2026-08-15T12:00:00.000Z');
  const bucket = grid.find((b) => b.dayOfWeek === d.getUTCDay() && b.hour === d.getUTCHours());
  assert.equal(bucket.sampleCount, 0);
});

// ---------------------------------------------------------------------
// computeDowntimePatterns
// ---------------------------------------------------------------------
test('computeDowntimePatterns returns a full 168-bucket grid', () => {
  const db = freshDb();
  recordSnapshotRun(db, [{ id: 'a' }], { now: () => '2026-08-15T00:00:00.000Z' });
  assert.equal(computeDowntimePatterns(db, 'a').length, 168);
});

test('computeDowntimePatterns computes 0% downtime when always present', () => {
  const db = freshDb();
  recordSnapshotRun(db, [{ id: 'a' }], { now: () => '2026-08-15T12:00:00.000Z' });
  recordSnapshotRun(db, [{ id: 'a' }], { now: () => '2026-08-22T12:00:00.000Z' });
  const grid = computeDowntimePatterns(db, 'a');
  const d = new Date('2026-08-15T12:00:00.000Z');
  const bucket = grid.find((b) => b.dayOfWeek === d.getUTCDay() && b.hour === d.getUTCHours());
  assert.equal(bucket.downtimePercent, 0);
  assert.equal(bucket.totalRuns, 2);
});

test('computeDowntimePatterns computes 100% downtime when always absent in that bucket', () => {
  const db = freshDb();
  recordSnapshotRun(db, [{ id: 'b' }], { now: () => '2026-08-15T12:00:00.000Z' }); // "a" absent
  const grid = computeDowntimePatterns(db, 'a');
  const d = new Date('2026-08-15T12:00:00.000Z');
  const bucket = grid.find((b) => b.dayOfWeek === d.getUTCDay() && b.hour === d.getUTCHours());
  assert.equal(bucket.downtimePercent, 100);
});

test('computeDowntimePatterns mixes presence and absence correctly within a bucket', () => {
  const db = freshDb();
  recordSnapshotRun(db, [{ id: 'a' }], { now: () => '2026-08-15T12:00:00.000Z' }); // present
  recordSnapshotRun(db, [], { now: () => '2026-08-22T12:00:00.000Z' }); // absent, same bucket
  const grid = computeDowntimePatterns(db, 'a');
  const d = new Date('2026-08-15T12:00:00.000Z');
  const bucket = grid.find((b) => b.dayOfWeek === d.getUTCDay() && b.hour === d.getUTCHours());
  assert.equal(bucket.totalRuns, 2);
  assert.equal(bucket.downtimePercent, 50);
});

test('computeDowntimePatterns reports null (not zero) for buckets with no runs at all', () => {
  const db = freshDb();
  recordSnapshotRun(db, [{ id: 'a' }], { now: () => '2026-08-15T12:00:00.000Z' });
  const grid = computeDowntimePatterns(db, 'a');
  const emptyBucket = grid.find((b) => b.totalRuns === 0);
  assert.equal(emptyBucket.downtimePercent, null);
});

// ---------------------------------------------------------------------
// computeNetworkRanking
// ---------------------------------------------------------------------
function serverWithStats(id, { playersNow = 0, wildcardReportedPing = null } = {}) {
  return { id, playersNow, maxPlayers: 70, day: 1, wildcardReportedPing };
}

test('computeNetworkRanking returns an empty result (not a crash) with no runs yet', () => {
  const db = freshDb();
  const result = computeNetworkRanking(db);
  assert.equal(result.totalRuns, 0);
  assert.deepEqual(result.servers, []);
});

test('computeNetworkRanking excludes servers below minRuns when asked', () => {
  const db = freshDb();
  recordSnapshotRun(db, [serverWithStats('a'), serverWithStats('b')], { now: () => '2026-08-15T00:00:00.000Z' });
  recordSnapshotRun(db, [serverWithStats('a')], { now: () => '2026-08-15T01:00:00.000Z' }); // "b" only appeared once

  const result = computeNetworkRanking(db, { minRuns: 2 });
  assert.deepEqual(result.servers.map((s) => s.serverId), ['a']);
});

test('computeNetworkRanking ranks every server by default (confidence, not minRuns, handles thin history)', () => {
  const db = freshDb();
  recordSnapshotRun(db, [serverWithStats('a'), serverWithStats('b')], { now: () => '2026-08-15T00:00:00.000Z' });
  const result = computeNetworkRanking(db);
  assert.equal(result.eligibleServerCount, 2);
});

test('computeNetworkRanking gives a perfectly reliable, full, low-ping, established server the highest score', () => {
  const db = freshDb();
  for (let i = 0; i < 5; i += 1) {
    recordSnapshotRun(
      db,
      [
        serverWithStats('best', { playersNow: 70, wildcardReportedPing: 50 }),
        serverWithStats('worst', { playersNow: 1, wildcardReportedPing: 400 }),
      ],
      { now: () => `2026-08-15T0${i}:00:00.000Z` }
    );
  }
  const result = computeNetworkRanking(db, { minRuns: 1 });
  assert.equal(result.servers[0].serverId, 'best');
  assert.equal(result.servers[0].rank, 1);
  assert.ok(result.servers[0].rankScore > result.servers[1].rankScore);
  assert.ok('components' in result.servers[0]);
  assert.ok('reliability' in result.servers[0].components);
  assert.ok('connection' in result.servers[0].components);
  assert.ok('activity' in result.servers[0].components);
  assert.ok('confidence' in result.servers[0].components);
});

test('computeNetworkRanking reliability uses presence since first seen, not the whole window', () => {
  const db = freshDb();
  recordSnapshotRun(db, [serverWithStats('a')], { now: () => '2026-08-15T00:00:00.000Z' });
  recordSnapshotRun(db, [], { now: () => '2026-08-15T01:00:00.000Z' }); // "a" absent
  recordSnapshotRun(db, [serverWithStats('a')], { now: () => '2026-08-15T02:00:00.000Z' });

  const result = computeNetworkRanking(db, { minRuns: 1 });
  const a = result.servers.find((s) => s.serverId === 'a');
  // 2 of 3 runs since first seen → 66.7% uptime → 26.7 of 40 reliability points
  assert.equal(a.components.reliability, 26.7);
});

test('computeNetworkRanking activity is mean population % (players/max), not relative to the busiest server', () => {
  const db = freshDb();
  recordSnapshotRun(db, [serverWithStats('full', { playersNow: 70 }), serverWithStats('empty', { playersNow: 0 })], {
    now: () => '2026-08-15T00:00:00.000Z',
  });
  const result = computeNetworkRanking(db, { minRuns: 1 });
  const full = result.servers.find((s) => s.serverId === 'full');
  const empty = result.servers.find((s) => s.serverId === 'empty');
  assert.equal(full.components.activity, 25); // 100% full → full 25 points
  assert.equal(empty.components.activity, 0);
});

test('computeNetworkRanking connection is 0 when ping is missing', () => {
  const db = freshDb();
  recordSnapshotRun(db, [serverWithStats('a', { wildcardReportedPing: null })], { now: () => '2026-08-15T00:00:00.000Z' });
  const result = computeNetworkRanking(db, { minRuns: 1 });
  assert.equal(result.servers[0].components.connection, 0);
});

test('computeNetworkRanking connection uses the ping tier (low ping beats high ping)', () => {
  const db = freshDb();
  recordSnapshotRun(
    db,
    [serverWithStats('fast', { wildcardReportedPing: 40 }), serverWithStats('slow', { wildcardReportedPing: 400 })],
    { now: () => '2026-08-15T00:00:00.000Z' }
  );
  const result = computeNetworkRanking(db, { minRuns: 1 });
  const fast = result.servers.find((s) => s.serverId === 'fast');
  const slow = result.servers.find((s) => s.serverId === 'slow');
  assert.equal(fast.components.connection, 25);
  assert.equal(slow.components.connection, 2.5);
});

test('computeNetworkRanking prefers live roster ping over the history average when pingByServerId is passed', () => {
  const db = freshDb();
  recordSnapshotRun(db, [serverWithStats('a', { wildcardReportedPing: 400 })], { now: () => '2026-08-15T00:00:00.000Z' });
  const fromHistory = computeNetworkRanking(db, { minRuns: 1 });
  const fromLive = computeNetworkRanking(db, { minRuns: 1, pingByServerId: new Map([['a', 40]]) });
  assert.equal(fromHistory.servers[0].components.connection, 2.5);
  assert.equal(fromLive.servers[0].components.connection, 25);
});

test('computeNetworkRanking a brand-new server gets 0 confidence', () => {
  const db = freshDb();
  recordSnapshotRun(db, [serverWithStats('new')], { now: () => '2026-08-15T00:00:00.000Z' });
  const result = computeNetworkRanking(db, { minRuns: 1 });
  assert.equal(result.servers[0].components.confidence, 0);
});

test('computeNetworkRanking a steadily half-full server beats one that spiked once (mean, not peak)', () => {
  const db = freshDb();
  const hours = ['00', '01', '02', '03', '04', '05', '06'];
  for (let i = 0; i < hours.length; i += 1) {
    recordSnapshotRun(
      db,
      [
        { id: 'steady', playersNow: 35, maxPlayers: 70, wildcardReportedPing: 40 },
        { id: 'spike', playersNow: i === 0 ? 70 : 0, maxPlayers: 70, wildcardReportedPing: 40 },
      ],
      { now: () => `2026-08-15T${hours[i]}:00:00.000Z` }
    );
  }
  const result = computeNetworkRanking(db, { minRuns: 1 });
  const steady = result.servers.find((s) => s.serverId === 'steady');
  const spike = result.servers.find((s) => s.serverId === 'spike');
  assert.ok(steady.components.activity > spike.components.activity);
  assert.ok(steady.rankScore > spike.rankScore);
});

test('computeNetworkRanking respects the limit while still reporting eligibleServerCount for the full set', () => {
  const db = freshDb();
  recordSnapshotRun(db, [serverWithStats('a'), serverWithStats('b'), serverWithStats('c')], { now: () => '2026-08-15T00:00:00.000Z' });
  const result = computeNetworkRanking(db, { minRuns: 1, limit: 2 });
  assert.equal(result.servers.length, 2);
  assert.equal(result.eligibleServerCount, 3);
});

test('computeNetworkRanking assigns sequential rank numbers starting at 1', () => {
  const db = freshDb();
  recordSnapshotRun(db, [serverWithStats('a', { playersNow: 10 }), serverWithStats('b', { playersNow: 5 }), serverWithStats('c', { playersNow: 1 })], {
    now: () => '2026-08-15T00:00:00.000Z',
  });
  const result = computeNetworkRanking(db, { minRuns: 1 });
  assert.deepEqual(result.servers.map((s) => s.rank), [1, 2, 3]);
});

test('computeNetworkRanking respects a sinceIso window', () => {
  const db = freshDb();
  recordSnapshotRun(db, [serverWithStats('a')], { now: () => '2026-01-01T00:00:00.000Z' });
  recordSnapshotRun(db, [serverWithStats('b')], { now: () => '2026-08-15T00:00:00.000Z' });
  const result = computeNetworkRanking(db, { minRuns: 1, sinceIso: '2026-06-01T00:00:00.000Z', nowIso: '2026-08-15T00:00:00.000Z' });
  assert.deepEqual(result.servers.map((s) => s.serverId), ['b']);
});

test('applyRankingToServers stamps rankScore, rank, components, and uptimePercent onto roster servers', () => {
  const db = freshDb();
  const roster = [
    serverWithStats('a', { playersNow: 70, wildcardReportedPing: 40 }),
    serverWithStats('b', { playersNow: 0, wildcardReportedPing: 400 }),
  ];
  recordSnapshotRun(db, roster, { now: () => '2026-08-15T00:00:00.000Z' });
  applyRankingToServers(roster, db);
  assert.equal(typeof roster[0].rankScore, 'number');
  assert.equal(typeof roster[0].rank, 'number');
  assert.ok(roster[0].rankComponents);
  assert.equal(typeof roster[0].uptimePercent, 'number');
  assert.equal(typeof roster[0].avgPopulationPercent, 'number');
  assert.equal(roster[0].rank, 1); // full + fast ping beats empty + slow
  assert.equal(roster[1].rank, 2);
  assert.ok(roster[0].rankScore > roster[1].rankScore);
  assert.equal(roster[0].uptimePercent, 100);
  assert.equal(roster[1].uptimePercent, 100);
});

// ---------------------------------------------------------------------
// getRankNeighborhood
// ---------------------------------------------------------------------
function fakeRanking(count) {
  return Array.from({ length: count }, (_, i) => ({ serverId: `s${i + 1}`, rank: i + 1, rankScore: count - i }));
}

test('getRankNeighborhood returns null for a server not present in the ranking', () => {
  assert.equal(getRankNeighborhood(fakeRanking(10), 'nonexistent'), null);
});

test('getRankNeighborhood returns the server\'s rank, percentile, and nearby neighbors', () => {
  const ranking = fakeRanking(100);
  const result = getRankNeighborhood(ranking, 's10', { radius: 2 });
  assert.equal(result.rank, 10);
  assert.equal(result.totalRanked, 100);
  assert.deepEqual(result.neighbors.map((n) => n.serverId), ['s8', 's9', 's10', 's11', 's12']);
});

test('getRankNeighborhood clamps the neighbor window at the start of the list', () => {
  const ranking = fakeRanking(10);
  const result = getRankNeighborhood(ranking, 's1', { radius: 3 });
  assert.deepEqual(result.neighbors.map((n) => n.serverId), ['s1', 's2', 's3', 's4']);
});

test('getRankNeighborhood clamps the neighbor window at the end of the list', () => {
  const ranking = fakeRanking(10);
  const result = getRankNeighborhood(ranking, 's10', { radius: 3 });
  assert.deepEqual(result.neighbors.map((n) => n.serverId), ['s7', 's8', 's9', 's10']);
});

test('getRankNeighborhood gives rank 1 a percentile near 100 and the last rank a percentile near 0', () => {
  const ranking = fakeRanking(100);
  const top = getRankNeighborhood(ranking, 's1');
  const bottom = getRankNeighborhood(ranking, 's100');
  assert.ok(top.percentile > bottom.percentile);
  assert.ok(top.percentile > 95);
});

// ---------------------------------------------------------------------
// Incident recording
// ---------------------------------------------------------------------
test('recordIncidentCycle opens an OUTAGE and sets ended_at only after 3 NORMAL cycles', () => {
  const db = freshDb();
  const t0 = '2026-08-15T00:00:00.000Z';
  const t1 = '2026-08-15T01:00:00.000Z';
  const later = (h) => `2026-08-15T0${h}:00:00.000Z`;

  recordSnapshotRun(db, servers(['a', 'b', 'c', 'd']), { now: () => t0 });
  const first = recordIncidentCycle(db, { presentServerIds: ['a', 'b', 'c', 'd'], now: () => t0 });
  assert.equal(first.state, 'NORMAL');
  assert.equal(first.offlinePct, 0);
  assert.equal(getActiveIncident(db), null);

  recordSnapshotRun(db, servers(['a', 'b', 'c']), { now: () => t1 });
  const outage = recordIncidentCycle(db, { presentServerIds: ['a', 'b', 'c'], now: () => t1 });
  assert.equal(outage.state, 'OUTAGE');
  assert.equal(outage.offlinePct, 25);
  const open = getActiveIncident(db);
  assert.ok(open);
  assert.equal(open.type, 'OUTAGE');
  assert.equal(open.endedAt, null);
  assert.equal(open.startedAt, t1);
  assert.equal(open.peakOfflinePct, 25);

  // Two recovered cycles are not enough to close.
  for (const h of [2, 3]) {
    recordSnapshotRun(db, servers(['a', 'b', 'c', 'd']), { now: () => later(h) });
    recordIncidentCycle(db, { presentServerIds: ['a', 'b', 'c', 'd'], now: () => later(h) });
    assert.equal(getActiveIncident(db).endedAt, null);
    assert.equal(getIncidentStatus(db).state, 'OUTAGE'); // hysteresis holds the headline
  }

  recordSnapshotRun(db, servers(['a', 'b', 'c', 'd']), { now: () => later(4) });
  const closed = recordIncidentCycle(db, { presentServerIds: ['a', 'b', 'c', 'd'], now: () => later(4) });
  assert.equal(closed.state, 'NORMAL');
  assert.equal(getActiveIncident(db), null);
  const listed = listIncidents(db);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].endedAt, later(4));
  assert.equal(listed[0].startedAt, t1);
});

test('recordIncidentCycle consecutive fetch-failure counting resets on success', () => {
  const db = freshDb();
  recordSnapshotRun(db, servers(['a', 'b']), { now: () => '2026-08-15T00:00:00.000Z' });
  recordIncidentCycle(db, { presentServerIds: ['a', 'b'], now: () => '2026-08-15T00:00:00.000Z' });

  const fail1 = recordIncidentCycle(db, { rosterFetchFailed: true, now: () => '2026-08-15T01:00:00.000Z' });
  assert.equal(fail1.consecutiveFetchFailures, 1);
  assert.equal(fail1.state, 'UNREACHABLE');
  assert.equal(getActiveIncident(db), null);

  const fail2 = recordIncidentCycle(db, { rosterFetchFailed: true, now: () => '2026-08-15T02:00:00.000Z' });
  assert.equal(fail2.consecutiveFetchFailures, 2);
  assert.equal(fail2.state, 'OUTAGE');
  assert.ok(getActiveIncident(db));

  const ok = recordIncidentCycle(db, { presentServerIds: ['a', 'b'], rosterFetchFailed: false, now: () => '2026-08-15T03:00:00.000Z' });
  assert.equal(ok.consecutiveFetchFailures, 0);
  assert.equal(ok.rosterFetchFailed, false);
});

test('recordIncidentCycle UPDATE_ROLLOUT uses existing version-change rows', () => {
  const db = freshDb();
  const ids = ['a', 'b', 'c', 'd', 'e'];
  recordSnapshotRun(
    db,
    ids.map((id) => ({ id, day: 5, version: '1.0' })),
    { now: () => '2026-08-15T00:00:00.000Z' }
  );
  recordIncidentCycle(db, { presentServerIds: ids, now: () => '2026-08-15T00:00:00.000Z' });

  // One server changing version is 20% of 5.
  recordSnapshotRun(
    db,
    ids.map((id) => ({ id, day: 6, version: id === 'a' ? '2.0' : '1.0' })),
    { now: () => '2026-08-15T01:00:00.000Z' }
  );
  const status = recordIncidentCycle(db, { presentServerIds: ids, now: () => '2026-08-15T01:00:00.000Z' });
  assert.equal(status.state, 'UPDATE_ROLLOUT');
  assert.equal(status.versionRolloutPct, 20);
});

test('getIncidentStatus returns the latest stored snapshot, not a live recompute', () => {
  const db = freshDb();
  recordSnapshotRun(db, servers(['a']), { now: () => '2026-08-15T00:00:00.000Z' });
  recordIncidentCycle(db, { presentServerIds: ['a'], now: () => '2026-08-15T00:00:00.000Z' });
  const stored = getIncidentStatus(db);
  assert.equal(stored.state, 'NORMAL');
  assert.equal(stored.computedAt, '2026-08-15T00:00:00.000Z');
  // Mutating history after the fact does not change the stored snapshot.
  recordSnapshotRun(db, servers(['a', 'b', 'c', 'd']), { now: () => '2026-08-15T01:00:00.000Z' });
  assert.equal(getIncidentStatus(db).computedAt, '2026-08-15T00:00:00.000Z');
});
