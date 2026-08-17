'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  persistRosterAtomic,
  readRosterIfExists,
  buildRosterSnapshot,
  refreshCycle,
  startScheduledRefresh,
  createUnofficialState,
  refreshUnofficialCycle,
  startUnofficialScheduledRefresh,
  createRosterServer,
  parseArgs,
  resolveGeoDbPath,
  resolveHistoryDbPath,
  resolveUnofficialDbPath,
  resolveUnofficialIntervalMs,
  DEFAULT_UNOFFICIAL_INTERVAL_MS,
} = require('./discovery_service.js');
const { openUnofficialDb, getUnofficialMeta } = require('./unofficial_store.js');
const { openHistoryDb, computeUptimePercent, getIncidentStatus, recordSnapshotRun } = require('./history.js');

function tmpFile(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ark-tools-discovery-')), name);
}

// Real-shaped records (fields trimmed to what normalizeServer reads),
// matching what officialserverlist.json actually returns.
function fakeOfficialServersGet() {
  return async () => ({
    status: 200,
    body: JSON.stringify([
      { SessionID: '1', Name: 'A Official', IsOfficial: '1', SessionIsPve: 1, IP: '1.1.1.1', Port: 7777 },
      { SessionID: '2', Name: 'B Official', IsOfficial: '1', SessionIsPve: 0, IP: '2.2.2.2', Port: 7777 },
      { SessionID: '3', Name: 'C unofficial community server', IsOfficial: '0', SessionIsPve: 0, IP: '3.3.3.3', Port: 7777 },
    ]),
  });
}

// ---------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------
test('persistRosterAtomic writes a file that readRosterIfExists can read back', () => {
  const file = tmpFile('roster.json');
  persistRosterAtomic(file, { hello: 'world' });
  const result = readRosterIfExists(file);
  assert.deepEqual(result, { hello: 'world' });
});

test('persistRosterAtomic leaves no temp file behind on success', () => {
  const file = tmpFile('roster.json');
  persistRosterAtomic(file, { a: 1 });
  const dir = path.dirname(file);
  const leftovers = fs.readdirSync(dir).filter((f) => f.includes('.tmp-'));
  assert.equal(leftovers.length, 0);
});

test('readRosterIfExists returns null when the file does not exist', () => {
  const file = tmpFile('does-not-exist.json');
  assert.equal(readRosterIfExists(file), null);
});

test('readRosterIfExists returns null (not a throw) on a corrupt file', () => {
  const file = tmpFile('corrupt.json');
  fs.writeFileSync(file, '{ not valid json');
  assert.equal(readRosterIfExists(file), null);
});

// ---------------------------------------------------------------------
// Snapshot building
// ---------------------------------------------------------------------
test('buildRosterSnapshot filters to official-only and splits by mode', async () => {
  const snapshot = await buildRosterSnapshot({ httpGet: fakeOfficialServersGet(), sleep: async () => {} });
  assert.equal(snapshot.totalServersSeen, 3);
  assert.equal(snapshot.totalOfficial, 2); // server 3 is unofficial, excluded
  assert.equal(snapshot.pveCount, 1);
  assert.equal(snapshot.pvpCount, 1);
  assert.equal(snapshot.servers.length, 2);
  assert.equal(snapshot.geoEnriched, false);
});

test('buildRosterSnapshot enriches with country when a geoReader is passed', async () => {
  const fakeGeoReader = { get: (ip) => (ip === '1.1.1.1' ? { country: { iso_code: 'US', names: { en: 'United States' } } } : null) };
  const snapshot = await buildRosterSnapshot(
    { httpGet: fakeOfficialServersGet(), sleep: async () => {} },
    { geoReader: fakeGeoReader }
  );
  assert.equal(snapshot.geoEnriched, true);
  assert.equal(snapshot.servers[0].country, 'US');
});

// ---------------------------------------------------------------------
// refreshCycle (first run vs. subsequent run with a diff)
// ---------------------------------------------------------------------
test('refreshCycle reports isFirstRun true and no diff when nothing exists yet', async () => {
  const file = tmpFile('roster.json');
  const result = await refreshCycle({
    outPath: file,
    discoveryOpts: { httpGet: fakeOfficialServersGet(), sleep: async () => {} },
  });
  assert.equal(result.isFirstRun, true);
  assert.equal(result.diff, null);
  assert.ok(readRosterIfExists(file)); // actually persisted
});

test('refreshCycle diffs against a previous roster on the second run', async () => {
  const file = tmpFile('roster.json');
  // First run: seed a roster with server "9" that will disappear next time
  persistRosterAtomic(file, { servers: [{ id: '9' }] });

  const result = await refreshCycle({
    outPath: file,
    discoveryOpts: { httpGet: fakeOfficialServersGet(), sleep: async () => {} },
  });

  assert.equal(result.isFirstRun, false);
  assert.equal(result.diff.removedCount, 1); // "9" is gone
  assert.equal(result.diff.addedCount, 2); // the two official servers are new vs the seed
});

// ---------------------------------------------------------------------
// Scheduled refresh (fake timer — no real waiting)
// ---------------------------------------------------------------------
test('startScheduledRefresh runs immediately and calls onCycle', async () => {
  const file = tmpFile('roster.json');
  let cycles = 0;
  let capturedTick;
  const fakeSetInterval = (fn) => {
    capturedTick = fn;
    return 'fake-timer-handle';
  };

  const scheduler = startScheduledRefresh({
    outPath: file,
    intervalMs: 999999,
    discoveryOpts: { httpGet: fakeOfficialServersGet(), sleep: async () => {} },
    onCycle: () => {
      cycles += 1;
    },
    setIntervalFn: fakeSetInterval,
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cycles, 1);
  assert.ok(typeof capturedTick === 'function');

  scheduler.stop();
});

test('startScheduledRefresh reports errors via onError instead of throwing', async () => {
  const file = tmpFile('roster.json');
  const errors = [];
  const fakeSetInterval = () => 'fake-timer-handle';

  const scheduler = startScheduledRefresh({
    outPath: file,
    intervalMs: 999999,
    discoveryOpts: { httpGet: async () => ({ status: 500, body: '[]' }), sleep: async () => {}, retry: { attempts: 1, baseDelayMs: 1 } },
    onCycle: () => {},
    onError: (err) => errors.push(err.message),
    setIntervalFn: fakeSetInterval,
  });

  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /HTTP 500/);

  scheduler.stop();
});

// ---------------------------------------------------------------------
// HTTP feed (real ephemeral server, real fetch)
// ---------------------------------------------------------------------
test('roster HTTP server returns 503 before any roster exists', async () => {
  const file = tmpFile('roster.json'); // never written
  const server = createRosterServer({ outPath: file });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/roster`);
  assert.equal(res.status, 503);

  server.close();
});

test('roster HTTP server serves the persisted roster on /roster and /roster/meta', async () => {
  const file = tmpFile('roster.json');
  persistRosterAtomic(file, {
    generatedAt: '2026-08-15T00:00:00.000Z',
    totalOfficial: 2,
    servers: [{ id: '1' }, { id: '2' }],
  });

  const server = createRosterServer({ outPath: file });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const rosterRes = await fetch(`http://127.0.0.1:${port}/roster`);
  const roster = await rosterRes.json();
  assert.equal(rosterRes.status, 200);
  assert.equal(roster.servers.length, 2);

  const metaRes = await fetch(`http://127.0.0.1:${port}/roster/meta`);
  const meta = await metaRes.json();
  assert.equal(metaRes.status, 200);
  assert.equal(meta.totalOfficial, 2);
  assert.equal(meta.servers, undefined); // meta strips the heavy server list

  server.close();
});

test('roster HTTP server 404s on unknown routes with a helpful body', async () => {
  const file = tmpFile('roster.json');
  const server = createRosterServer({ outPath: file });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/nonsense`);
  const body = await res.json();
  assert.equal(res.status, 404);
  assert.deepEqual(body.routes, ['/roster', '/roster/meta', '/unofficial/roster', '/unofficial/meta', '/history/wipes', '/history/:id', '/leaderboards/uptime', '/rankings', '/rankings/:id', '/incidents/status']);

  server.close();
});

// ---------------------------------------------------------------------
// History recording (Phase 4)
// ---------------------------------------------------------------------
test('refreshCycle records a snapshot into historyDb when one is provided', async () => {
  const file = tmpFile('roster.json');
  const historyDb = openHistoryDb(':memory:');

  await refreshCycle({
    outPath: file,
    discoveryOpts: { httpGet: fakeOfficialServersGet(), sleep: async () => {} },
    historyDb,
  });

  const uptime = computeUptimePercent(historyDb, '1');
  assert.equal(uptime.totalRuns, 1);
  assert.equal(uptime.presentCount, 1);
});

test('refreshCycle stamps rankScore onto the persisted roster when history is enabled', async () => {
  const file = tmpFile('roster.json');
  const historyDb = openHistoryDb(':memory:');

  await refreshCycle({
    outPath: file,
    discoveryOpts: { httpGet: fakeOfficialServersGet(), sleep: async () => {} },
    historyDb,
  });

  const roster = readRosterIfExists(file);
  assert.ok(roster.servers.length > 0);
  for (const s of roster.servers) {
    assert.equal(typeof s.rankScore, 'number');
    assert.equal(typeof s.rank, 'number');
    assert.ok(s.rankComponents);
    assert.equal(typeof s.rankComponents.reliability, 'number');
    assert.equal(typeof s.rankComponents.connection, 'number');
    assert.equal(typeof s.rankComponents.activity, 'number');
    assert.equal(typeof s.rankComponents.confidence, 'number');
    assert.equal(typeof s.uptimePercent, 'number');
    assert.equal(typeof s.avgPopulationPercent, 'number');
  }
});

test('refreshCycle works fine without a historyDb (it stays optional)', async () => {
  const file = tmpFile('roster.json');
  const result = await refreshCycle({
    outPath: file,
    discoveryOpts: { httpGet: fakeOfficialServersGet(), sleep: async () => {} },
  });
  assert.ok(result.snapshot); // no throw, no history side effect expected
});

test('GET /history/:id returns uptime and history for a tracked server', async () => {
  const file = tmpFile('roster.json');
  const historyDb = openHistoryDb(':memory:');
  await refreshCycle({
    outPath: file,
    discoveryOpts: { httpGet: fakeOfficialServersGet(), sleep: async () => {} },
    historyDb,
  });

  const server = createRosterServer({ outPath: file, historyDb });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/history/1`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.serverId, '1');
  assert.equal(body.uptime.totalRuns, 1);
  assert.equal(body.history.length, 1);
  assert.deepEqual(body.changeLog, []); // first sighting, nothing to compare against yet
  assert.equal(body.peakTimes.length, 168);
  assert.equal(body.downtimePatterns.length, 168);

  server.close();
});

test('GET /history/:id returns 503 when history tracking is not enabled on this instance', async () => {
  const file = tmpFile('roster.json');
  const server = createRosterServer({ outPath: file }); // no historyDb
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/history/1`);
  assert.equal(res.status, 503);

  server.close();
});

test('GET /history/wipes returns recent wipe detections from history', async () => {
  const file = tmpFile('roster.json');
  const historyDb = openHistoryDb(':memory:');
  const now = new Date().toISOString();
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  recordSnapshotRun(historyDb, [{ id: 'wipe-me', day: 45, version: '1' }], { now: () => hourAgo });
  recordSnapshotRun(historyDb, [{ id: 'wipe-me', day: 1, version: '1' }], { now: () => now });

  const server = createRosterServer({ outPath: file, historyDb });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/history/wipes?days=14`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.wipes.length, 1);
  assert.equal(body.wipes[0].serverId, 'wipe-me');
  assert.equal(body.wipes[0].seenAt, now);

  server.close();
});

test('GET /leaderboards/uptime returns a ranked list', async () => {
  const file = tmpFile('roster.json');
  const historyDb = openHistoryDb(':memory:');
  await refreshCycle({ outPath: file, discoveryOpts: { httpGet: fakeOfficialServersGet(), sleep: async () => {} }, historyDb });
  await refreshCycle({ outPath: file, discoveryOpts: { httpGet: fakeOfficialServersGet(), sleep: async () => {} }, historyDb });

  const server = createRosterServer({ outPath: file, historyDb });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/leaderboards/uptime?minRuns=1`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.totalRuns, 2);
  assert.ok(body.servers.length > 0);
  assert.equal(body.servers[0].uptimePercent, 100);

  server.close();
});

test('GET /leaderboards/uptime returns 503 when history tracking is not enabled', async () => {
  const file = tmpFile('roster.json');
  const server = createRosterServer({ outPath: file }); // no historyDb
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/leaderboards/uptime`);
  assert.equal(res.status, 503);

  server.close();
});

test('GET /rankings returns a ranked list once history exists', async () => {
  const file = tmpFile('roster.json');
  const historyDb = openHistoryDb(':memory:');
  await refreshCycle({ outPath: file, discoveryOpts: { httpGet: fakeOfficialServersGet(), sleep: async () => {} }, historyDb });

  const server = createRosterServer({ outPath: file, historyDb });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/rankings?minRuns=1`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.ok(body.servers.length > 0);
  assert.equal(body.servers[0].rank, 1);
  assert.ok('rankScore' in body.servers[0]);
  assert.ok(body.servers[0].components);

  server.close();
});

test('GET /rankings returns 503 when history tracking is not enabled', async () => {
  const file = tmpFile('roster.json');
  const server = createRosterServer({ outPath: file });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/rankings`);
  assert.equal(res.status, 503);

  server.close();
});

test('GET /rankings/:id returns rank neighborhood info for a tracked server', async () => {
  const file = tmpFile('roster.json');
  const historyDb = openHistoryDb(':memory:');
  await refreshCycle({ outPath: file, discoveryOpts: { httpGet: fakeOfficialServersGet(), sleep: async () => {} }, historyDb });

  const server = createRosterServer({ outPath: file, historyDb });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/rankings/1?minRuns=1`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.serverId, '1');
  assert.ok(body.ranking.rank >= 1);
  assert.ok(body.ranking.neighbors.length > 0);

  server.close();
});

test('GET /rankings/:id returns null ranking (not an error) for a server not in the ranking', async () => {
  const file = tmpFile('roster.json');
  const historyDb = openHistoryDb(':memory:');
  await refreshCycle({ outPath: file, discoveryOpts: { httpGet: fakeOfficialServersGet(), sleep: async () => {} }, historyDb });

  const server = createRosterServer({ outPath: file, historyDb });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/rankings/never-seen?minRuns=1`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.ranking, null);

  server.close();
});

test('GET /rankings/:id returns 503 when history tracking is not enabled', async () => {
  const file = tmpFile('roster.json');
  const server = createRosterServer({ outPath: file });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/rankings/1`);
  assert.equal(res.status, 503);

  server.close();
});

test('GET /incidents/status returns the stored snapshot without recomputing', async () => {
  const file = tmpFile('roster.json');
  const historyDb = openHistoryDb(':memory:');
  await refreshCycle({ outPath: file, discoveryOpts: { httpGet: fakeOfficialServersGet(), sleep: async () => {} }, historyDb });
  const stored = getIncidentStatus(historyDb);
  assert.ok(stored);
  assert.equal(stored.state, 'NORMAL');

  const server = createRosterServer({ outPath: file, historyDb });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/incidents/status`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=30');
  const body = await res.json();
  assert.equal(body.state, stored.state);
  assert.equal(body.computedAt, stored.computedAt);

  server.close();
});

test('GET /incidents/status returns 503 when history tracking is not enabled', async () => {
  const file = tmpFile('roster.json');
  const server = createRosterServer({ outPath: file });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/incidents/status`);
  assert.equal(res.status, 503);

  server.close();
});

test('refreshCycle records a fetch failure into incident state instead of a fake empty roster', async () => {
  const file = tmpFile('roster.json');
  const historyDb = openHistoryDb(':memory:');
  persistRosterAtomic(file, { servers: [{ id: '1' }] });

  await assert.rejects(
    () =>
      refreshCycle({
        outPath: file,
        discoveryOpts: { httpGet: async () => ({ status: 500, body: '[]' }), sleep: async () => {}, retry: { attempts: 1, baseDelayMs: 1 } },
        historyDb,
      }),
    /HTTP 500/
  );

  const status = getIncidentStatus(historyDb);
  assert.equal(status.rosterFetchFailed, true);
  assert.equal(status.consecutiveFetchFailures, 1);
  assert.equal(status.state, 'UNREACHABLE');
  // Previous roster file is left alone — we did not persist an empty list.
  assert.equal(readRosterIfExists(file).servers.length, 1);
});

// ---------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------
test('parseArgs handles a command plus flags with and without values', () => {
  const args = parseArgs(['discover-once', '--out', 'roster.json', '--debug']);
  assert.equal(args._[0], 'discover-once');
  assert.equal(args.out, 'roster.json');
  assert.equal(args.debug, true);
});

test('parseArgs handles the run command with numeric-looking flags', () => {
  const args = parseArgs(['run', '--port', '8792', '--interval-minutes', '60']);
  assert.equal(args._[0], 'run');
  assert.equal(args.port, '8792');
  assert.equal(args['interval-minutes'], '60');
});

// ---------------------------------------------------------------------
// GeoLite2 database path resolution
// ---------------------------------------------------------------------
test('resolveGeoDbPath prefers --geo-db over the env var', () => {
  const args = parseArgs(['discover-once', '--geo-db', '/from/flag.mmdb']);
  const result = resolveGeoDbPath(args, { GEOLITE2_DB_PATH: '/from/env.mmdb' });
  assert.equal(result, '/from/flag.mmdb');
});

test('resolveGeoDbPath falls back to GEOLITE2_DB_PATH', () => {
  const args = parseArgs(['discover-once']);
  const result = resolveGeoDbPath(args, { GEOLITE2_DB_PATH: '/from/env.mmdb' });
  assert.equal(result, '/from/env.mmdb');
});

test('resolveGeoDbPath returns undefined when neither is set', () => {
  const args = parseArgs(['discover-once']);
  assert.equal(resolveGeoDbPath(args, {}), undefined);
});

// ---------------------------------------------------------------------
// History database path resolution
// ---------------------------------------------------------------------
test('resolveHistoryDbPath defaults ON to ark_history.db, unlike GeoLite2', () => {
  const args = parseArgs(['run']);
  assert.equal(resolveHistoryDbPath(args, {}), 'ark_history.db');
});

test('resolveHistoryDbPath prefers --history-db over the env var', () => {
  const args = parseArgs(['run', '--history-db', '/from/flag.db']);
  assert.equal(resolveHistoryDbPath(args, { HISTORY_DB_PATH: '/from/env.db' }), '/from/flag.db');
});

test('resolveHistoryDbPath falls back to HISTORY_DB_PATH', () => {
  const args = parseArgs(['run']);
  assert.equal(resolveHistoryDbPath(args, { HISTORY_DB_PATH: '/from/env.db' }), '/from/env.db');
});

test('resolveHistoryDbPath returns null when --no-history is passed', () => {
  const args = parseArgs(['run', '--no-history']);
  assert.equal(resolveHistoryDbPath(args, { HISTORY_DB_PATH: '/from/env.db' }), null);
});

// ---------------------------------------------------------------------
// Unofficial pipeline (Phase A)
// ---------------------------------------------------------------------
function fakeUnofficialServers() {
  return {
    servers: [
      { id: 'u1', name: 'Community PvE', map: 'TheIsland_WP', gameMode: 'pve', playersNow: 4, maxPlayers: 20, version: '92.41', platformType: 'PC', ping: 40, wildcardReportedPing: 40, hasPassword: false },
      { id: 'u2', name: 'Community PvP', map: 'Extinction_WP', gameMode: 'pvp', playersNow: 8, maxPlayers: 30, version: '92.41', platformType: 'PC+PS5', ping: 90, wildcardReportedPing: 90, hasPassword: true },
    ],
    count: 2,
  };
}

test('refreshUnofficialCycle stores one trimmed roster and stamps cycles_seen', async () => {
  const unofficialState = createUnofficialState();
  const unofficialDb = openUnofficialDb(':memory:');
  const roster = await refreshUnofficialCycle({
    unofficialState,
    unofficialDb,
    fetchUnofficial: async () => fakeUnofficialServers(),
    now: () => '2026-08-16T10:00:00.000Z',
  });
  assert.equal(roster.count, 2);
  assert.equal(roster.cycles_total, 1);
  assert.equal(unofficialState.roster.servers[0].cycles_seen, 1);
  assert.equal(unofficialState.lastFetchStatus, 'ok');
});

test('unofficial fetch failure leaves official cycle untouched', async () => {
  const file = tmpFile('roster.json');
  const unofficialState = createUnofficialState();
  const unofficialDb = openUnofficialDb(':memory:');
  let officialCycles = 0;
  let unofficialErrors = 0;
  const fakeSetInterval = () => 'fake-timer-handle';

  const official = startScheduledRefresh({
    outPath: file,
    intervalMs: 999999,
    discoveryOpts: { httpGet: fakeOfficialServersGet(), sleep: async () => {} },
    onCycle: () => {
      officialCycles += 1;
    },
    setIntervalFn: fakeSetInterval,
  });

  const unofficial = startUnofficialScheduledRefresh({
    unofficialState,
    unofficialDb,
    intervalMs: 999999,
    fetchUnofficial: async () => {
      throw new Error('cdn down');
    },
    onError: () => {
      unofficialErrors += 1;
    },
    setIntervalFn: fakeSetInterval,
  });

  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(officialCycles, 1);
  assert.equal(unofficialErrors, 1);
  assert.ok(readRosterIfExists(file));
  assert.equal(readRosterIfExists(file).totalOfficial, 2);
  assert.equal(unofficialState.roster, null);
  assert.match(unofficialState.lastFetchStatus, /cdn down/);
  assert.equal(getUnofficialMeta(unofficialDb).cycles_total, 0);

  official.stop();
  unofficial.stop();
});

test('GET /unofficial/roster and /unofficial/meta serve the last good fetch', async () => {
  const file = tmpFile('roster.json');
  const unofficialState = createUnofficialState();
  const unofficialDb = openUnofficialDb(':memory:');
  await refreshUnofficialCycle({
    unofficialState,
    unofficialDb,
    fetchUnofficial: async () => fakeUnofficialServers(),
    now: () => '2026-08-16T11:00:00.000Z',
  });

  const server = createRosterServer({ outPath: file, unofficialState, unofficialDb });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const rosterRes = await fetch(`http://127.0.0.1:${port}/unofficial/roster`);
  const roster = await rosterRes.json();
  assert.equal(rosterRes.status, 200);
  assert.equal(roster.count, 2);
  assert.equal(roster.fetchedAt, '2026-08-16T11:00:00.000Z');
  assert.equal(roster.cycles_total, 1);
  assert.equal(roster.servers.length, 2);
  assert.equal(roster.servers[0].name, 'Community PvE');

  const metaRes = await fetch(`http://127.0.0.1:${port}/unofficial/meta`);
  const meta = await metaRes.json();
  assert.equal(metaRes.status, 200);
  assert.equal(meta.count, 2);
  assert.equal(meta.playersOnline, 12);
  assert.equal(meta.cycles_total, 1);
  assert.equal(meta.lastFetchAt, '2026-08-16T11:00:00.000Z');
  assert.equal(meta.lastFetchStatus, 'ok');
  assert.equal(meta.servers, undefined);

  server.close();
});

test('GET /unofficial/roster is 503 before the first good fetch; meta still has a shape', async () => {
  const file = tmpFile('roster.json');
  const unofficialState = createUnofficialState();
  const unofficialDb = openUnofficialDb(':memory:');
  const server = createRosterServer({ outPath: file, unofficialState, unofficialDb });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const rosterRes = await fetch(`http://127.0.0.1:${port}/unofficial/roster`);
  assert.equal(rosterRes.status, 503);

  const metaRes = await fetch(`http://127.0.0.1:${port}/unofficial/meta`);
  const meta = await metaRes.json();
  assert.equal(metaRes.status, 200);
  assert.equal(meta.count, 0);
  assert.equal(meta.playersOnline, null);
  assert.equal(meta.cycles_total, 0);
  assert.equal(meta.lastFetchAt, null);
  assert.equal(meta.lastFetchStatus, null);

  server.close();
});

test('failed unofficial cycle keeps the last good in-memory roster', async () => {
  const unofficialState = createUnofficialState();
  await refreshUnofficialCycle({
    unofficialState,
    fetchUnofficial: async () => fakeUnofficialServers(),
    now: () => '2026-08-16T12:00:00.000Z',
  });
  await assert.rejects(
    () =>
      refreshUnofficialCycle({
        unofficialState,
        fetchUnofficial: async () => {
          throw new Error('later fail');
        },
        now: () => '2026-08-16T12:15:00.000Z',
      }),
    /later fail/
  );
  assert.equal(unofficialState.roster.count, 2);
  assert.equal(unofficialState.roster.fetchedAt, '2026-08-16T12:00:00.000Z');
  assert.match(unofficialState.lastFetchStatus, /later fail/);
});

test('resolveUnofficialIntervalMs prefers env milliseconds over the minutes flag', () => {
  const args = parseArgs(['run', '--unofficial-interval', '20']);
  assert.equal(resolveUnofficialIntervalMs(args, { UNOFFICIAL_INTERVAL_MS: '45000' }), 45000);
  assert.equal(resolveUnofficialIntervalMs(args, {}), 20 * 60 * 1000);
  assert.equal(resolveUnofficialIntervalMs(parseArgs(['run']), {}), DEFAULT_UNOFFICIAL_INTERVAL_MS);
});

test('resolveUnofficialDbPath defaults to unofficial.sqlite', () => {
  assert.equal(resolveUnofficialDbPath(parseArgs(['run']), {}), 'unofficial.sqlite');
  assert.equal(resolveUnofficialDbPath(parseArgs(['run', '--unofficial-db', '/from/flag.db']), { UNOFFICIAL_DB_PATH: '/from/env.db' }), '/from/flag.db');
  assert.equal(resolveUnofficialDbPath(parseArgs(['run']), { UNOFFICIAL_DB_PATH: '/from/env.db' }), '/from/env.db');
});
