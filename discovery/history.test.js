'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
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
} = require('./history.js');

function freshDb() {
  return openHistoryDb(':memory:');
}

function servers(ids) {
  return ids.map((id) => ({ id, playersNow: 5, maxPlayers: 70, day: 100 }));
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
  assert.deepEqual(getChangeLog(db, 'a'), []);
});

test('recordSnapshotRun logs a version change between two runs', () => {
  const db = freshDb();
  recordSnapshotRun(db, [{ id: 'a', day: 5, version: '92.41' }], { now: () => '2026-08-15T00:00:00.000Z' });
  recordSnapshotRun(db, [{ id: 'a', day: 6, version: '92.42' }], { now: () => '2026-08-15T01:00:00.000Z' });

  const log = getChangeLog(db, 'a');
  assert.equal(log.length, 1);
  assert.equal(log[0].changeType, 'version');
  assert.equal(log[0].oldValue, '92.41');
  assert.equal(log[0].newValue, '92.42');
});

test('recordSnapshotRun logs a wipe when day resets from 3+ down to 1', () => {
  const db = freshDb();
  recordSnapshotRun(db, [{ id: 'a', day: 45, version: '92.41' }], { now: () => '2026-08-15T00:00:00.000Z' });
  recordSnapshotRun(db, [{ id: 'a', day: 1, version: '92.41' }], { now: () => '2026-08-15T01:00:00.000Z' });

  const log = getChangeLog(db, 'a');
  assert.equal(log.length, 1);
  assert.equal(log[0].changeType, 'wipe');
  assert.equal(log[0].oldValue, '45');
  assert.equal(log[0].newValue, '1');
});

test('recordSnapshotRun does NOT log a wipe for a normal day-count increment', () => {
  const db = freshDb();
  recordSnapshotRun(db, [{ id: 'a', day: 45, version: '92.41' }], { now: () => '2026-08-15T00:00:00.000Z' });
  recordSnapshotRun(db, [{ id: 'a', day: 46, version: '92.41' }], { now: () => '2026-08-15T01:00:00.000Z' });
  assert.deepEqual(getChangeLog(db, 'a'), []);
});

test('recordSnapshotRun does NOT treat an early low day count as a wipe (needs 3+ before the drop counts)', () => {
  const db = freshDb();
  recordSnapshotRun(db, [{ id: 'a', day: 2, version: '92.41' }], { now: () => '2026-08-15T00:00:00.000Z' });
  recordSnapshotRun(db, [{ id: 'a', day: 1, version: '92.41' }], { now: () => '2026-08-15T01:00:00.000Z' });
  assert.deepEqual(getChangeLog(db, 'a'), []);
});

test('recordSnapshotRun can log both a version change and a wipe in the same run', () => {
  const db = freshDb();
  recordSnapshotRun(db, [{ id: 'a', day: 45, version: '92.41' }], { now: () => '2026-08-15T00:00:00.000Z' });
  recordSnapshotRun(db, [{ id: 'a', day: 1, version: '93.0' }], { now: () => '2026-08-15T01:00:00.000Z' });

  const log = getChangeLog(db, 'a');
  assert.equal(log.length, 2);
  assert.deepEqual(log.map((l) => l.changeType).sort(), ['version', 'wipe']);
});

test('getChangeLog respects the limit and orders newest first', () => {
  const db = freshDb();
  recordSnapshotRun(db, [{ id: 'a', day: 1, version: 'v1' }], { now: () => '2026-08-15T00:00:00.000Z' });
  recordSnapshotRun(db, [{ id: 'a', day: 1, version: 'v2' }], { now: () => '2026-08-15T01:00:00.000Z' });
  recordSnapshotRun(db, [{ id: 'a', day: 1, version: 'v3' }], { now: () => '2026-08-15T02:00:00.000Z' });

  const log = getChangeLog(db, 'a', { limit: 1 });
  assert.equal(log.length, 1);
  assert.equal(log[0].newValue, 'v3'); // most recent change first
});

test('getChangeLog is scoped per-server', () => {
  const db = freshDb();
  recordSnapshotRun(db, [{ id: 'a', day: 5, version: 'v1' }, { id: 'b', day: 5, version: 'v1' }], { now: () => '2026-08-15T00:00:00.000Z' });
  recordSnapshotRun(db, [{ id: 'a', day: 6, version: 'v2' }, { id: 'b', day: 6, version: 'v1' }], { now: () => '2026-08-15T01:00:00.000Z' });

  assert.equal(getChangeLog(db, 'a').length, 1);
  assert.equal(getChangeLog(db, 'b').length, 0);
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

test('computeNetworkRanking excludes servers below minRuns', () => {
  const db = freshDb();
  recordSnapshotRun(db, [serverWithStats('a'), serverWithStats('b')], { now: () => '2026-08-15T00:00:00.000Z' });
  recordSnapshotRun(db, [serverWithStats('a')], { now: () => '2026-08-15T01:00:00.000Z' }); // "b" only appeared once

  const result = computeNetworkRanking(db, { minRuns: 2 });
  assert.deepEqual(result.servers.map((s) => s.serverId), ['a']);
});

test('computeNetworkRanking gives a perfectly reliable, most-populated, most-stable server the highest composite score', () => {
  const db = freshDb();
  for (let i = 0; i < 5; i += 1) {
    recordSnapshotRun(
      db,
      [
        serverWithStats('best', { playersNow: 70, wildcardReportedPing: 50 }), // present every run, full pop, rock-steady ping
        serverWithStats('worst', { playersNow: 1, wildcardReportedPing: 300 }),
      ],
      { now: () => `2026-08-15T0${i}:00:00.000Z` }
    );
  }
  const result = computeNetworkRanking(db, { minRuns: 1 });
  assert.equal(result.servers[0].serverId, 'best');
  assert.equal(result.servers[0].rank, 1);
  assert.ok(result.servers[0].compositeScore > result.servers[1].compositeScore);
});

test('computeNetworkRanking reliabilityScore matches presentCount/totalRuns', () => {
  const db = freshDb();
  recordSnapshotRun(db, [serverWithStats('a')], { now: () => '2026-08-15T00:00:00.000Z' });
  recordSnapshotRun(db, [], { now: () => '2026-08-15T01:00:00.000Z' }); // "a" absent
  recordSnapshotRun(db, [serverWithStats('a')], { now: () => '2026-08-15T02:00:00.000Z' });

  const result = computeNetworkRanking(db, { minRuns: 1 });
  const a = result.servers.find((s) => s.serverId === 'a');
  assert.equal(a.reliabilityScore, Math.round((2 / 3) * 1000) / 10);
});

test('computeNetworkRanking activityScore is relative to the most populated eligible server (100 for the max, 0 for empty)', () => {
  const db = freshDb();
  recordSnapshotRun(db, [serverWithStats('full', { playersNow: 70 }), serverWithStats('empty', { playersNow: 0 })], {
    now: () => '2026-08-15T00:00:00.000Z',
  });
  const result = computeNetworkRanking(db, { minRuns: 1 });
  const full = result.servers.find((s) => s.serverId === 'full');
  const empty = result.servers.find((s) => s.serverId === 'empty');
  assert.equal(full.activityScore, 100);
  assert.equal(empty.activityScore, 0);
});

test('computeNetworkRanking stabilityScore gives a neutral 50 to servers with fewer than 2 ping samples', () => {
  const db = freshDb();
  recordSnapshotRun(db, [serverWithStats('a', { wildcardReportedPing: 100 })], { now: () => '2026-08-15T00:00:00.000Z' }); // only 1 ping sample ever
  const result = computeNetworkRanking(db, { minRuns: 1 });
  assert.equal(result.servers[0].stabilityScore, 50);
});

test('computeNetworkRanking gives a perfectly consistent server a stabilityScore of 100', () => {
  const db = freshDb();
  // "steady" always pings exactly 100 (zero variance); "jittery" swings wildly
  recordSnapshotRun(db, [serverWithStats('steady', { wildcardReportedPing: 100 }), serverWithStats('jittery', { wildcardReportedPing: 50 })], { now: () => '2026-08-15T00:00:00.000Z' });
  recordSnapshotRun(db, [serverWithStats('steady', { wildcardReportedPing: 100 }), serverWithStats('jittery', { wildcardReportedPing: 400 })], { now: () => '2026-08-15T01:00:00.000Z' });

  const result = computeNetworkRanking(db, { minRuns: 1 });
  const steady = result.servers.find((s) => s.serverId === 'steady');
  const jittery = result.servers.find((s) => s.serverId === 'jittery');
  assert.equal(steady.stabilityScore, 100);
  assert.ok(steady.stabilityScore > jittery.stabilityScore);
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
  const result = computeNetworkRanking(db, { minRuns: 1, sinceIso: '2026-06-01T00:00:00.000Z' });
  assert.deepEqual(result.servers.map((s) => s.serverId), ['b']);
});

// ---------------------------------------------------------------------
// getRankNeighborhood
// ---------------------------------------------------------------------
function fakeRanking(count) {
  return Array.from({ length: count }, (_, i) => ({ serverId: `s${i + 1}`, rank: i + 1, compositeScore: count - i }));
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
