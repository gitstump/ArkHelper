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
  refreshInfoCycle,
  startInfoScheduledRefresh,
  createRosterServer,
  createModsSummaryCache,
  MODS_SUMMARY_CACHE_MAX,
  parseArgs,
  resolveGeoDbPath,
  resolveHistoryDbPath,
  resolveUnofficialDbPath,
  resolveUnofficialIntervalMs,
  resolveInfoDbPath,
  resolveInfoIntervalMs,
  resolveModsPass,
  DEFAULT_UNOFFICIAL_INTERVAL_MS,
  DEFAULT_INFO_INTERVAL_MS,
} = require('./discovery_service.js');
const { openUnofficialDb, getUnofficialMeta, upsertMods, getMod, getModsSummary } = require('./unofficial_store.js');
const { openInfoDb, getCurrentRates, getNewsEntries, getFeedsMeta } = require('./info_store.js');
const { openHistoryDb, computeUptimePercent, getIncidentStatus, recordSnapshotRun, getChangeEvents, getRecentWipes, getChangeLog } = require('./history.js');

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
  assert.deepEqual(body.routes, ['/roster', '/roster/meta', '/unofficial/roster', '/unofficial/meta', '/unofficial/server/:id', '/history/wipes', '/history/:id', '/leaderboards/uptime', '/rankings', '/rankings/:id', '/incidents/status', '/rates', '/news', '/mods/summary', '/mods/:id']);

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
  assert.deepEqual(body.changeEvents, []);
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
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  recordSnapshotRun(historyDb, [{ id: 'wipe-me', day: 45, version: '1' }], { now: () => twoHoursAgo });
  recordSnapshotRun(historyDb, [{ id: 'wipe-me', day: 1, version: '1' }], { now: () => hourAgo });
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
  assert.equal(meta.trackedTotal, 2);
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
  assert.equal(meta.trackedTotal, 0);

  server.close();
});

test('GET /unofficial/server/:id returns persisted latest-state and 404s unknown ids', async () => {
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
  const firstId = fakeUnofficialServers().servers[0].id;

  const found = await fetch(`http://127.0.0.1:${port}/unofficial/server/${encodeURIComponent(firstId)}`);
  const body = await found.json();
  assert.equal(found.status, 200);
  assert.equal(body.id, firstId);
  assert.equal(body.name, 'Community PvE');
  assert.equal(body.lastSeen, '2026-08-16T11:00:00.000Z');
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'day'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'allowCharTransfers'), false);

  const missing = await fetch(`http://127.0.0.1:${port}/unofficial/server/does-not-exist`);
  assert.equal(missing.status, 404);

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

function fakeInfoFeeds() {
  return {
    rates: {
      official: { TamingSpeedMultiplier: 2, XPMultiplier: 2, HarvestAmountMultiplier: 2 },
      arkpocalypse: { TamingSpeedMultiplier: 5 },
    },
    news: [
      {
        type: 'CTA',
        imagePath: 'https://cdn.example/a.jpg',
        title: null,
        body: null,
        action: 'Link::https://survivetheark.com/index.php?/articles.html/community-crunch-519-tusk-tusk-boom-r2553/',
        url: 'https://survivetheark.com/index.php?/articles.html/community-crunch-519-tusk-tusk-boom-r2553/',
      },
    ],
    errors: {},
  };
}

test('refreshInfoCycle stores rates and news from a successful poll', async () => {
  const infoDb = openInfoDb(':memory:');
  const result = await refreshInfoCycle({
    infoDb,
    fetchInfo: async () => fakeInfoFeeds(),
    now: () => '2026-08-16T10:00:00.000Z',
  });
  assert.equal(result.rates.official.TamingSpeedMultiplier, 2);
  assert.equal(getCurrentRates(infoDb).official.TamingSpeedMultiplier, 2);
  assert.equal(getNewsEntries(infoDb).length, 1);
  assert.equal(getFeedsMeta(infoDb).last_fetch_status, 'ok');
});

test('info-feed fetch failure leaves the official cycle untouched', async () => {
  const file = tmpFile('roster.json');
  const infoDb = openInfoDb(':memory:');
  let officialCycles = 0;
  let infoErrors = 0;
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

  const info = startInfoScheduledRefresh({
    infoDb,
    intervalMs: 999999,
    fetchInfo: async () => {
      throw new Error('cdn down');
    },
    onError: () => {
      infoErrors += 1;
    },
    setIntervalFn: fakeSetInterval,
  });

  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(officialCycles, 1);
  assert.equal(infoErrors, 1);
  assert.ok(readRosterIfExists(file));
  assert.equal(readRosterIfExists(file).totalOfficial, 2);
  assert.equal(getFeedsMeta(infoDb).cycles_total, 0);
  assert.match(getFeedsMeta(infoDb).last_fetch_status, /cdn down/);

  official.stop();
  info.stop();
});

test('GET /rates and /news serve stored feed data', async () => {
  const file = tmpFile('roster.json');
  const infoDb = openInfoDb(':memory:');
  await refreshInfoCycle({
    infoDb,
    fetchInfo: async () => fakeInfoFeeds(),
    now: () => '2026-08-16T11:00:00.000Z',
  });

  const server = createRosterServer({ outPath: file, infoDb });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const ratesRes = await fetch(`http://127.0.0.1:${port}/rates`);
  const rates = await ratesRes.json();
  assert.equal(ratesRes.status, 200);
  assert.equal(rates.variants.official.TamingSpeedMultiplier, 2);
  assert.equal(rates.lastFetchAt, '2026-08-16T11:00:00.000Z');
  assert.ok(Array.isArray(rates.changes));

  const newsRes = await fetch(`http://127.0.0.1:${port}/news`);
  const news = await newsRes.json();
  assert.equal(newsRes.status, 200);
  assert.equal(news.entries.length, 1);
  assert.equal(news.entries[0].firstSeen, '2026-08-16T11:00:00.000Z');

  server.close();
});

test('GET /rates and /news are 503 before the first good fetch', async () => {
  const file = tmpFile('roster.json');
  const infoDb = openInfoDb(':memory:');
  const server = createRosterServer({ outPath: file, infoDb });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const ratesRes = await fetch(`http://127.0.0.1:${port}/rates`);
  assert.equal(ratesRes.status, 503);
  const newsRes = await fetch(`http://127.0.0.1:${port}/news`);
  assert.equal(newsRes.status, 503);

  server.close();
});

test('resolveInfoIntervalMs prefers env milliseconds over the minutes flag', () => {
  const args = parseArgs(['run', '--info-interval', '20']);
  assert.equal(resolveInfoIntervalMs(args, { INFO_INTERVAL_MS: '45000' }), 45000);
  assert.equal(resolveInfoIntervalMs(args, {}), 20 * 60 * 1000);
  assert.equal(resolveInfoIntervalMs(parseArgs(['run']), {}), DEFAULT_INFO_INTERVAL_MS);
});

test('resolveInfoDbPath defaults to feeds.sqlite', () => {
  assert.equal(resolveInfoDbPath(parseArgs(['run']), {}), 'feeds.sqlite');
  assert.equal(resolveInfoDbPath(parseArgs(['run', '--info-db', '/from/flag.db']), { INFO_DB_PATH: '/from/env.db' }), '/from/flag.db');
  assert.equal(resolveInfoDbPath(parseArgs(['run']), { INFO_DB_PATH: '/from/env.db' }), '/from/env.db');
});

function modsServers(count, playersByIndex) {
  const servers = [];
  for (let i = 0; i < count; i += 1) {
    const id = i + 1;
    servers.push({
      id: `s${id}`,
      name: `Server ${id}`,
      map: 'TheIsland_WP',
      gameMode: 'pve',
      playersNow: playersByIndex ? playersByIndex(i) : 1,
      maxPlayers: 20,
      modIds: [id],
    });
  }
  return servers;
}

test('mods resolution is skipped without a key and logs once per process', async () => {
  const unofficialState = createUnofficialState();
  const unofficialDb = openUnofficialDb(':memory:');
  const logs = [];
  const state = { disabledLogged: false };
  await refreshUnofficialCycle({
    unofficialState,
    unofficialDb,
    fetchUnofficial: async () => ({ servers: modsServers(1), count: 1 }),
    now: () => '2026-08-18T12:00:00.000Z',
    curseforgeApiKey: '',
    fetchMods: async () => {
      throw new Error('should not fetch');
    },
    log: (msg) => logs.push(msg),
    modsState: state,
  });
  await refreshUnofficialCycle({
    unofficialState,
    unofficialDb,
    fetchUnofficial: async () => ({ servers: modsServers(1), count: 1 }),
    now: () => '2026-08-18T12:15:00.000Z',
    curseforgeApiKey: '',
    fetchMods: async () => {
      throw new Error('should not fetch');
    },
    log: (msg) => logs.push(msg),
    modsState: state,
  });
  assert.equal(unofficialState.lastFetchStatus, 'ok');
  assert.equal(logs.length, 1);
  assert.equal(logs[0], '[discovery] mods resolution disabled (CURSEFORGE_API_KEY not set)');
});

test('mods resolution batches unknown ids (cap 4) then one stale batch and stops on failure', async () => {
  const unofficialDb = openUnofficialDb(':memory:');
  const servers = [];
  for (let i = 1; i <= 220; i += 1) {
    servers.push({
      id: `u${i}`,
      name: `U${i}`,
      map: 'TheIsland_WP',
      playersNow: 1,
      maxPlayers: 10,
      modIds: [i],
    });
  }
  await refreshUnofficialCycle({
    unofficialState: createUnofficialState(),
    unofficialDb,
    fetchUnofficial: async () => ({ servers, count: servers.length }),
    now: () => '2026-08-18T13:00:00.000Z',
    curseforgeApiKey: '',
    fetchMods: async () => [],
    log: () => {},
    modsState: { disabledLogged: true },
  });
  upsertMods(unofficialDb, [{ id: 300, name: 'stale-one' }], { now: () => '2026-08-01T00:00:00.000Z' });

  const calls = [];
  const sleeps = [];
  const logs = [];
  const result = await resolveModsPass({
    unofficialDb,
    apiKey: 'fake-key',
    fetchMods: async ({ modIds }) => {
      calls.push(modIds.slice());
      return modIds.map((id) => ({ id, name: `Mod ${id}` }));
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    now: () => '2026-08-18T13:00:00.000Z',
    log: (msg) => logs.push(msg),
    state: { disabledLogged: true },
  });
  assert.equal(calls.length, 5);
  assert.equal(calls[0].length, 50);
  assert.equal(calls[3].length, 50);
  assert.deepEqual(calls[4], [300]);
  assert.equal(sleeps.length, 4);
  assert.ok(sleeps.every((ms) => ms === 1000));
  assert.equal(result.newCount, 200);
  assert.equal(result.refreshedCount, 1);
  assert.equal(result.failedCount, 0);
  assert.match(logs[0], /mods resolved: 200 new, 1 refreshed, 0 failed/);
  assert.doesNotMatch(logs.join('\n'), /fake-key/);

  const failDb = openUnofficialDb(':memory:');
  const failServers = [];
  for (let i = 1; i <= 60; i += 1) {
    failServers.push({
      id: `f${i}`,
      name: `F${i}`,
      map: 'TheIsland_WP',
      playersNow: 1,
      maxPlayers: 10,
      modIds: [i],
    });
  }
  await refreshUnofficialCycle({
    unofficialState: createUnofficialState(),
    unofficialDb: failDb,
    fetchUnofficial: async () => ({ servers: failServers, count: failServers.length }),
    now: () => '2026-08-18T13:00:00.000Z',
    curseforgeApiKey: '',
    fetchMods: async () => [],
    log: () => {},
    modsState: { disabledLogged: true },
  });
  const failCalls = [];
  const failResult = await resolveModsPass({
    unofficialDb: failDb,
    apiKey: 'fake-key',
    fetchMods: async ({ modIds }) => {
      failCalls.push(modIds.slice());
      throw new Error('cf down');
    },
    sleep: async () => {},
    now: () => '2026-08-18T13:00:00.000Z',
    log: () => {},
    state: { disabledLogged: true },
  });
  assert.equal(failCalls.length, 1);
  assert.equal(failCalls[0].length, 50);
  assert.equal(failResult.failedCount, 50);
  assert.equal(failResult.newCount, 0);
  assert.equal(getMod(failDb, failCalls[0][0]).status, 'error');
});

test('GET /mods/summary and /mods/:id serve adoption data; empty-db and 404 cases', async () => {
  const file = tmpFile('roster.json');
  const emptyServer = createRosterServer({ outPath: file });
  await new Promise((resolve) => emptyServer.listen(0, resolve));
  const emptyPort = emptyServer.address().port;
  const emptyRes = await fetch(`http://127.0.0.1:${emptyPort}/mods/summary`);
  const emptyBody = await emptyRes.json();
  assert.equal(emptyRes.status, 200);
  assert.deepEqual(emptyBody, { mods: [], lastFetchAt: null });
  emptyServer.close();

  const unofficialState = createUnofficialState();
  const unofficialDb = openUnofficialDb(':memory:');
  await refreshUnofficialCycle({
    unofficialState,
    unofficialDb,
    fetchUnofficial: async () => ({
      servers: [
        { id: 'a', name: 'Alpha', map: 'TheIsland_WP', playersNow: 6, maxPlayers: 20, modIds: [11, 12] },
        { id: 'b', name: 'Beta', map: 'Extinction_WP', playersNow: 3, maxPlayers: 20, modIds: [11] },
      ],
      count: 2,
    }),
    now: () => '2026-08-18T14:00:00.000Z',
    curseforgeApiKey: 'fake-key',
    fetchMods: async ({ modIds }) =>
      modIds.map((id) => ({
        id,
        name: id === 11 ? 'S+' : 'Other',
        author: 'CF',
        downloadCount: 10,
      })),
    sleep: async () => {},
    log: () => {},
    modsState: { disabledLogged: true },
  });

  const server = createRosterServer({ outPath: file, unofficialState, unofficialDb });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const summaryRes = await fetch(`http://127.0.0.1:${port}/mods/summary?limit=10`);
  const summary = await summaryRes.json();
  assert.equal(summaryRes.status, 200);
  assert.equal(summary.lastFetchAt, '2026-08-18T14:00:00.000Z');
  assert.equal(summary.mods[0].mod_id, 11);
  assert.equal(summary.mods[0].server_count, 2);
  assert.equal(summary.mods[0].players_now, 9);
  assert.equal(summary.mods[0].name, 'S+');

  const detailRes = await fetch(`http://127.0.0.1:${port}/mods/11`);
  const detail = await detailRes.json();
  assert.equal(detailRes.status, 200);
  assert.equal(detail.name, 'S+');
  assert.equal(detail.servers.length, 2);
  assert.equal(detail.servers[0].name, 'Alpha');

  const missRes = await fetch(`http://127.0.0.1:${port}/mods/999`);
  assert.equal(missRes.status, 404);

  server.close();
});

test('createModsSummaryCache invalidates on last_fetch_at change and bounds distinct limits', () => {
  const cache = createModsSummaryCache({ max: MODS_SUMMARY_CACHE_MAX });
  cache.set(1, 't1', ['a']);
  assert.deepEqual(cache.get(1, 't1'), ['a']);
  assert.equal(cache.size, 1);

  cache.set(1, 't2', ['b']);
  assert.deepEqual(cache.get(1, 't2'), ['b']);
  assert.equal(cache.size, 1);

  for (let i = 1; i <= MODS_SUMMARY_CACHE_MAX; i += 1) cache.set(i, 't2', [i]);
  assert.equal(cache.size, MODS_SUMMARY_CACHE_MAX);
  cache.set(MODS_SUMMARY_CACHE_MAX + 1, 't2', ['overflow']);
  assert.equal(cache.size, MODS_SUMMARY_CACHE_MAX);
  assert.equal(cache.get(1, 't2'), undefined);
  assert.deepEqual(cache.get(MODS_SUMMARY_CACHE_MAX + 1, 't2'), ['overflow']);
});

test('GET /mods/summary cache hits skip recompute until last_fetch_at changes; limit map is bounded', async () => {
  const file = tmpFile('roster.json');
  const unofficialState = createUnofficialState();
  const unofficialDb = openUnofficialDb(':memory:');
  await refreshUnofficialCycle({
    unofficialState,
    unofficialDb,
    fetchUnofficial: async () => ({
      servers: [
        { id: 'a', name: 'Alpha', map: 'TheIsland_WP', playersNow: 6, maxPlayers: 20, modIds: [11, 12] },
        { id: 'b', name: 'Beta', map: 'Extinction_WP', playersNow: 3, maxPlayers: 20, modIds: [11] },
      ],
      count: 2,
    }),
    now: () => '2026-08-19T14:00:00.000Z',
    curseforgeApiKey: '',
    sleep: async () => {},
    log: () => {},
    modsState: { disabledLogged: true },
  });

  let computes = 0;
  function countingSummary(db, opts) {
    computes += 1;
    return getModsSummary(db, opts);
  }

  const server = createRosterServer({
    outPath: file,
    unofficialState,
    unofficialDb,
    getModsSummaryFn: countingSummary,
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const summaryUrl = `http://127.0.0.1:${port}/mods/summary`;

  const first = await fetch(`${summaryUrl}?limit=10`);
  const firstBody = await first.json();
  assert.equal(first.status, 200);
  assert.equal(firstBody.lastFetchAt, '2026-08-19T14:00:00.000Z');
  assert.equal(firstBody.mods[0].mod_id, 11);
  assert.equal(computes, 1);

  const second = await fetch(`${summaryUrl}?limit=10`);
  const secondBody = await second.json();
  assert.equal(second.status, 200);
  assert.deepEqual(secondBody, firstBody);
  assert.equal(computes, 1);

  unofficialState.lastFetchAt = '2026-08-19T14:15:00.000Z';
  unofficialDb.prepare(`UPDATE unofficial_meta SET last_fetch_at = ? WHERE id = 1`).run(
    '2026-08-19T14:15:00.000Z'
  );
  const afterRotate = await fetch(`${summaryUrl}?limit=10`);
  assert.equal(afterRotate.status, 200);
  assert.equal((await afterRotate.json()).lastFetchAt, '2026-08-19T14:15:00.000Z');
  assert.equal(computes, 2);

  for (let i = 1; i <= MODS_SUMMARY_CACHE_MAX + 1; i += 1) {
    const res = await fetch(`${summaryUrl}?limit=${i}`);
    assert.equal(res.status, 200);
    await res.json();
  }
  const afterFill = computes;
  const evicted = await fetch(`${summaryUrl}?limit=1`);
  assert.equal(evicted.status, 200);
  await evicted.json();
  assert.equal(computes, afterFill + 1);

  const newest = await fetch(`${summaryUrl}?limit=${MODS_SUMMARY_CACHE_MAX + 1}`);
  assert.equal(newest.status, 200);
  await newest.json();
  assert.equal(computes, afterFill + 1);

  server.close();
});

test('GET /roster serves cached file bytes keyed by mtime', async () => {
  const payload = Buffer.from(JSON.stringify({ generatedAt: 'T', servers: [{ id: '1' }] }));
  let reads = 0;
  let mtimeMs = 1_000;
  const fsDeps = {
    statSync: () => ({ mtimeMs }),
    readFileSync: () => {
      reads += 1;
      return payload;
    },
  };
  const server = createRosterServer({ outPath: 'roster.json', fsDeps });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/roster`;

  const first = await fetch(url);
  const firstBody = Buffer.from(await first.arrayBuffer());
  assert.equal(first.status, 200);
  assert.equal(Number(first.headers.get('content-length')), payload.length);
  assert.equal(Buffer.compare(firstBody, payload), 0);
  assert.equal(reads, 1);

  const second = await fetch(url);
  const secondBody = Buffer.from(await second.arrayBuffer());
  assert.equal(second.status, 200);
  assert.equal(Number(second.headers.get('content-length')), payload.length);
  assert.equal(Buffer.compare(secondBody, firstBody), 0);
  assert.equal(reads, 1);

  mtimeMs = 2_000;
  const third = await fetch(url);
  assert.equal(third.status, 200);
  assert.equal(reads, 2);
  assert.equal(Number(third.headers.get('content-length')), payload.length);

  server.close();
});

test('GET /unofficial/roster restringifies only when lastFetchAt changes', async () => {
  let stringifies = 0;
  const roster = { count: 1, servers: [{ id: 'u1', name: 'Community' }] };
  const unofficialState = {
    roster,
    lastFetchAt: '2026-08-19T14:00:00.000Z',
    lastFetchStatus: 'ok',
  };
  const jsonStringify = (value) => {
    stringifies += 1;
    return JSON.stringify(value);
  };
  const file = tmpFile('roster.json');
  const server = createRosterServer({ outPath: file, unofficialState, jsonStringify });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/unofficial/roster`;
  const expected = JSON.stringify(roster);

  const first = await fetch(url);
  const firstText = await first.text();
  assert.equal(first.status, 200);
  assert.equal(firstText, expected);
  assert.equal(Number(first.headers.get('content-length')), Buffer.byteLength(expected));
  assert.equal(stringifies, 1);

  unofficialState.roster = { count: 9, servers: [{ id: 'mutated' }] };
  const second = await fetch(url);
  const secondText = await second.text();
  assert.equal(second.status, 200);
  assert.equal(secondText, expected);
  assert.equal(Number(second.headers.get('content-length')), Buffer.byteLength(expected));
  assert.equal(stringifies, 1);

  unofficialState.lastFetchAt = '2026-08-19T14:15:00.000Z';
  const third = await fetch(url);
  const thirdText = await third.text();
  assert.equal(third.status, 200);
  assert.equal(thirdText, JSON.stringify(unofficialState.roster));
  assert.equal(Number(third.headers.get('content-length')), Buffer.byteLength(thirdText));
  assert.equal(stringifies, 2);

  server.close();
});

function unofficialChangeServer(id, extra = {}) {
  return {
    id,
    name: `Community ${id}`,
    map: extra.map || 'TheIsland_WP',
    gameMode: 'pve',
    playersNow: extra.playersNow ?? 4,
    maxPlayers: extra.maxPlayers ?? 20,
    version: extra.version || '92.41',
    platformType: 'PC',
    ping: 40,
    wildcardReportedPing: 40,
    hasPassword: false,
    ...(Object.prototype.hasOwnProperty.call(extra, 'day') ? { day: extra.day } : {}),
  };
}

async function unofficialChangeCycle({ unofficialState, unofficialDb, historyDb, servers, at }) {
  return refreshUnofficialCycle({
    unofficialState,
    unofficialDb,
    historyDb,
    fetchUnofficial: async () => ({ servers, count: servers.length }),
    now: () => at,
  });
}

test('unofficial cycle: a changed field held two cycles writes one event; reverting writes none', async () => {
  const unofficialState = createUnofficialState();
  const unofficialDb = openUnofficialDb(':memory:');
  const historyDb = openHistoryDb(':memory:');
  const base = unofficialChangeServer('u-hold');

  await unofficialChangeCycle({
    unofficialState,
    unofficialDb,
    historyDb,
    servers: [{ ...base, version: '92.41' }],
    at: '2026-08-16T00:00:00.000Z',
  });
  await unofficialChangeCycle({
    unofficialState,
    unofficialDb,
    historyDb,
    servers: [{ ...base, version: '92.47' }],
    at: '2026-08-16T00:15:00.000Z',
  });
  assert.deepEqual(getChangeEvents(historyDb, 'u-hold'), []);

  const held = await unofficialChangeCycle({
    unofficialState,
    unofficialDb,
    historyDb,
    servers: [{ ...base, version: '92.47' }],
    at: '2026-08-16T00:30:00.000Z',
  });
  const events = getChangeEvents(historyDb, 'u-hold');
  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, 'version_change');
  assert.equal(events[0].oldValue, '92.41');
  assert.equal(events[0].newValue, '92.47');
  assert.equal(held.changeEventsWritten, 1);

  await unofficialChangeCycle({
    unofficialState,
    unofficialDb,
    historyDb,
    servers: [{ ...base, version: '92.41' }],
    at: '2026-08-16T00:45:00.000Z',
  });
  assert.equal(getChangeEvents(historyDb, 'u-hold').length, 1);
});

test('unofficial cycle: absent one cycle then reappearing with different values writes no events', async () => {
  const unofficialState = createUnofficialState();
  const unofficialDb = openUnofficialDb(':memory:');
  const historyDb = openHistoryDb(':memory:');
  const server = unofficialChangeServer('u-gone', { version: '92.41', map: 'TheIsland_WP', maxPlayers: 20 });
  const other = unofficialChangeServer('u-stay');

  await unofficialChangeCycle({
    unofficialState,
    unofficialDb,
    historyDb,
    servers: [server, other],
    at: '2026-08-16T01:00:00.000Z',
  });
  await unofficialChangeCycle({
    unofficialState,
    unofficialDb,
    historyDb,
    servers: [other],
    at: '2026-08-16T01:15:00.000Z',
  });
  await unofficialChangeCycle({
    unofficialState,
    unofficialDb,
    historyDb,
    servers: [{ ...server, version: '92.47', map: 'Extinction_WP', maxPlayers: 50 }, other],
    at: '2026-08-16T01:30:00.000Z',
  });
  await unofficialChangeCycle({
    unofficialState,
    unofficialDb,
    historyDb,
    servers: [{ ...server, version: '92.47', map: 'Extinction_WP', maxPlayers: 50 }, other],
    at: '2026-08-16T01:45:00.000Z',
  });

  assert.deepEqual(getChangeEvents(historyDb, 'u-gone'), []);
});

test('unofficial cycle: held day 5 to 1 wipe appears in getRecentWipes', async () => {
  const unofficialState = createUnofficialState();
  const unofficialDb = openUnofficialDb(':memory:');
  const historyDb = openHistoryDb(':memory:');
  const server = unofficialChangeServer('u-wipe', { day: 5 });

  await unofficialChangeCycle({
    unofficialState,
    unofficialDb,
    historyDb,
    servers: [server],
    at: '2026-08-16T02:00:00.000Z',
  });
  await unofficialChangeCycle({
    unofficialState,
    unofficialDb,
    historyDb,
    servers: [{ ...server, day: 1 }],
    at: '2026-08-16T02:15:00.000Z',
  });
  assert.deepEqual(getRecentWipes(historyDb), []);

  await unofficialChangeCycle({
    unofficialState,
    unofficialDb,
    historyDb,
    servers: [{ ...server, day: 1 }],
    at: '2026-08-16T02:30:00.000Z',
  });

  const wipes = getRecentWipes(historyDb);
  assert.equal(wipes.length, 1);
  assert.equal(wipes[0].serverId, 'u-wipe');
  assert.equal(wipes[0].seenAt, '2026-08-16T02:30:00.000Z');
  const wipeRows = historyDb.prepare("SELECT COUNT(*) as c FROM change_log WHERE change_type = 'wipe'").get();
  assert.equal(wipeRows.c, 0);
});

test('unofficial cycle: a one-cycle day flap writes no wipe event and no recently-wiped entry', async () => {
  const unofficialState = createUnofficialState();
  const unofficialDb = openUnofficialDb(':memory:');
  const historyDb = openHistoryDb(':memory:');
  const server = unofficialChangeServer('u-flap', { day: 5 });

  await unofficialChangeCycle({
    unofficialState,
    unofficialDb,
    historyDb,
    servers: [server],
    at: '2026-08-16T03:00:00.000Z',
  });
  await unofficialChangeCycle({
    unofficialState,
    unofficialDb,
    historyDb,
    servers: [{ ...server, day: 1 }],
    at: '2026-08-16T03:15:00.000Z',
  });
  await unofficialChangeCycle({
    unofficialState,
    unofficialDb,
    historyDb,
    servers: [{ ...server, day: 5 }],
    at: '2026-08-16T03:30:00.000Z',
  });

  assert.deepEqual(getChangeEvents(historyDb, 'u-flap'), []);
  assert.deepEqual(getRecentWipes(historyDb), []);
});

test('unofficial cycle: fields absent on the live path produce no events and no errors', async () => {
  const unofficialState = createUnofficialState();
  const unofficialDb = openUnofficialDb(':memory:');
  const historyDb = openHistoryDb(':memory:');
  const server = unofficialChangeServer('u-noday');
  assert.equal(Object.prototype.hasOwnProperty.call(server, 'day'), false);

  await unofficialChangeCycle({
    unofficialState,
    unofficialDb,
    historyDb,
    servers: [server],
    at: '2026-08-16T04:00:00.000Z',
  });
  await unofficialChangeCycle({
    unofficialState,
    unofficialDb,
    historyDb,
    servers: [{ ...server, version: '92.47' }],
    at: '2026-08-16T04:15:00.000Z',
  });
  const held = await unofficialChangeCycle({
    unofficialState,
    unofficialDb,
    historyDb,
    servers: [{ ...server, version: '92.47' }],
    at: '2026-08-16T04:30:00.000Z',
  });

  const events = getChangeEvents(historyDb, 'u-noday');
  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, 'version_change');
  assert.ok(!events.some((e) => e.eventType === 'probable_wipe'));
  assert.deepEqual(getRecentWipes(historyDb), []);
  assert.equal(held.changeEventsWritten, 1);
});

test('unofficial cycle: day appearing for the first time writes no event', async () => {
  const unofficialState = createUnofficialState();
  const unofficialDb = openUnofficialDb(':memory:');
  const historyDb = openHistoryDb(':memory:');
  const server = unofficialChangeServer('u-newday');

  await unofficialChangeCycle({
    unofficialState,
    unofficialDb,
    historyDb,
    servers: [server],
    at: '2026-08-16T06:00:00.000Z',
  });
  await unofficialChangeCycle({
    unofficialState,
    unofficialDb,
    historyDb,
    servers: [{ ...server, day: 12 }],
    at: '2026-08-16T06:15:00.000Z',
  });
  await unofficialChangeCycle({
    unofficialState,
    unofficialDb,
    historyDb,
    servers: [{ ...server, day: 12 }],
    at: '2026-08-16T06:30:00.000Z',
  });

  assert.deepEqual(getChangeEvents(historyDb, 'u-newday'), []);
  assert.deepEqual(getRecentWipes(historyDb), []);
});

test('unofficial cycle: batched inserts write one event per held version change over fixture data', async () => {
  const unofficialState = createUnofficialState();
  const unofficialDb = openUnofficialDb(':memory:');
  const historyDb = openHistoryDb(':memory:');
  const count = 20;
  const baseline = Array.from({ length: count }, (_, i) => unofficialChangeServer(`u-fix-${i}`, { version: '92.41' }));
  const bumped = baseline.map((s, i) => (i < 8 ? { ...s, version: '92.47' } : s));

  await unofficialChangeCycle({
    unofficialState,
    unofficialDb,
    historyDb,
    servers: baseline,
    at: '2026-08-16T05:00:00.000Z',
  });
  await unofficialChangeCycle({
    unofficialState,
    unofficialDb,
    historyDb,
    servers: bumped,
    at: '2026-08-16T05:15:00.000Z',
  });
  const confirming = await unofficialChangeCycle({
    unofficialState,
    unofficialDb,
    historyDb,
    servers: bumped,
    at: '2026-08-16T05:30:00.000Z',
  });

  const written = historyDb.prepare('SELECT COUNT(*) as c FROM server_change_events').get().c;
  assert.equal(written, 8);
  assert.equal(confirming.changeEventsWritten, 8);
  assert.equal(getChangeLog(historyDb, 'u-fix-0').length, 0);
});
