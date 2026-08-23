'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeModeStats,
  computeMapStats,
  computeClusterStats,
  computePlatformStats,
  getTopServersByPlayers,
  displayNameFor,
  renderStatsPage,
} = require('./stats_page.js');

function makeServers() {
  return [
    { id: '1', name: 'A', map: 'TheIsland_WP', gameMode: 'pve', playersNow: 10, maxPlayers: 70, clusterId: 'C1', platformType: 'PC+PS5' },
    { id: '2', name: 'B', map: 'TheIsland_WP', gameMode: 'pve', playersNow: 20, maxPlayers: 70, clusterId: 'C1', platformType: 'PC+XSX' },
    { id: '3', name: 'C', map: 'Aberration_WP', gameMode: 'pvp', playersNow: 30, maxPlayers: 70, clusterId: 'C2', platformType: 'PC+PS5+XSX+WINGDK' },
    { id: '4', name: 'D', map: 'Aberration_WP', gameMode: 'pvp', playersNow: 0, maxPlayers: 70, clusterId: null, platformType: 'PC' },
  ];
}

// ---------------------------------------------------------------------
// computeModeStats
// ---------------------------------------------------------------------
test('computeModeStats sums players and counts servers per mode', () => {
  const stats = computeModeStats(makeServers());
  assert.equal(stats.pve.serverCount, 2);
  assert.equal(stats.pve.totalPlayers, 30);
  assert.equal(stats.pvp.serverCount, 2);
  assert.equal(stats.pvp.totalPlayers, 30);
});

test('computeModeStats handles an empty roster', () => {
  const stats = computeModeStats([]);
  assert.equal(stats.pve.serverCount, 0);
  assert.equal(stats.pvp.totalPlayers, 0);
});

// ---------------------------------------------------------------------
// computeMapStats
// ---------------------------------------------------------------------
test('computeMapStats sorts by total players descending', () => {
  const stats = computeMapStats(makeServers());
  assert.equal(stats.length, 2);
  assert.ok(stats[0].totalPlayers >= stats[1].totalPlayers);
});

test('computeMapStats computes correct server counts, totals, and averages', () => {
  const stats = computeMapStats(makeServers());
  const theIsland = stats.find((s) => s.map === 'TheIsland_WP');
  assert.equal(theIsland.serverCount, 2);
  assert.equal(theIsland.totalPlayers, 30);
  assert.equal(theIsland.avgPlayers, 15);
});

test('computeMapStats ignores servers with no map set', () => {
  const stats = computeMapStats([{ map: null, playersNow: 5 }, { map: 'A', playersNow: 5 }]);
  assert.equal(stats.length, 1);
});

// ---------------------------------------------------------------------
// computeClusterStats
// ---------------------------------------------------------------------
test('computeClusterStats aggregates per cluster, ignoring servers with no cluster', () => {
  const stats = computeClusterStats(makeServers());
  assert.equal(stats.length, 2); // C1, C2 — server 4 has no clusterId
  const c1 = stats.find((c) => c.clusterId === 'C1');
  assert.equal(c1.serverCount, 2);
  assert.equal(c1.totalPlayers, 30);
});

test('computeClusterStats respects the limit', () => {
  const servers = Array.from({ length: 15 }, (_, i) => ({ clusterId: `C${i}`, playersNow: i }));
  assert.equal(computeClusterStats(servers, 5).length, 5);
});

// ---------------------------------------------------------------------
// computePlatformStats
// ---------------------------------------------------------------------
test('computePlatformStats counts servers per platform substring, sorted descending', () => {
  const stats = computePlatformStats(makeServers());
  const pc = stats.find((p) => p.platform === 'PC');
  assert.equal(pc.serverCount, 4); // all 4 servers include PC
  const wingdk = stats.find((p) => p.platform === 'WINGDK');
  assert.equal(wingdk.serverCount, 1);
});

// ---------------------------------------------------------------------
// getTopServersByPlayers
// ---------------------------------------------------------------------
test('getTopServersByPlayers sorts descending and respects the limit', () => {
  const top = getTopServersByPlayers(makeServers(), 2);
  assert.equal(top.length, 2);
  assert.deepEqual(top.map((s) => s.id), ['3', '2']);
});

test('getTopServersByPlayers excludes servers with a non-numeric playersNow', () => {
  const servers = [{ id: '1', playersNow: null }, { id: '2', playersNow: 5 }];
  const top = getTopServersByPlayers(servers, 10);
  assert.equal(top.length, 1);
  assert.equal(top[0].id, '2');
});

// ---------------------------------------------------------------------
// renderStatsPage
// ---------------------------------------------------------------------
test('renderStatsPage shows the fallback when the roster is unavailable', () => {
  const html = renderStatsPage({ rosterAvailable: false });
  assert.match(html, /discovery service may not be running/);
});

test('renderStatsPage renders mode, platform, map, and cluster sections', () => {
  const servers = makeServers();
  const html = renderStatsPage({
    rosterAvailable: true,
    counters: { totalOfficial: 4, playersOnline: 60 },
    modeStats: computeModeStats(servers),
    mapStats: computeMapStats(servers),
    clusterStats: computeClusterStats(servers),
    platformStats: computePlatformStats(servers),
    topByPlayers: getTopServersByPlayers(servers),
  });
  assert.match(html, /TheIsland_WP/);
  assert.match(html, /Aberration_WP/);
  assert.match(html, /C1/);
  assert.match(html, /href="\/clusters\/C1"/);
  assert.match(html, /href="\/clusters"/);
  assert.match(html, />PC</);
});

test('renderStatsPage links leaderboard previews into the suite instead of duplicating tables', () => {
  const html = renderStatsPage({
    rosterAvailable: true,
    counters: { totalOfficial: 0, playersOnline: 0 },
    modeStats: computeModeStats([]),
    mapStats: [],
    clusterStats: [],
    platformStats: computePlatformStats([]),
    topByPlayers: [],
  });
  assert.match(html, /href="\/leaderboards"/);
  assert.match(html, /href="\/leaderboards\/map-uptime"/);
  assert.match(html, /href="\/leaderboards\/pve-vs-pvp"/);
  assert.match(html, /href="\/leaderboards\/regions"/);
  assert.match(html, /href="\/leaderboards\/top-100"/);
  assert.match(html, /href="\/leaderboards\/bottom-100"/);
  assert.match(html, /href="\/rankings"/);
  assert.doesNotMatch(html, /Highest uptime servers/);
  assert.doesNotMatch(html, /Top ranked servers/);
});

test('renderStatsPage escapes a hostile map name (XSS check)', () => {
  const servers = [{ map: '<script>evil()</script>', playersNow: 1, gameMode: 'pve' }];
  const html = renderStatsPage({
    rosterAvailable: true,
    counters: { totalOfficial: 1, playersOnline: 1 },
    modeStats: computeModeStats(servers),
    mapStats: computeMapStats(servers),
    clusterStats: [],
    platformStats: computePlatformStats(servers),
    topByPlayers: [],
  });
  assert.doesNotMatch(html, /<script>evil\(\)<\/script>/);
});

// ---------------------------------------------------------------------
// displayNameFor — regression coverage for the bug that crashed /stats:
// a leaderboard entry with no serverId (or a non-string one) used to
// throw on .slice() instead of degrading gracefully.
// ---------------------------------------------------------------------
test('displayNameFor uses the real name when present', () => {
  assert.equal(displayNameFor({ name: 'NA-PVE-TheIsland5313', serverId: 'abc123' }), 'NA-PVE-TheIsland5313');
});

test('displayNameFor falls back to a shortened serverId when no name is set', () => {
  assert.equal(displayNameFor({ serverId: 'abcdefgh12345' }), 'Server abcdefgh\u2026');
});

test('displayNameFor never throws when serverId is missing entirely (the actual regression)', () => {
  assert.doesNotThrow(() => displayNameFor({}));
  assert.equal(displayNameFor({}), 'Unknown server');
});

test('displayNameFor never throws when serverId is null or a non-string', () => {
  assert.equal(displayNameFor({ serverId: null }), 'Unknown server');
  assert.equal(displayNameFor({ serverId: 12345 }), 'Unknown server');
});
