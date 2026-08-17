'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LIST_DEFS,
  getListDef,
  attachWipes,
  applyList,
  browserQueryString,
  renderListPage,
} = require('./server_lists.js');

function fixtureServers() {
  return [
    {
      id: 'pve-a',
      name: 'EU-PVE-TheIsland5313',
      map: 'TheIsland_WP',
      gameMode: 'pve',
      playersNow: 5,
      maxPlayers: 70,
      day: 100,
      rankScore: 80,
      wildcardReportedPing: 180,
      uptimePercent: 88.8,
      platformType: 'PC+XSX+WINGDK+PS5',
    },
    {
      id: 'pvp-a',
      name: 'Asia-PVP-LostColony2859',
      map: 'LostColony_WP',
      gameMode: 'pvp',
      playersNow: 20,
      maxPlayers: 70,
      day: 50,
      rankScore: 40,
      wildcardReportedPing: 40,
      platformType: 'PC+PS5+XSX',
    },
    {
      id: 'pvp-full',
      name: 'NA-PVP-Astraeos2573',
      map: 'Astraeos_WP',
      gameMode: 'pvp',
      playersNow: 70,
      maxPlayers: 70,
      day: 10,
      rankScore: 90,
      wildcardReportedPing: 12,
      platformType: 'XSX+PS5',
    },
    {
      id: 'pve-empty',
      name: 'NA-PVE-ClubARK283',
      map: 'BobsMissions_WP',
      gameMode: 'pve',
      playersNow: 0,
      maxPlayers: 70,
      day: 1,
      rankScore: 20,
      wildcardReportedPing: null,
      platformType: 'PC+PS5+XSX+WINGDK',
    },
    {
      id: 'offline',
      name: 'EU-PVP-Offline1',
      map: 'TheIsland_WP',
      gameMode: 'pvp',
      playersNow: null,
      maxPlayers: 70,
      day: 8,
      rankScore: 10,
      wildcardReportedPing: 5,
      platformType: 'PC+PS5+XSX',
    },
  ];
}

test('getListDef returns each of the six canonical lists and null for unknown slugs', () => {
  assert.equal(getListDef('official-pve').path, '/lists/official-pve');
  assert.equal(getListDef('official-pvp').path, '/lists/official-pvp');
  assert.equal(getListDef('low-ping').path, '/lists/low-ping');
  assert.equal(getListDef('most-populated').path, '/lists/most-populated');
  assert.equal(getListDef('recently-wiped').path, '/lists/recently-wiped');
  assert.equal(getListDef('available-now').path, '/lists/available-now');
  assert.equal(getListDef('nope'), null);
  assert.equal(Object.keys(LIST_DEFS).length, 6);
});

test('official-pve never includes a PvP server', () => {
  const view = applyList(fixtureServers(), LIST_DEFS['official-pve']);
  assert.ok(view.sorted.every((s) => s.gameMode === 'pve'));
  assert.ok(view.sorted.some((s) => s.id === 'pve-a'));
  assert.ok(!view.sorted.some((s) => s.gameMode === 'pvp'));
});

test('official-pvp never includes a PvE server and sorts by rank descending', () => {
  const view = applyList(fixtureServers(), LIST_DEFS['official-pvp']);
  assert.ok(view.sorted.every((s) => s.gameMode === 'pvp'));
  assert.deepEqual(
    view.sorted.map((s) => s.id),
    ['pvp-full', 'pvp-a', 'offline']
  );
});

test('low-ping keeps online servers with a ping, lowest first, and drops missing ping', () => {
  const view = applyList(fixtureServers(), LIST_DEFS['low-ping']);
  assert.deepEqual(
    view.sorted.map((s) => s.id),
    ['pvp-full', 'pvp-a', 'pve-a']
  );
});

test('most-populated is online only, players descending', () => {
  const view = applyList(fixtureServers(), LIST_DEFS['most-populated']);
  assert.deepEqual(
    view.sorted.map((s) => s.id),
    ['pvp-full', 'pvp-a', 'pve-a', 'pve-empty']
  );
});

test('available-now excludes a full server and sorts by free slots descending', () => {
  const view = applyList(fixtureServers(), LIST_DEFS['available-now']);
  assert.ok(!view.sorted.some((s) => s.id === 'pvp-full'));
  assert.ok(!view.sorted.some((s) => s.id === 'offline'));
  assert.deepEqual(
    view.sorted.map((s) => s.id),
    ['pve-empty', 'pve-a', 'pvp-a']
  );
});

test('recently-wiped keeps a wipe inside the 14-day window and drops one outside it', () => {
  const now = () => Date.parse('2026-08-16T12:00:00.000Z');
  const servers = attachWipes(fixtureServers(), [
    { serverId: 'pve-a', seenAt: '2026-08-10T00:00:00.000Z' },
    { serverId: 'pvp-a', seenAt: '2026-07-01T00:00:00.000Z' },
  ]);
  const view = applyList(servers, LIST_DEFS['recently-wiped'], {}, { now });
  assert.deepEqual(
    view.sorted.map((s) => s.id),
    ['pve-a']
  );
});

test('applyList pagination stays on the filtered set', () => {
  const view = applyList(fixtureServers(), LIST_DEFS['official-pve'], {}, { page: 1, pageSize: 1 });
  assert.equal(view.page.items.length, 1);
  assert.equal(view.page.totalCount, 2);
  assert.equal(view.page.totalPages, 2);
  const page2 = applyList(fixtureServers(), LIST_DEFS['official-pve'], {}, { page: 2, pageSize: 1 });
  assert.equal(page2.page.page, 2);
  assert.notEqual(page2.page.items[0].id, view.page.items[0].id);
});

test('derived lists inherit extra filters such as platform', () => {
  const view = applyList(fixtureServers(), LIST_DEFS['official-pvp'], { platform: 'Console' });
  assert.deepEqual(
    view.sorted.map((s) => s.id),
    ['pvp-full']
  );
});

test('renderListPage uses a unique title, meta description, count, rows, and a browser back-link', () => {
  const view = applyList(fixtureServers(), LIST_DEFS['official-pve']);
  const html = renderListPage({
    list: LIST_DEFS['official-pve'],
    page: view.page,
    filters: view.filters,
    sort: view.sort,
    dir: view.dir,
    counters: { totalOfficial: 5, playersOnline: 95, avgPing: 50, pveCount: 2, pvpCount: 3 },
    mapOptions: ['TheIsland_WP'],
    platformOptions: ['PC+Console', 'Console'],
    rosterAvailable: true,
  });
  assert.match(html, /<title>ARK Official PvE Servers/);
  assert.match(html, /<meta name="description" content="Browse official ARK: Survival Ascended PvE servers/);
  assert.match(html, /<h1>Official PvE servers<\/h1>/);
  assert.match(html, /<p class="counters">Showing 5 official servers/);
  assert.doesNotMatch(html, /matching servers\./);
  assert.match(html, /EU-PVE-TheIsland5313/);
  assert.match(html, /88\.8%/);
  assert.doesNotMatch(html, /Asia-PVP-LostColony2859/);
  assert.match(html, /href="\/servers\?gameMode=pve&amp;sort=rank&amp;dir=desc"/);
  assert.match(html, /action="\/lists\/official-pve"/);
  assert.match(html, /View these filters in the full server browser/);
});

test('renderListPage available-now labels slots as observed, not reserved', () => {
  const view = applyList(fixtureServers(), LIST_DEFS['available-now']);
  const html = renderListPage({
    list: LIST_DEFS['available-now'],
    page: view.page,
    filters: view.filters,
    sort: view.sort,
    dir: view.dir,
    counters: { totalOfficial: 5, playersOnline: 95, avgPing: 50, pveCount: 2, pvpCount: 3 },
    mapOptions: [],
    platformOptions: [],
    rosterAvailable: true,
  });
  assert.match(html, /observed/);
  assert.match(html, /not reserved/);
  assert.doesNotMatch(html, /NA-PVP-Astraeos2573/);
});

test('renderListPage recently-wiped shows detected date and day counter', () => {
  const now = () => Date.parse('2026-08-16T12:00:00.000Z');
  const servers = attachWipes(fixtureServers(), [{ serverId: 'pve-a', seenAt: '2026-08-10T00:00:00.000Z' }]);
  const view = applyList(servers, LIST_DEFS['recently-wiped'], {}, { now });
  const html = renderListPage({
    list: LIST_DEFS['recently-wiped'],
    page: view.page,
    filters: view.filters,
    sort: view.sort,
    dir: view.dir,
    counters: { totalOfficial: 5, playersOnline: 95, avgPing: 50, pveCount: 2, pvpCount: 3 },
    mapOptions: [],
    platformOptions: [],
    rosterAvailable: true,
  });
  assert.match(html, /Wiped 2026-08-10/);
  assert.match(html, /Day 100/);
});

test('renderListPage paginates with list-path links', () => {
  const view = applyList(fixtureServers(), LIST_DEFS['official-pve'], {}, { page: 1, pageSize: 1 });
  const html = renderListPage({
    list: LIST_DEFS['official-pve'],
    page: view.page,
    filters: view.filters,
    sort: view.sort,
    dir: view.dir,
    counters: { totalOfficial: 5, playersOnline: 95, avgPing: 50, pveCount: 2, pvpCount: 3 },
    mapOptions: [],
    platformOptions: [],
    rosterAvailable: true,
  });
  assert.match(html, /href="\/lists\/official-pve\?/);
  assert.match(html, /Page 1 of 2/);
  assert.match(html, /Next &raquo;/);
});

test('browserQueryString for low-ping includes the equivalent /servers filters', () => {
  const q = browserQueryString(LIST_DEFS['low-ping']);
  assert.match(q, /online=true/);
  assert.match(q, /hasPing=true/);
  assert.match(q, /sort=ping/);
  assert.match(q, /dir=asc/);
});
