'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  filterServers,
  sortServers,
  paginateServers,
  computeLiveCounters,
  getDistinctMaps,
  getDistinctPlatforms,
  platformBadge,
  getDistinctCountries,
  filtersFromSearchParams,
  renderBrowserPage,
  renderHeroBand,
  renderServerRow,
} = require('./server_browser.js');

function makeServers() {
  return [
    { id: '1', name: 'EU-PVE-TheIsland5313', map: 'TheIsland_WP', gameMode: 'pve', playersNow: 5, maxPlayers: 70, day: 100, clusterId: 'PVECrossplay', hasPassword: false, platformType: 'PC+XSX+WINGDK+PS5', wildcardReportedPing: 180 },
    { id: '2', name: 'Asia-PVP-LostColony2859', map: 'LostColony_WP', gameMode: 'pvp', playersNow: 20, maxPlayers: 70, day: 50, clusterId: 'PVPCrossplay', hasPassword: false, platformType: 'PC+PS5+XSX', wildcardReportedPing: 252 },
    { id: '3', name: 'NA-PVE-ClubARK283', map: 'BobsMissions_WP', gameMode: 'pve', playersNow: 0, maxPlayers: 70, day: 1, clusterId: 'PVECrossplay', hasPassword: true, platformType: 'PC+PS5+XSX+WINGDK', wildcardReportedPing: null },
    { id: '4', name: 'NA-PVP-Astraeos2573', map: 'Astraeos_WP', gameMode: 'pvp', playersNow: 38, maxPlayers: 70, day: 2567, clusterId: 'PVPCrossplay', hasPassword: false, platformType: 'PC+PS5+XSX', wildcardReportedPing: 346 },
  ];
}

// ---------------------------------------------------------------------
// filterServers
// ---------------------------------------------------------------------
test('filterServers with no filters returns everything', () => {
  assert.equal(filterServers(makeServers(), {}).length, 4);
});

test('filterServers search matches name case-insensitively', () => {
  const result = filterServers(makeServers(), { search: 'astraeos' });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, '4');
});

test('filterServers filters by exact map', () => {
  const result = filterServers(makeServers(), { map: 'TheIsland_WP' });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, '1');
});

test('filterServers filters by gameMode', () => {
  assert.equal(filterServers(makeServers(), { gameMode: 'pve' }).length, 2);
  assert.equal(filterServers(makeServers(), { gameMode: 'pvp' }).length, 2);
});

test('filterServers filters by platform substring, case-insensitive', () => {
  const result = filterServers(makeServers(), { platform: 'wingdk' });
  assert.equal(result.length, 2); // servers 1 and 3 have WINGDK in their platform string
});

test('filterServers filters by hasPassword true/false', () => {
  assert.equal(filterServers(makeServers(), { hasPassword: 'true' }).length, 1);
  assert.equal(filterServers(makeServers(), { hasPassword: 'false' }).length, 3);
});

test('filterServers filters by minPlayers and maxPlayers range', () => {
  assert.equal(filterServers(makeServers(), { minPlayers: '10' }).length, 2); // servers 2 and 4
  assert.equal(filterServers(makeServers(), { maxPlayers: '10' }).length, 2); // servers 1 and 3
  assert.equal(filterServers(makeServers(), { minPlayers: '1', maxPlayers: '25' }).length, 2); // 1 and 2
});

test('filterServers filters by clusterId', () => {
  assert.equal(filterServers(makeServers(), { clusterId: 'PVPCrossplay' }).length, 2);
});

test('filterServers minPing/maxPing use wildcardReportedPing, else ping fallback', () => {
  const servers = [
    { id: 'wc', wildcardReportedPing: 50, ping: 999 },
    { id: 'fb', ping: 80 },
    { id: 'hi', wildcardReportedPing: 200 },
  ];
  assert.deepEqual(filterServers(servers, { minPing: '40', maxPing: '100' }).map((s) => s.id), ['wc', 'fb']);
  assert.deepEqual(filterServers(servers, { minPing: '60' }).map((s) => s.id), ['fb', 'hi']);
  assert.deepEqual(filterServers(servers, { maxPing: '50' }).map((s) => s.id), ['wc']);
});

test('filterServers excludes null effective ping when a ping bound is set', () => {
  const servers = [
    { id: 'has', wildcardReportedPing: 50 },
    { id: 'none' },
    { id: 'nullPing', wildcardReportedPing: null, ping: null },
  ];
  assert.deepEqual(filterServers(servers, { minPing: '0' }).map((s) => s.id), ['has']);
  assert.deepEqual(filterServers(servers, { maxPing: '1000' }).map((s) => s.id), ['has']);
  assert.deepEqual(filterServers(servers, {}).map((s) => s.id), ['has', 'none', 'nullPing']);
});

test('filterServers minUptime excludes missing or below-bound uptime', () => {
  const servers = [
    { id: 'ok', uptimePercent: 99 },
    { id: 'low', uptimePercent: 50 },
    { id: 'none' },
  ];
  assert.deepEqual(filterServers(servers, { minUptime: '90' }).map((s) => s.id), ['ok']);
});

test('filterServers treats non-numeric and negative ping/uptime bounds as unset', () => {
  const servers = [
    { id: 'a', wildcardReportedPing: 10, uptimePercent: 10 },
    { id: 'b' },
  ];
  assert.equal(filterServers(servers, { minPing: 'nope', maxPing: '-1', minUptime: 'abc' }).length, 2);
  assert.equal(filterServers(servers, { minPing: '-5', maxPing: 'NaN', minUptime: '-1' }).length, 2);
});

function transferFixtureServers() {
  return [
    { id: 'both', name: 'Both On', map: 'TheIsland_WP', gameMode: 'pve', allowCharTransfers: true, allowItemTransfers: true },
    { id: 'chars', name: 'Chars Only', map: 'TheIsland_WP', gameMode: 'pvp', allowCharTransfers: true, allowItemTransfers: false },
    { id: 'items', name: 'Items Only', map: 'Extinction_WP', gameMode: 'pve', allowCharTransfers: false, allowItemTransfers: true },
    { id: 'none', name: 'Both Off', map: 'Extinction_WP', gameMode: 'pvp', allowCharTransfers: false, allowItemTransfers: false },
    { id: 'unknown', name: 'Unknown Flags', map: 'TheIsland_WP', gameMode: 'pve' },
    { id: 'partial', name: 'Partial Flags', map: 'TheIsland_WP', gameMode: 'pvp', allowCharTransfers: true },
  ];
}

test('filterServers transfers=both matches only servers with both flags true', () => {
  assert.deepEqual(filterServers(transferFixtureServers(), { transfers: 'both' }).map((s) => s.id), ['both']);
});

test('filterServers transfers=chars matches servers with character transfers true', () => {
  assert.deepEqual(filterServers(transferFixtureServers(), { transfers: 'chars' }).map((s) => s.id), ['both', 'chars', 'partial']);
});

test('filterServers transfers=items matches servers with item transfers true', () => {
  assert.deepEqual(filterServers(transferFixtureServers(), { transfers: 'items' }).map((s) => s.id), ['both', 'items']);
});

test('filterServers transfers=none matches only servers with both flags false', () => {
  assert.deepEqual(filterServers(transferFixtureServers(), { transfers: 'none' }).map((s) => s.id), ['none']);
});

test('filterServers unknown-flag servers appear only under Transfers Any', () => {
  const servers = transferFixtureServers();
  assert.deepEqual(filterServers(servers, {}).map((s) => s.id), ['both', 'chars', 'items', 'none', 'unknown', 'partial']);
  assert.deepEqual(filterServers(servers, { transfers: '' }).map((s) => s.id), ['both', 'chars', 'items', 'none', 'unknown', 'partial']);
  for (const value of ['both', 'chars', 'items', 'none']) {
    assert.ok(!filterServers(servers, { transfers: value }).some((s) => s.id === 'unknown'));
  }
});

test('filterServers transfers composes with gameMode', () => {
  assert.deepEqual(
    filterServers(transferFixtureServers(), { transfers: 'chars', gameMode: 'pve' }).map((s) => s.id),
    ['both']
  );
});

test('filterServers treats an unrecognized transfers value as Any', () => {
  assert.equal(filterServers(transferFixtureServers(), { transfers: 'maybe' }).length, 6);
});

test('filterServers combines multiple filters with AND logic', () => {
  const result = filterServers(makeServers(), { gameMode: 'pvp', minPlayers: '30' });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, '4');
});

test('filterServers does not mutate the input array', () => {
  const servers = makeServers();
  const original = JSON.stringify(servers);
  filterServers(servers, { gameMode: 'pve' });
  assert.equal(JSON.stringify(servers), original);
});

// ---------------------------------------------------------------------
// sortServers
// ---------------------------------------------------------------------
test('sortServers by players descending (the default)', () => {
  const result = sortServers(makeServers());
  assert.deepEqual(result.map((s) => s.id), ['4', '2', '1', '3']);
});

test('sortServers by players ascending', () => {
  const result = sortServers(makeServers(), 'players', 'asc');
  assert.deepEqual(result.map((s) => s.id), ['3', '1', '2', '4']);
});

test('sortServers by name alphabetically', () => {
  const result = sortServers(makeServers(), 'name', 'asc');
  assert.deepEqual(
    result.map((s) => s.name),
    ['Asia-PVP-LostColony2859', 'EU-PVE-TheIsland5313', 'NA-PVE-ClubARK283', 'NA-PVP-Astraeos2573']
  );
});

test('sortServers by day', () => {
  const result = sortServers(makeServers(), 'day', 'desc');
  assert.deepEqual(result.map((s) => s.id), ['4', '1', '2', '3']);
});

test('sortServers puts nulls last regardless of direction', () => {
  const withNull = [{ id: 'a', playersNow: null }, { id: 'b', playersNow: 5 }, { id: 'c', playersNow: 10 }];
  const desc = sortServers(withNull, 'players', 'desc');
  assert.equal(desc[desc.length - 1].id, 'a');
  const asc = sortServers(withNull, 'players', 'asc');
  assert.equal(asc[asc.length - 1].id, 'a');
});

test('sortServers does not mutate the input array', () => {
  const servers = makeServers();
  const originalOrder = servers.map((s) => s.id);
  sortServers(servers, 'name', 'asc');
  assert.deepEqual(servers.map((s) => s.id), originalOrder);
});

test('sortServers by rankScore descending (best rank first)', () => {
  const servers = [
    { id: '1', rankScore: 40 },
    { id: '2', rankScore: 90 },
    { id: '3', rankScore: 70 },
    { id: '4', rankScore: null },
  ];
  const result = sortServers(servers, 'rank', 'desc');
  assert.deepEqual(result.map((s) => s.id), ['2', '3', '1', '4']);
});

test('sortServers falls back to the default sort key for an unknown key', () => {
  const result = sortServers(makeServers(), 'nonsense', 'desc');
  assert.deepEqual(result.map((s) => s.id), ['4', '2', '1', '3']); // same as default players-desc
});

// ---------------------------------------------------------------------
// paginateServers
// ---------------------------------------------------------------------
test('paginateServers slices correctly with a small page size', () => {
  const result = paginateServers(makeServers(), 1, 2);
  assert.equal(result.items.length, 2);
  assert.equal(result.totalPages, 2);
  assert.equal(result.totalCount, 4);
  assert.equal(result.page, 1);
});

test('paginateServers returns the second page correctly', () => {
  const result = paginateServers(makeServers(), 2, 2);
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.items.map((s) => s.id), ['3', '4']);
});

test('paginateServers clamps a page below 1 up to 1', () => {
  assert.equal(paginateServers(makeServers(), 0, 2).page, 1);
  assert.equal(paginateServers(makeServers(), -5, 2).page, 1);
});

test('paginateServers clamps a page beyond the max down to the last page', () => {
  const result = paginateServers(makeServers(), 999, 2);
  assert.equal(result.page, 2);
});

test('paginateServers handles an empty list without dividing by zero', () => {
  const result = paginateServers([], 1, 25);
  assert.equal(result.totalPages, 1);
  assert.equal(result.items.length, 0);
});

test('paginateServers handles a non-numeric page gracefully', () => {
  const result = paginateServers(makeServers(), 'not-a-number', 2);
  assert.equal(result.page, 1);
});

// ---------------------------------------------------------------------
// computeLiveCounters
// ---------------------------------------------------------------------
test('computeLiveCounters sums players and counts modes correctly', () => {
  const counters = computeLiveCounters(makeServers());
  assert.equal(counters.totalOfficial, 4);
  assert.equal(counters.playersOnline, 5 + 20 + 0 + 38);
  assert.equal(counters.pveCount, 2);
  assert.equal(counters.pvpCount, 2);
});

test('computeLiveCounters averages ping over non-null values only', () => {
  const counters = computeLiveCounters(makeServers());
  // pings: 180, 252, null(excluded), 346 -> avg of [180,252,346]
  assert.equal(counters.avgPing, Math.round((180 + 252 + 346) / 3));
});

test('computeLiveCounters handles an empty roster without crashing', () => {
  const counters = computeLiveCounters([]);
  assert.equal(counters.totalOfficial, 0);
  assert.equal(counters.playersOnline, 0);
  assert.equal(counters.avgPing, null);
});

// ---------------------------------------------------------------------
// getDistinctMaps
// ---------------------------------------------------------------------
test('getDistinctMaps returns sorted unique map names', () => {
  const maps = getDistinctMaps(makeServers());
  assert.deepEqual(maps, ['Astraeos_WP', 'BobsMissions_WP', 'LostColony_WP', 'TheIsland_WP']);
});

test('getDistinctMaps ignores servers with no map set', () => {
  const maps = getDistinctMaps([{ map: 'A' }, { map: null }, { map: 'A' }]);
  assert.deepEqual(maps, ['A']);
});

// ---------------------------------------------------------------------
// renderBrowserPage
// ---------------------------------------------------------------------
test('renderBrowserPage shows a fallback when the roster is unavailable', () => {
  const html = renderBrowserPage({ rosterAvailable: false });
  assert.match(html, /discovery service may not be running/);
});

test('renderBrowserPage renders rows for the given page of results', () => {
  const servers = makeServers();
  const paged = paginateServers(sortServers(servers), 1, 25);
  const html = renderBrowserPage({
    page: paged,
    filters: {},
    sort: 'players',
    dir: 'desc',
    counters: computeLiveCounters(servers),
    mapOptions: getDistinctMaps(servers),
    rosterAvailable: true,
  });
  assert.match(html, /Astraeos_WP/);
  assert.match(html, /LostColony_WP/);
  assert.match(html, /Page 1 of 1/);
  assert.match(html, /<p class="counters">Showing 4 official servers &middot; 63 players on them &middot; 259ms avg ping &middot; 2 PvE \/ 2 PvP<\/p>/);
});

test('renderBrowserPage summary is one Showing line with grouped result-set counts', () => {
  const servers = makeServers();
  const html = renderBrowserPage({
    page: paginateServers(sortServers(servers), 1, 25),
    filters: {},
    sort: 'players',
    dir: 'desc',
    counters: { totalOfficial: 3073, playersOnline: 18549, avgPing: 197, pveCount: 1380, pvpCount: 1693 },
    mapOptions: getDistinctMaps(servers),
    rosterAvailable: true,
  });
  assert.match(
    html,
    /<p class="counters">Showing 3,073 official servers &middot; 18,549 players on them &middot; 197ms avg ping &middot; 1,380 PvE \/ 1,693 PvP<\/p>/
  );
  assert.equal((html.match(/<p class="counters">/g) || []).length, 1);
  assert.doesNotMatch(html, /matching servers\./);
  assert.doesNotMatch(html, /players online/);
});

test('renderHeroBand tracking line nests PvE/PvP inside the official clause', () => {
  const html = renderHeroBand({
    counters: { totalOfficial: 10, playersOnline: 40 },
    rosterMeta: { totalOfficial: 3073, pveCount: 1380, pvpCount: 1693, generatedAt: '2026-08-16T12:00:00.000Z' },
    unofficialMeta: { count: 56027 },
  });
  assert.match(
    html,
    /Tracking <strong class="num">3,073<\/strong> official \(1,380 PvE \/ 1,693 PvP\) and <strong class="num">56,027<\/strong> listed unofficial servers\. Last updated 2026-08-16T12:00:00\.000Z\./
  );
});

test('renderBrowserPage shows "no servers match" when the filtered page is empty', () => {
  const html = renderBrowserPage({
    page: { items: [], page: 1, totalPages: 1, totalCount: 0 },
    filters: { search: 'nonexistent' },
    sort: 'players',
    dir: 'desc',
    counters: computeLiveCounters([]),
    mapOptions: [],
    rosterAvailable: true,
  });
  assert.match(html, /No servers match these filters/);
});

test('renderBrowserPage escapes a hostile map/cluster value instead of injecting it raw', () => {
  const hostile = [{ id: '1', name: '<img src=x onerror=alert(1)>', map: 'M', gameMode: 'pve', playersNow: 1, maxPlayers: 1, day: 1, clusterId: 'C', hasPassword: false }];
  const paged = paginateServers(hostile, 1, 25);
  const html = renderBrowserPage({
    page: paged,
    filters: {},
    sort: 'players',
    dir: 'desc',
    counters: computeLiveCounters(hostile),
    mapOptions: ['M'],
    rosterAvailable: true,
  });
  assert.doesNotMatch(html, /<img src=x onerror=alert\(1\)>/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('renderBrowserPage includes a Rank sort link', () => {
  const servers = makeServers();
  const paged = paginateServers(sortServers(servers), 1, 25);
  const html = renderBrowserPage({
    page: paged,
    filters: {},
    sort: 'players',
    dir: 'desc',
    counters: computeLiveCounters(servers),
    mapOptions: getDistinctMaps(servers),
    rosterAvailable: true,
  });
  assert.match(html, /sort=rank/);
  assert.match(html, />Rank</);
});

test('renderBrowserPage pre-fills the filter form with the current search value', () => {
  const paged = paginateServers([], 1, 25);
  const html = renderBrowserPage({
    page: paged,
    filters: { search: 'my query' },
    sort: 'players',
    dir: 'desc',
    counters: computeLiveCounters([]),
    mapOptions: [],
    rosterAvailable: true,
  });
  assert.match(html, /value="my query"/);
});

test('renderBrowserPage disables the Prev link on page 1 and Next link on the last page', () => {
  const paged = { items: [{ id: '1', name: 'A' }], page: 1, totalPages: 1, totalCount: 1 };
  const html = renderBrowserPage({
    page: paged,
    filters: {},
    sort: 'players',
    dir: 'desc',
    counters: computeLiveCounters([]),
    mapOptions: [],
    rosterAvailable: true,
  });
  assert.doesNotMatch(html, /href="\/servers\?[^"]*page=0"/);
  assert.match(html, /<span>&laquo; Prev<\/span>/);
  assert.match(html, /<span>Next &raquo;<\/span>/);
});

test('renderBrowserPage shows Save as preset when a filter is active', () => {
  const html = renderBrowserPage({
    page: { items: [], page: 1, totalPages: 1, totalCount: 0 },
    filters: { gameMode: 'pve' },
    sort: 'players',
    dir: 'desc',
    counters: computeLiveCounters([]),
    mapOptions: [],
    rosterAvailable: true,
    currentQuery: 'gameMode=pve',
  });
  assert.match(html, /Save as preset/);
  assert.match(html, /method="POST" action="\/presets"/);
  assert.match(html, /name="query" value="gameMode=pve"/);
});

test('renderBrowserPage hides Save as preset when no filter/sort is active', () => {
  const html = renderBrowserPage({
    page: { items: [], page: 1, totalPages: 1, totalCount: 0 },
    filters: {},
    sort: 'players',
    dir: 'desc',
    counters: computeLiveCounters([]),
    mapOptions: [],
    rosterAvailable: true,
    currentQuery: '',
  });
  assert.doesNotMatch(html, /Save as preset/);
});

test('renderBrowserPage renders saved presets as apply links with a delete form', () => {
  const html = renderBrowserPage({
    page: { items: [], page: 1, totalPages: 1, totalCount: 0 },
    filters: {},
    sort: 'players',
    dir: 'desc',
    counters: computeLiveCounters([]),
    mapOptions: [],
    rosterAvailable: true,
    presets: [{ name: 'PvE', query: 'gameMode=pve' }],
    currentQuery: '',
  });
  assert.match(html, /href="\/servers\?gameMode=pve"/);
  assert.match(html, />PvE</);
  assert.match(html, /method="POST" action="\/presets\/delete"/);
  assert.doesNotMatch(html, /Copy share link/);
});

test('renderBrowserPage shows a copy-share-link URL for logged-in presets', () => {
  const html = renderBrowserPage({
    page: { items: [], page: 1, totalPages: 1, totalCount: 0 },
    filters: {},
    sort: 'players',
    dir: 'desc',
    counters: computeLiveCounters([]),
    mapOptions: [],
    rosterAvailable: true,
    loggedIn: true,
    shareOrigin: 'http://example.test',
    presets: [{ id: 7, name: 'PvE', queryString: 'gameMode=pve', shareToken: 'tok123' }],
  });
  assert.match(html, /value="http:\/\/example\.test\/p\/tok123"/);
  assert.match(html, /name="id" value="7"/);
});

test('renderBrowserPage escapes a hostile preset name', () => {
  const html = renderBrowserPage({
    page: { items: [], page: 1, totalPages: 1, totalCount: 0 },
    filters: {},
    sort: 'players',
    dir: 'desc',
    counters: computeLiveCounters([]),
    mapOptions: [],
    rosterAvailable: true,
    presets: [{ name: '<img src=x onerror=alert(1)>', query: 'gameMode=pve' }],
  });
  assert.doesNotMatch(html, /<img src=x onerror=alert\(1\)>/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('renderHeroBand shows em dashes when incident data is missing', () => {
  const html = renderHeroBand({ counters: null, rosterMeta: null, status: null });
  assert.match(html, /Official Servers Online/);
  assert.match(html, /Players Online/);
  assert.match(html, /Official Uptime % \(24h\)/);
  assert.match(html, /href="\/is-ark-down"/);
  assert.match(html, /\u2014/);
  assert.doesNotMatch(html, /Unofficial Servers Listed/);
  assert.doesNotMatch(html, /official \u00b7 .* unofficial/);
});

test('renderHeroBand links the network status word to /is-ark-down', () => {
  const html = renderHeroBand({
    counters: { totalOfficial: 10, playersOnline: 40 },
    status: { state: 'DEGRADED', onlineCount: 8, offlinePct: 12 },
  });
  assert.match(html, />8</);
  assert.match(html, />40</);
  assert.match(html, /88%/);
  assert.match(html, /href="\/is-ark-down">Degraded</);
});

test('renderServerRow shows players as N / MAX with a capacity bar', () => {
  const html = renderServerRow({
    id: '1',
    name: 'EU-PVE-TheIsland5313',
    map: 'TheIsland_WP',
    playersNow: 5,
    maxPlayers: 70,
    day: 100,
    version: '92.41',
    wildcardReportedPing: 180,
    uptimePercent: 99.2,
    rank: 3,
  });
  assert.match(html, /status-dot online/);
  assert.match(html, /5 \/ 70/);
  assert.match(html, /cap-fill/);
  assert.match(html, /92\.41/);
  assert.match(html, />180</);
  assert.match(html, /99\.2%/);
});

test('renderServerRow with history does not render an em-dash uptime', () => {
  const html = renderServerRow({
    id: 'hist-1',
    name: 'EU-PVE-TheIsland5313',
    map: 'TheIsland_WP',
    playersNow: 12,
    maxPlayers: 70,
    day: 40,
    version: '92.41',
    wildcardReportedPing: 45,
    uptimePercent: 97.5,
    rank: 4,
  });
  const cells = [...html.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
  const uptimeCell = cells[9];
  assert.equal(uptimeCell, '97.5%');
  assert.doesNotMatch(uptimeCell, /\u2014/);
  assert.match(cells[8], /45/);
  assert.match(cells[10], /4/);
});

test('renderBrowserPage shows a friendly message for a known presetError code', () => {
  const html = renderBrowserPage({
    page: { items: [], page: 1, totalPages: 1, totalCount: 0 },
    filters: { gameMode: 'pve' },
    sort: 'players',
    dir: 'desc',
    counters: computeLiveCounters([]),
    mapOptions: [],
    rosterAvailable: true,
    currentQuery: 'gameMode=pve',
    presetError: 'cookie_cap',
  });
  assert.match(html, /limited to 3/);
});

test('platformBadge maps PlatformType tokens to compact PC / Console / PC+Console labels', () => {
  assert.equal(platformBadge('PC+XSX+WINGDK+PS5'), 'PC+Console');
  assert.equal(platformBadge('PC+PS5+XSX'), 'PC+Console');
  assert.equal(platformBadge('XSX+PS5'), 'Console');
  assert.equal(platformBadge('PS5+XSX'), 'Console');
  assert.equal(platformBadge('PC'), 'PC');
  assert.equal(platformBadge('PC+WINGDK'), 'PC');
  assert.equal(platformBadge(null), null);
  assert.equal(platformBadge(''), null);
});

test('getDistinctPlatforms returns compact badges present in the roster, in stable order', () => {
  const badges = getDistinctPlatforms([
    { platformType: 'XSX+PS5' },
    { platformType: 'PC+PS5+XSX' },
    { platformType: 'XSX+PS5' },
    { platformType: null },
  ]);
  assert.deepEqual(badges, ['Console', 'PC+Console']);
});

test('filterServers compact platform filter matches the badge, not a PC substring', () => {
  const servers = [
    { id: 'pc', platformType: 'PC' },
    { id: 'cross', platformType: 'PC+PS5+XSX' },
    { id: 'cons', platformType: 'XSX+PS5' },
  ];
  assert.deepEqual(filterServers(servers, { platform: 'PC' }).map((s) => s.id), ['pc']);
  assert.deepEqual(filterServers(servers, { platform: 'Console' }).map((s) => s.id), ['cons']);
  assert.deepEqual(filterServers(servers, { platform: 'PC+Console' }).map((s) => s.id), ['cross']);
});

test('filterServers online / hasPing / minFreeSlots / notFull', () => {
  const servers = [
    { id: 'a', playersNow: 10, maxPlayers: 70, wildcardReportedPing: 40 },
    { id: 'b', playersNow: 68, maxPlayers: 70, wildcardReportedPing: null },
    { id: 'c', playersNow: 70, maxPlayers: 70, wildcardReportedPing: 20 },
    { id: 'd', playersNow: null, maxPlayers: 70, wildcardReportedPing: 10 },
  ];
  assert.deepEqual(filterServers(servers, { online: 'true' }).map((s) => s.id), ['a', 'b', 'c']);
  assert.deepEqual(filterServers(servers, { hasPing: 'true' }).map((s) => s.id), ['a', 'c', 'd']);
  assert.deepEqual(filterServers(servers, { minFreeSlots: '5', notFull: 'true', online: 'true' }).map((s) => s.id), ['a']);
});

test('filterServers wipedWithinDays keeps wipes inside the window and drops older ones', () => {
  const now = () => Date.parse('2026-08-16T00:00:00.000Z');
  const servers = [
    { id: 'in', wipeDetectedAt: '2026-08-10T00:00:00.000Z' },
    { id: 'out', wipeDetectedAt: '2026-07-01T00:00:00.000Z' },
    { id: 'none' },
  ];
  const result = filterServers(servers, { wipedWithinDays: '14' }, { now });
  assert.deepEqual(result.map((s) => s.id), ['in']);
});

test('sortServers by ping ascending puts missing ping last', () => {
  const servers = [
    { id: 'a', wildcardReportedPing: 180 },
    { id: 'b', wildcardReportedPing: null },
    { id: 'c', wildcardReportedPing: 40 },
  ];
  assert.deepEqual(sortServers(servers, 'ping', 'asc').map((s) => s.id), ['c', 'a', 'b']);
});

test('sortServers by freeSlots descending', () => {
  const servers = [
    { id: 'a', playersNow: 60, maxPlayers: 70 },
    { id: 'b', playersNow: 10, maxPlayers: 70 },
    { id: 'c', playersNow: null, maxPlayers: 70 },
  ];
  assert.deepEqual(sortServers(servers, 'freeSlots', 'desc').map((s) => s.id), ['b', 'a', 'c']);
});

test('renderServerRow shows a compact platform badge', () => {
  const html = renderServerRow({
    id: '1',
    name: 'EU-PVE-TheIsland5313',
    map: 'TheIsland_WP',
    playersNow: 5,
    maxPlayers: 70,
    platformType: 'PC+XSX+WINGDK+PS5',
  });
  assert.match(html, /platform-badge/);
  assert.match(html, /PC\+Console/);
});

test('renderBrowserPage includes the transfers filter with verbatim labels on official and unofficial views', () => {
  const official = renderBrowserPage({
    page: { items: [], page: 1, totalPages: 1, totalCount: 0 },
    filters: { transfers: 'both' },
    sort: 'players',
    dir: 'desc',
    counters: computeLiveCounters([]),
    mapOptions: [],
    rosterAvailable: true,
    currentPath: '/servers',
    source: 'official',
  });
  const unofficial = renderBrowserPage({
    page: { items: [], page: 1, totalPages: 1, totalCount: 0 },
    filters: { transfers: 'none' },
    sort: 'players',
    dir: 'desc',
    counters: computeLiveCounters([]),
    mapOptions: [],
    rosterAvailable: true,
    currentPath: '/servers',
    source: 'unofficial',
  });
  for (const html of [official, unofficial]) {
    assert.match(html, /name="transfers"/);
    assert.match(html, />Transfers: Any</);
    assert.match(html, />Transfers allowed</);
    assert.match(html, />Character transfers allowed</);
    assert.match(html, />Item transfers allowed</);
    assert.match(html, />Transfers disabled</);
  }
  assert.match(official, /<option value="both" selected>Transfers allowed<\/option>/);
  assert.match(unofficial, /<option value="none" selected>Transfers disabled<\/option>/);
});

test('renderBrowserPage includes a Server lists index and a Platform filter', () => {
  const html = renderBrowserPage({
    page: { items: [], page: 1, totalPages: 1, totalCount: 0 },
    filters: {},
    sort: 'players',
    dir: 'desc',
    counters: computeLiveCounters([]),
    mapOptions: [],
    platformOptions: ['PC+Console', 'Console'],
    rosterAvailable: true,
    currentPath: '/servers',
  });
  assert.match(html, /Server lists/);
  assert.match(html, /href="\/lists\/official-pve"/);
  assert.match(html, /href="\/lists\/available-now"/);
  assert.match(html, /name="platform"/);
  assert.match(html, /PC\+Console/);
});

test('renderBrowserPage default source matches source=official byte-for-byte', () => {
  const servers = makeServers();
  const paged = paginateServers(sortServers(servers), 1, 25);
  const opts = {
    page: paged,
    filters: {},
    sort: 'players',
    dir: 'desc',
    counters: computeLiveCounters(servers),
    mapOptions: getDistinctMaps(servers),
    rosterAvailable: true,
    currentPath: '/servers',
  };
  assert.equal(renderBrowserPage(opts), renderBrowserPage({ ...opts, source: 'official' }));
});

test('renderBrowserPage shows an Official/Unofficial toggle', () => {
  const html = renderBrowserPage({
    page: { items: [], page: 1, totalPages: 1, totalCount: 0 },
    filters: {},
    sort: 'players',
    dir: 'desc',
    counters: computeLiveCounters([]),
    mapOptions: [],
    rosterAvailable: true,
    currentPath: '/servers',
  });
  assert.match(html, /source-toggle/);
  assert.match(html, /source=unofficial/);
  assert.match(html, />Official</);
  assert.match(html, />Unofficial</);
});

test('unofficial rows render without rank/uptime and may show a seen-rate', () => {
  const html = renderServerRow(
    {
      id: 'u1',
      name: 'Community Box',
      map: 'TheIsland_WP',
      playersNow: 4,
      maxPlayers: 20,
      version: '92.41',
      wildcardReportedPing: 40,
      cycles_seen: 3,
      rank: 1,
      uptimePercent: 99.2,
    },
    { source: 'unofficial', cyclesTotal: 4 }
  );
  assert.doesNotMatch(html, /href="\/servers\/u1"/);
  assert.match(html, /Community Box/);
  const cells = [...html.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
  assert.equal(cells[8], '75%');
  assert.equal(cells[9], '\u2014');
});

test('unofficial rows without cycles_seen render em-dash uptime and rank', () => {
  const html = renderServerRow(
    { id: 'u2', name: 'No History', map: 'Extinction_WP', playersNow: 1, maxPlayers: 10 },
    { source: 'unofficial', cyclesTotal: 4 }
  );
  const cells = [...html.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
  assert.equal(cells[8], '\u2014');
  assert.equal(cells[9], '\u2014');
});

test('unofficial rows with modIds show an N mods chip; official/favorites/maps rows do not', () => {
  const unofficial = renderServerRow(
    { id: 'u1', name: 'Modded Box', map: 'TheIsland_WP', playersNow: 2, maxPlayers: 10, platformType: 'PC', modIds: [1, 2, 3] },
    { source: 'unofficial' }
  );
  assert.match(unofficial, /3 mods/);
  const unofficialEmpty = renderServerRow(
    { id: 'u2', name: 'Vanilla Box', map: 'TheIsland_WP', playersNow: 1, maxPlayers: 10, modIds: [] },
    { source: 'unofficial' }
  );
  assert.doesNotMatch(unofficialEmpty, /mods/);
  const official = renderServerRow({
    id: '1',
    name: 'EU-PVE-TheIsland5313',
    map: 'TheIsland_WP',
    playersNow: 5,
    maxPlayers: 70,
    platformType: 'PC',
    modIds: [1027407],
  });
  assert.doesNotMatch(official, /mods/);
  const favoritesStyle = renderServerRow(
    { id: '1', name: 'Fav', map: 'TheIsland_WP', playersNow: 1, maxPlayers: 10, modIds: [1, 2] },
    { compareSelect: false }
  );
  assert.doesNotMatch(favoritesStyle, /mods/);
  const mapsStyle = renderServerRow(
    { id: '1', name: 'Map row', map: 'TheIsland_WP', playersNow: 1, maxPlayers: 10, modIds: [9] },
    { compareSelect: false }
  );
  assert.doesNotMatch(mapsStyle, /mods/);
});

test('renderBrowserPage unofficial source uses Seen header and keeps filters working', () => {
  const servers = [
    { id: 'u1', name: 'Community Box', map: 'TheIsland_WP', gameMode: 'pve', playersNow: 4, maxPlayers: 20, cycles_seen: 2 },
  ];
  const html = renderBrowserPage({
    page: paginateServers(servers, 1, 25),
    filters: { gameMode: 'pve' },
    sort: 'players',
    dir: 'desc',
    counters: computeLiveCounters(servers),
    mapOptions: ['TheIsland_WP'],
    rosterAvailable: true,
    currentPath: '/servers',
    source: 'unofficial',
    cyclesTotal: 4,
  });
  assert.match(html, />Seen</);
  assert.doesNotMatch(html, />Uptime</);
  assert.match(html, /Community Box/);
  assert.doesNotMatch(html, /href="\/servers\/u1"/);
  assert.match(html, /name="source" value="unofficial"/);
  assert.match(html, /<p class="counters">Showing 1 unofficial servers/);
  assert.match(html, /4 players on them/);
  assert.doesNotMatch(html, /matching servers\./);
  assert.doesNotMatch(html, /name="s"/);
  assert.doesNotMatch(html, /action="\/compare"/);
  assert.doesNotMatch(html, /Compare selected/);
});

test('renderHeroBand includes unofficial count when unofficial meta is present', () => {
  const html = renderHeroBand({
    counters: { totalOfficial: 10, playersOnline: 40 },
    rosterMeta: { totalOfficial: 3093, pveCount: 1400, pvpCount: 1693, generatedAt: 'T' },
    unofficialMeta: { count: 56198 },
  });
  assert.match(html, /3,093/);
  assert.match(html, /56,198/);
  assert.match(html, /official \(1,400 PvE \/ 1,693 PvP\) and .* listed unofficial servers/);
  assert.match(html, /Unofficial Servers Listed/);
});

test('renderHeroBand combines official and unofficial players and splits the sublabel', () => {
  const html = renderHeroBand({
    officialCounters: { totalOfficial: 10, playersOnline: 21386 },
    rosterMeta: { totalOfficial: 3093, pveCount: 1400, pvpCount: 1693, generatedAt: 'T' },
    unofficialMeta: { count: 56198, playersOnline: 14792 },
  });
  assert.match(html, /Unofficial Servers Listed/);
  assert.match(html, /56,198/);
  assert.match(html, /36,178/);
  assert.match(html, /21,386 official \u00b7 14,792 unofficial/);
  assert.match(html, /Official Uptime % \(24h\)/);
});

test('renderHeroBand falls back to official-only players when unofficial meta is unavailable', () => {
  const html = renderHeroBand({
    officialCounters: { totalOfficial: 10, playersOnline: 21386 },
    rosterMeta: { totalOfficial: 3093, pveCount: 1400, pvpCount: 1693, generatedAt: 'T' },
    unofficialMeta: null,
  });
  assert.match(html, /21,386/);
  assert.doesNotMatch(html, /Unofficial Servers Listed/);
  assert.doesNotMatch(html, /official \u00b7 .* unofficial/);
  assert.doesNotMatch(html, />0</);
});

test('renderHeroBand shows tracked all-time only when it exceeds listed count', () => {
  const withTracked = renderHeroBand({
    counters: { totalOfficial: 10, playersOnline: 40 },
    unofficialMeta: { count: 5, playersOnline: 3, trackedTotal: 120000 },
  });
  assert.match(withTracked, /Unofficial Servers Listed/);
  assert.match(withTracked, />5</);
  assert.match(withTracked, /120,000 tracked all-time/);

  const absent = renderHeroBand({
    counters: { totalOfficial: 10, playersOnline: 40 },
    unofficialMeta: { count: 5, playersOnline: 3 },
  });
  assert.match(absent, /Unofficial Servers Listed/);
  assert.match(absent, />5</);
  assert.doesNotMatch(absent, /tracked all-time/);

  const notGreater = renderHeroBand({
    counters: { totalOfficial: 10, playersOnline: 40 },
    unofficialMeta: { count: 5, playersOnline: 3, trackedTotal: 5 },
  });
  assert.match(notGreater, /Unofficial Servers Listed/);
  assert.doesNotMatch(notGreater, /tracked all-time/);
});

test('renderHeroBand is identical for official and unofficial browser views', () => {
  const official = makeServers();
  const unofficial = [
    { id: 'u1', name: 'Community Box', map: 'TheIsland_WP', gameMode: 'pve', playersNow: 4, maxPlayers: 20 },
  ];
  const shared = {
    filters: {},
    sort: 'players',
    dir: 'desc',
    officialCounters: computeLiveCounters(official),
    rosterMeta: { totalOfficial: 4, pveCount: 2, pvpCount: 2, generatedAt: 'T' },
    unofficialMeta: { count: 1, playersOnline: 4 },
    status: { state: 'NORMAL', onlineCount: 4, offlinePct: 2 },
    rosterAvailable: true,
    currentPath: '/servers',
    showHero: true,
  };
  const officialHtml = renderBrowserPage({
    ...shared,
    page: paginateServers(official, 1, 25),
    counters: computeLiveCounters(official),
    mapOptions: getDistinctMaps(official),
    source: 'official',
  });
  const unofficialHtml = renderBrowserPage({
    ...shared,
    page: paginateServers(unofficial, 1, 25),
    counters: computeLiveCounters(unofficial),
    mapOptions: getDistinctMaps(unofficial),
    source: 'unofficial',
  });
  const heroOf = (html) => {
    const match = html.match(/<section class="hero">[\s\S]*?<\/section>/);
    assert.ok(match, 'expected a hero section');
    return match[0];
  };
  assert.equal(heroOf(officialHtml), heroOf(unofficialHtml));
  assert.match(heroOf(officialHtml), /67/);
  assert.match(heroOf(officialHtml), /63 official \u00b7 4 unofficial/);
});

function countryServers() {
  return [
    { id: 'de-1', name: 'EU-PVE-TheIsland5313', map: 'TheIsland_WP', country: 'DE', countryName: 'Germany', gameMode: 'pve', playersNow: 5 },
    { id: 'us-1', name: 'NA-PVP-Astraeos2573', map: 'Astraeos_WP', country: 'us', countryName: 'United States', gameMode: 'pvp', playersNow: 10 },
    { id: 'fr-1', name: 'EU-PVE-ClubARK', map: 'BobsMissions_WP', country: 'FR', countryName: 'France', gameMode: 'pve', playersNow: 1 },
    { id: 'none', name: 'Unknown-PVE-1', map: 'TheIsland_WP', gameMode: 'pve', playersNow: 2 },
  ];
}

test('filterServers filters by country ISO code, case-insensitive', () => {
  const result = filterServers(countryServers(), { country: 'de' });
  assert.deepEqual(result.map((s) => s.id), ['de-1']);
  assert.equal(filterServers(countryServers(), { country: 'US' }).length, 1);
  assert.equal(filterServers(countryServers(), { country: 'XX' }).length, 0);
});

test('filterServers country filter leaves missing-country rows out', () => {
  const result = filterServers(countryServers(), { country: 'FR', gameMode: 'pve' });
  assert.deepEqual(result.map((s) => s.id), ['fr-1']);
});

test('filtersFromSearchParams normalizes country to uppercase ISO', () => {
  const params = new URLSearchParams('country=de&map=TheIsland_WP');
  const filters = filtersFromSearchParams(params);
  assert.equal(filters.country, 'DE');
  assert.equal(filtersFromSearchParams(new URLSearchParams('country=')).country, '');
});

test('filtersFromSearchParams round-trips minPing, maxPing, and minUptime', () => {
  const filters = filtersFromSearchParams(new URLSearchParams('minPing=20&maxPing=80&minUptime=95'));
  assert.equal(filters.minPing, '20');
  assert.equal(filters.maxPing, '80');
  assert.equal(filters.minUptime, '95');
  const empty = filtersFromSearchParams(new URLSearchParams());
  assert.equal(empty.minPing, '');
  assert.equal(empty.maxPing, '');
  assert.equal(empty.minUptime, '');
});

test('filtersFromSearchParams round-trips transfers', () => {
  assert.equal(filtersFromSearchParams(new URLSearchParams('transfers=both')).transfers, 'both');
  assert.equal(filtersFromSearchParams(new URLSearchParams('transfers=chars&gameMode=pve')).transfers, 'chars');
  assert.equal(filtersFromSearchParams(new URLSearchParams()).transfers, '');
});

test('getDistinctCountries is alphabetical by name and skips missing country', () => {
  const countries = getDistinctCountries(countryServers());
  assert.deepEqual(
    countries.map((c) => c.code),
    ['FR', 'DE', 'US']
  );
  assert.deepEqual(
    countries.map((c) => c.name),
    ['France', 'Germany', 'United States']
  );
});

test('renderServerRow shows flag plus ISO code, or an em-dash when country is absent', () => {
  const withCountry = renderServerRow({
    id: '1',
    name: 'EU-PVE-TheIsland5313',
    map: 'TheIsland_WP',
    country: 'DE',
    countryName: 'Germany',
    playersNow: 5,
    maxPlayers: 70,
  });
  const withCells = [...withCountry.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
  assert.equal(withCells[4], '\u{1F1E9}\u{1F1EA} DE');

  const missing = renderServerRow({
    id: '2',
    name: 'No-Geo',
    map: 'TheIsland_WP',
    playersNow: 1,
    maxPlayers: 70,
  });
  const missingCells = [...missing.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
  assert.equal(missingCells[4], '\u2014');
});

test('renderBrowserPage country dropdown is populated from roster countries and keeps the query param', () => {
  const servers = countryServers();
  const html = renderBrowserPage({
    page: paginateServers(filterServers(servers, { country: 'DE' }), 1, 25),
    filters: { country: 'DE' },
    sort: 'players',
    dir: 'desc',
    counters: computeLiveCounters(servers),
    mapOptions: getDistinctMaps(servers),
    countryOptions: getDistinctCountries(servers),
    rosterAvailable: true,
    currentPath: '/servers',
  });
  assert.match(html, /name="country"/);
  assert.match(html, /<option value="DE" selected>Germany<\/option>/);
  assert.match(html, /<option value="FR"[^>]*>France<\/option>/);
  assert.match(html, /All countries/);
  assert.match(html, />Region</);
  assert.match(html, /\u{1F1E9}\u{1F1EA} DE/u);
  assert.doesNotMatch(html, /NA-PVP-Astraeos2573/);
});

test('renderBrowserPage official source wraps the table in a compare form with checkbox column', () => {
  const servers = makeServers();
  const html = renderBrowserPage({
    page: paginateServers(servers, 1, 25),
    filters: {},
    sort: 'players',
    dir: 'desc',
    counters: computeLiveCounters(servers),
    mapOptions: getDistinctMaps(servers),
    rosterAvailable: true,
    currentPath: '/servers',
  });
  assert.match(html, /<form method="GET" action="\/compare">/);
  assert.match(html, /name="s" value="1"/);
  assert.match(html, /aria-label="Select for comparison"/);
  assert.match(html, />Compare selected</);
  const formStart = html.indexOf('action="/compare"');
  const formEnd = html.indexOf('</form>', formStart);
  const paginationAt = html.indexOf('class="pagination"');
  assert.ok(formStart !== -1 && formEnd !== -1 && paginationAt !== -1);
  assert.ok(formEnd < paginationAt);
});

test('renderBrowserPage zero-results branch has no compare form', () => {
  const html = renderBrowserPage({
    page: { items: [], page: 1, totalPages: 1, totalCount: 0 },
    filters: {},
    sort: 'players',
    dir: 'desc',
    counters: computeLiveCounters([]),
    mapOptions: [],
    rosterAvailable: true,
    currentPath: '/servers',
  });
  assert.match(html, /No servers match these filters/);
  assert.doesNotMatch(html, /action="\/compare"/);
  assert.doesNotMatch(html, /Compare selected/);
});

