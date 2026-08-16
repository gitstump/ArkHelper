'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveMap } = require('./maps.js');
const {
  serversForMap,
  computeMapTelemetry,
  computeMapBreakdown,
  computeVersionCounts,
  leadingServers,
  unavailableServers,
  computeMapIndex,
  renderMapIndexPage,
  renderMapPage,
  renderMapNotFoundPage,
} = require('./maps_page.js');

function fixtureServers() {
  return [
    {
      id: 'island-pve',
      name: 'EU-PVE-TheIsland5313',
      map: 'TheIsland_WP',
      gameMode: 'pve',
      playersNow: 10,
      maxPlayers: 70,
      version: '92.41',
      uptimePercent: 99,
      rankScore: 90,
      rank: 1,
      platformType: 'PC+XSX+WINGDK+PS5',
    },
    {
      id: 'island-pvp',
      name: 'NA-PVP-TheIsland12',
      map: 'TheIsland_WP',
      gameMode: 'pvp',
      playersNow: 20,
      maxPlayers: 70,
      version: '92.41',
      uptimePercent: 80,
      rankScore: 70,
      rank: 3,
      platformType: 'PC',
    },
    {
      id: 'island-off',
      name: 'Asia-PVE-TheIsland9',
      map: 'TheIsland_WP',
      gameMode: 'pve',
      playersNow: null,
      maxPlayers: 70,
      version: '92.40',
      uptimePercent: 50,
      rankScore: 20,
      rank: 8,
      platformType: 'XSX+PS5',
    },
    {
      id: 'genesis-pvp',
      name: 'EU-PVP-Genesis99',
      map: 'Genesis_WP',
      gameMode: 'pvp',
      playersNow: 40,
      maxPlayers: 70,
      version: '93.0',
      uptimePercent: 100,
      rankScore: 95,
      rank: 2,
      platformType: 'PC+PS5+XSX',
    },
    {
      id: 'ab-pve',
      name: 'NA-PVE-Aberration1',
      map: 'Aberration_WP',
      gameMode: 'pve',
      playersNow: 5,
      maxPlayers: 70,
      version: '92.41',
      uptimePercent: 90,
      rankScore: 40,
      rank: 5,
      platformType: 'PC',
    },
  ];
}

test('serversForMap keeps only the requested map id', () => {
  const island = serversForMap(fixtureServers(), 'TheIsland_WP');
  assert.equal(island.length, 3);
  assert.ok(island.every((s) => s.map === 'TheIsland_WP'));
  assert.equal(serversForMap(fixtureServers(), 'Genesis_WP').length, 1);
  assert.deepEqual(serversForMap(null, 'TheIsland_WP'), []);
});

test('computeMapTelemetry aggregates players, online ratio, free slots, and avg uptime', () => {
  const t = computeMapTelemetry(serversForMap(fixtureServers(), 'TheIsland_WP'));
  assert.equal(t.playersOnline, 30);
  assert.equal(t.onlineCount, 2);
  assert.equal(t.totalCount, 3);
  assert.equal(t.freeSlots, (70 - 10) + (70 - 20));
  assert.equal(t.avgUptimePercent, 76.3);
});

test('computeMapBreakdown counts PvE/PvP and platform badges', () => {
  const b = computeMapBreakdown(serversForMap(fixtureServers(), 'TheIsland_WP'));
  assert.equal(b.pve, 2);
  assert.equal(b.pvp, 1);
  assert.equal(b.platforms['PC+Console'], 1);
  assert.equal(b.platforms.PC, 1);
  assert.equal(b.platforms.Console, 1);
});

test('computeVersionCounts groups version strings by server count', () => {
  const versions = computeVersionCounts(serversForMap(fixtureServers(), 'TheIsland_WP'));
  assert.deepEqual(versions, [
    { version: '92.41', serverCount: 2 },
    { version: '92.40', serverCount: 1 },
  ]);
});

test('leadingServers returns top rankScore rows and unavailableServers lists offline ones', () => {
  const island = serversForMap(fixtureServers(), 'TheIsland_WP');
  const leading = leadingServers(island);
  assert.deepEqual(leading.map((s) => s.id), ['island-pve', 'island-pvp', 'island-off']);
  const offline = unavailableServers(island);
  assert.deepEqual(offline.map((s) => s.id), ['island-off']);
  assert.equal(unavailableServers(island, 0).length, 0);
});

test('computeMapIndex is sorted by server count desc and uses registry names', () => {
  const index = computeMapIndex(fixtureServers());
  assert.deepEqual(
    index.map((m) => m.id),
    ['TheIsland_WP', 'Aberration_WP', 'Genesis_WP']
  );
  assert.equal(index[0].displayName, 'The Island');
  assert.equal(index[0].slug, 'the-island');
  assert.equal(index[0].serverCount, 3);
  assert.equal(index[0].playersOnline, 30);
  assert.equal(index[0].avgUptimePercent, 76.3);
  assert.equal(index[1].serverCount, 1);
  assert.equal(index[2].displayName, 'Genesis');
});

test('computeMapIndex includes an unrecognized map with a generated slug and raw name', () => {
  const index = computeMapIndex([{ id: 'x', map: 'BrandNewMap_WP', playersNow: 1, uptimePercent: 100 }]);
  assert.equal(index.length, 1);
  assert.equal(index[0].known, false);
  assert.equal(index[0].displayName, 'BrandNewMap_WP');
  assert.equal(index[0].slug, 'brand-new-map');
});

test('renderMapIndexPage lists cards in server-count order with SEO title', () => {
  const html = renderMapIndexPage({ rosterAvailable: true, maps: computeMapIndex(fixtureServers()) });
  assert.match(html, /<title>ARK Maps/);
  assert.match(html, /meta name="description"/);
  const section = html.match(/<ul class="map-index">[\s\S]*?<\/ul>/)[0];
  const islandAt = section.indexOf('The Island');
  const aberAt = section.indexOf('Aberration');
  const genAt = section.indexOf('Genesis');
  assert.ok(islandAt !== -1 && aberAt !== -1 && genAt !== -1);
  assert.ok(islandAt < aberAt && aberAt < genAt);
  assert.match(section, /href="\/maps\/the-island"/);
});

test('renderMapIndexPage degrades when the roster is unavailable', () => {
  const html = renderMapIndexPage({ rosterAvailable: false });
  assert.match(html, /isn't available right now/);
  assert.doesNotMatch(html, /class="map-index"/);
});

test('renderMapPage filters to one map and never includes a Genesis server on The Island', () => {
  const island = serversForMap(fixtureServers(), 'TheIsland_WP');
  const html = renderMapPage({
    rosterAvailable: true,
    map: resolveMap('TheIsland_WP'),
    servers: island,
    telemetry: computeMapTelemetry(island),
    breakdown: computeMapBreakdown(island),
    versions: computeVersionCounts(island),
    leading: leadingServers(island),
    unavailable: unavailableServers(island),
  });
  assert.match(html, /<title>ARK The Island Servers/);
  assert.match(html, /starter landmass/);
  assert.match(html, /EU-PVE-TheIsland5313/);
  assert.match(html, /NA-PVP-TheIsland12/);
  assert.match(html, /Asia-PVE-TheIsland9/);
  assert.doesNotMatch(html, /EU-PVP-Genesis99/);
  assert.doesNotMatch(html, /NA-PVE-Aberration1/);
  assert.match(html, /href="\/servers\?map=TheIsland_WP"/);
  assert.match(html, /Browse all The Island servers/);
  assert.match(html, /30/);
  assert.match(html, /2 \/ 3/);
  assert.match(html, /92\.41/);
});

test('renderMapPage does not 500 on an unrecognized map id', () => {
  const servers = [{ id: 'n1', name: 'NA-PVE-New1', map: 'BrandNewMap_WP', gameMode: 'pve', playersNow: 3, maxPlayers: 70, version: '1.0', rankScore: 11 }];
  const html = renderMapPage({
    rosterAvailable: true,
    map: resolveMap('BrandNewMap_WP'),
    servers,
    telemetry: computeMapTelemetry(servers),
    breakdown: computeMapBreakdown(servers),
    versions: computeVersionCounts(servers),
    leading: leadingServers(servers),
    unavailable: unavailableServers(servers),
  });
  assert.match(html, /<h1>BrandNewMap_WP<\/h1>/);
  assert.match(html, /NA-PVE-New1/);
  assert.match(html, /href="\/servers\?map=BrandNewMap_WP"/);
  assert.match(html, /listed on the Wildcard roster/);
});

test('renderMapNotFoundPage is a shell-wrapped 404 body', () => {
  const html = renderMapNotFoundPage({ slug: 'not-real' });
  assert.match(html, /Map not found/);
  assert.match(html, /not-real/);
  assert.match(html, /href="\/maps"/);
});
