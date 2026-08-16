'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeMapUptime,
  computePveVsPvp,
  bottomFromRoster,
  renderLeaderboardsIndex,
  renderMapUptimePage,
  renderPveVsPvpPage,
  renderTop100Page,
  renderBottom100Page,
  FULL_CONFIDENCE,
} = require('./leaderboards_page.js');

function fixtureServers() {
  return [
    {
      id: 'island-pve',
      name: 'EU-PVE-TheIsland5313',
      map: 'TheIsland_WP',
      gameMode: 'pve',
      playersNow: 10,
      maxPlayers: 70,
      wildcardReportedPing: 40,
      uptimePercent: 99,
      avgPopulationPercent: 50,
      rankScore: 90,
      rank: 1,
      rankComponents: { reliability: 40, connection: 25, activity: 15, confidence: 10 },
    },
    {
      id: 'island-pvp',
      name: 'NA-PVP-TheIsland12',
      map: 'TheIsland_WP',
      gameMode: 'pvp',
      playersNow: 20,
      maxPlayers: 70,
      wildcardReportedPing: 80,
      uptimePercent: 90,
      avgPopulationPercent: 30,
      rankScore: 40,
      rank: 3,
      rankComponents: { reliability: 20, connection: 10, activity: 5, confidence: 10 },
    },
    {
      id: 'abb-pvp',
      name: 'Asia-PVP-Aberration1',
      map: 'Aberration_WP',
      gameMode: 'pvp',
      playersNow: 5,
      maxPlayers: 70,
      wildcardReportedPing: 200,
      uptimePercent: 80,
      avgPopulationPercent: 20,
      rankScore: 25,
      rank: 4,
      rankComponents: { reliability: 10, connection: 5, activity: 5, confidence: 10 },
    },
    {
      id: 'new-pve',
      name: 'EU-PVE-New1',
      map: 'Astraeos_WP',
      gameMode: 'pve',
      playersNow: null,
      maxPlayers: 70,
      wildcardReportedPing: null,
      uptimePercent: 100,
      avgPopulationPercent: 10,
      rankScore: 8,
      rank: 5,
      rankComponents: { reliability: 8, connection: 0, activity: 0, confidence: 2 },
    },
    {
      id: 'scorched-pve',
      name: 'NA-PVE-Scorched1',
      map: 'ScorchedEarth_WP',
      gameMode: 'pve',
      playersNow: 2,
      maxPlayers: 70,
      wildcardReportedPing: 50,
      uptimePercent: 95,
      avgPopulationPercent: 40,
      rankScore: 70,
      rank: 2,
      rankComponents: { reliability: 36, connection: 20, activity: 4, confidence: 10 },
    },
  ];
}

test('computeMapUptime averages 7-day uptime and population per map and sorts by uptime', () => {
  const maps = computeMapUptime(fixtureServers());
  assert.deepEqual(
    maps.map((m) => m.map),
    ['Astraeos_WP', 'ScorchedEarth_WP', 'TheIsland_WP', 'Aberration_WP']
  );
  const island = maps.find((m) => m.map === 'TheIsland_WP');
  assert.equal(island.serverCount, 2);
  assert.equal(island.avgUptimePercent, 94.5);
  assert.equal(island.avgPopulationPercent, 40);
  const astraeos = maps.find((m) => m.map === 'Astraeos_WP');
  assert.equal(astraeos.avgUptimePercent, 100);
});

test('computeMapUptime ignores servers with no map and empty input', () => {
  assert.deepEqual(computeMapUptime([{ map: null, uptimePercent: 100 }]), []);
  assert.deepEqual(computeMapUptime(null), []);
});

test('computePveVsPvp compares modes and reports PvE minus PvP deltas', () => {
  const result = computePveVsPvp(fixtureServers());
  assert.equal(result.pve.serverCount, 3);
  assert.equal(result.pvp.serverCount, 2);
  assert.equal(result.pve.totalPlayers, 12);
  assert.equal(result.pvp.totalPlayers, 25);
  assert.equal(result.pve.onlinePercent, 66.7);
  assert.equal(result.pvp.onlinePercent, 100);
  assert.equal(result.pve.avgUptime, 98);
  assert.equal(result.pvp.avgUptime, 85);
  assert.equal(result.deltas.serverCount, 1);
  assert.equal(result.deltas.totalPlayers, -13);
  assert.equal(result.pve.topMaps[0].map, 'Astraeos_WP');
  assert.equal(result.pvp.topMaps[0].map, 'Aberration_WP');
});

test('bottomFromRoster excludes thin-history servers and sorts lowest score first', () => {
  const result = bottomFromRoster(fixtureServers());
  assert.equal(result.totalRanked, 4);
  assert.deepEqual(
    result.servers.map((s) => s.serverId),
    ['abb-pvp', 'island-pvp', 'scorched-pve', 'island-pve']
  );
  assert.ok(!result.servers.some((s) => s.serverId === 'new-pve'));
  assert.equal(FULL_CONFIDENCE, 10);
});

test('renderLeaderboardsIndex has unique title/meta and a card per suite page plus Rankings', () => {
  const html = renderLeaderboardsIndex({ rosterAvailable: true });
  assert.match(html, /<title>ArkHelper \u2014 Leaderboards<\/title>/);
  assert.match(html, /<meta name="description" content="ARK: Survival Ascended leaderboards/);
  assert.match(html, /href="\/rankings"/);
  assert.match(html, /href="\/leaderboards\/map-uptime"/);
  assert.match(html, /href="\/leaderboards\/pve-vs-pvp"/);
  assert.match(html, /href="\/leaderboards\/top-100"/);
  assert.match(html, /href="\/leaderboards\/bottom-100"/);
  assert.match(html, /class="wordmark" href="\/"/);
});

test('renderMapUptimePage renders fixture aggregates and a unique title', () => {
  const html = renderMapUptimePage({ rosterAvailable: true, maps: computeMapUptime(fixtureServers()) });
  assert.match(html, /<title>ARK Map Uptime Leaderboard/);
  assert.match(html, /TheIsland_WP/);
  assert.match(html, /94\.5%/);
  assert.match(html, /40%/);
  assert.match(html, /Astraeos_WP/);
  assert.match(html, /100%/);
});

test('renderMapUptimePage shows the roster-unavailable fallback', () => {
  const html = renderMapUptimePage({ rosterAvailable: false });
  assert.match(html, /discovery service may not be running/);
});

test('renderPveVsPvpPage renders both columns, deltas, and a unique title', () => {
  const html = renderPveVsPvpPage({ rosterAvailable: true, comparison: computePveVsPvp(fixtureServers()) });
  assert.match(html, /<title>ARK PvE vs PvP/);
  assert.match(html, /<h2>PvE<\/h2>/);
  assert.match(html, /<h2>PvP<\/h2>/);
  assert.match(html, /66\.7%/);
  assert.match(html, /98%/);
  assert.match(html, />\+1</);
  assert.match(html, /-13/);
  assert.match(html, /TheIsland_WP/);
  assert.match(html, /Aberration_WP/);
});

test('renderTop100Page reuses rankings content with a suite title and path', () => {
  const html = renderTop100Page({
    rosterAvailable: true,
    ranking: {
      totalRanked: 1,
      servers: [{ rank: 1, serverId: 'island-pve', name: 'EU-PVE-TheIsland5313', rankScore: 90, components: { reliability: 40, connection: 25, activity: 15, confidence: 10 } }],
    },
  });
  assert.match(html, /<title>ARK Top 100 Servers/);
  assert.match(html, /EU-PVE-TheIsland5313/);
  assert.match(html, /How the score is built/);
});

test('renderBottom100Page notes the confidence exclusion', () => {
  const ranking = bottomFromRoster(fixtureServers());
  const html = renderBottom100Page({ rosterAvailable: true, ranking });
  assert.match(html, /<title>ARK Bottom 100 Servers/);
  assert.match(html, /full week of history/);
  assert.match(html, /Asia-PVP-Aberration1/);
  assert.doesNotMatch(html, /EU-PVE-New1/);
  assert.match(html, /lowest 4 of 4/);
});

test('renderMapUptimePage escapes a hostile map name', () => {
  const html = renderMapUptimePage({
    rosterAvailable: true,
    maps: [{ map: '<script>evil()</script>', serverCount: 1, avgUptimePercent: 1, avgPopulationPercent: 1 }],
  });
  assert.doesNotMatch(html, /<script>evil\(\)<\/script>/);
});
