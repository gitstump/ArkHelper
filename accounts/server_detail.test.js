'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderServerDetailPage, renderServerNotFoundPage, renderRosterUnavailablePage } = require('./server_detail.js');

function makeServer(overrides = {}) {
  return {
    id: 'abc123',
    name: 'EU-PVE-TheIsland5313',
    map: 'TheIsland_WP',
    gameMode: 'pve',
    playersNow: 5,
    maxPlayers: 70,
    day: 12182,
    version: '92.41',
    clusterId: 'PVECrossplay',
    platformType: 'PC+XSX+WINGDK+PS5',
    hasPassword: false,
    battleye: true,
    ip: '5.62.112.69',
    port: 7779,
    modIds: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------
// renderServerNotFoundPage / renderRosterUnavailablePage
// ---------------------------------------------------------------------
test('renderServerNotFoundPage includes the requested id', () => {
  const html = renderServerNotFoundPage('xyz789');
  assert.match(html, /xyz789/);
  assert.match(html, /not found/i);
});

test('renderServerNotFoundPage escapes a hostile id', () => {
  const html = renderServerNotFoundPage('<script>evil()</script>');
  assert.doesNotMatch(html, /<script>evil\(\)<\/script>/);
});

test('renderRosterUnavailablePage mentions the discovery service', () => {
  const html = renderRosterUnavailablePage();
  assert.match(html, /discovery service may not be running/);
});

// ---------------------------------------------------------------------
// renderServerDetailPage — facts
// ---------------------------------------------------------------------
test('renderServerDetailPage shows the core facts', () => {
  const html = renderServerDetailPage({ server: makeServer(), uptime: null, history: [] });
  assert.match(html, /EU-PVE-TheIsland5313/);
  assert.match(html, /TheIsland_WP/);
  assert.match(html, />PvE</);
  assert.match(html, /12182/);
  assert.match(html, /92\.41/);
  assert.match(html, /PVECrossplay/);
  assert.match(html, /5\.62\.112\.69/);
  assert.match(html, /7779/);
  assert.match(html, /platform-badge/);
  assert.match(html, /PC\+Console/);
});

test('renderServerDetailPage shows "None (vanilla server)" when there are no mods', () => {
  const html = renderServerDetailPage({ server: makeServer({ modIds: [] }), uptime: null, history: [] });
  assert.match(html, /None \(vanilla server\)/);
});

test('renderServerDetailPage lists mod IDs when present', () => {
  const html = renderServerDetailPage({ server: makeServer({ modIds: ['123', '456'] }), uptime: null, history: [] });
  assert.match(html, /123, 456/);
});

test('renderServerDetailPage shows country when present, omits the row when absent', () => {
  const withCountry = renderServerDetailPage({ server: makeServer({ country: 'US', countryName: 'United States' }), uptime: null, history: [] });
  assert.match(withCountry, /United States/);

  const withoutCountry = renderServerDetailPage({ server: makeServer(), uptime: null, history: [] });
  assert.doesNotMatch(withoutCountry, /<td>Country<\/td>/);
});

test('renderServerDetailPage escapes a hostile server name (XSS check)', () => {
  const html = renderServerDetailPage({ server: makeServer({ name: '<script>evil()</script>' }), uptime: null, history: [] });
  assert.doesNotMatch(html, /<script>evil\(\)<\/script>/);
  assert.match(html, /&lt;script&gt;evil\(\)&lt;\/script&gt;/);
});

// ---------------------------------------------------------------------
// renderServerDetailPage — favorite button
// ---------------------------------------------------------------------
test('renderServerDetailPage shows a login prompt instead of a favorite button when logged out', () => {
  const html = renderServerDetailPage({ server: makeServer(), uptime: null, history: [], loggedIn: false, isFavorited: false });
  assert.match(html, /Login with Discord.*favorite this server/);
  assert.doesNotMatch(html, /Add to favorites/);
});

test('renderServerDetailPage shows "Add to favorites" when logged in and not yet favorited', () => {
  const html = renderServerDetailPage({ server: makeServer(), uptime: null, history: [], loggedIn: true, isFavorited: false });
  assert.match(html, /Add to favorites/);
  assert.match(html, /action="\/favorites\/abc123"/);
  assert.doesNotMatch(html, /action="\/favorites\/abc123\/remove"/);
});

test('renderServerDetailPage shows "Remove from favorites" when already favorited', () => {
  const html = renderServerDetailPage({ server: makeServer(), uptime: null, history: [], loggedIn: true, isFavorited: true });
  assert.match(html, /Remove from favorites/);
  assert.match(html, /action="\/favorites\/abc123\/remove"/);
});

// ---------------------------------------------------------------------
// renderServerDetailPage — alert configuration
// ---------------------------------------------------------------------
test('renderServerDetailPage omits the alert form entirely when logged out', () => {
  const html = renderServerDetailPage({ server: makeServer(), uptime: null, history: [], loggedIn: false, isFavorited: false, alertSettings: null });
  assert.doesNotMatch(html, /Save alert settings/);
});

test('renderServerDetailPage shows an unchecked/empty alert form when logged in with no settings configured', () => {
  const html = renderServerDetailPage({ server: makeServer(), uptime: null, history: [], loggedIn: true, isFavorited: false, alertSettings: null });
  assert.match(html, /Save alert settings/);
  assert.doesNotMatch(html, /name="notifyDown" checked/);
  assert.doesNotMatch(html, /name="notifyOnline" checked/);
});

test('renderServerDetailPage pre-fills the alert form from existing settings', () => {
  const html = renderServerDetailPage({
    server: makeServer(),
    uptime: null,
    history: [],
    loggedIn: true,
    isFavorited: false,
    alertSettings: { notifyDown: true, notifyOnline: false, capacityThresholdPct: 90, minFreeSlots: 2 },
  });
  assert.match(html, /name="notifyDown" checked/);
  assert.doesNotMatch(html, /name="notifyOnline" checked/);
  assert.match(html, /name="capacityThresholdPct"[^>]*value="90"/);
  assert.match(html, /name="minFreeSlots"[^>]*value="2"/);
});

test('renderServerDetailPage alert form posts to the correct per-server URL', () => {
  const html = renderServerDetailPage({ server: makeServer({ id: 'xyz' }), uptime: null, history: [], loggedIn: true, isFavorited: false, alertSettings: null });
  assert.match(html, /action="\/alerts\/xyz"/);
});

test('renderServerDetailPage shows the "not enough history" message when uptime is null', () => {
  const html = renderServerDetailPage({ server: makeServer(), uptime: { uptimePercent: null, totalRuns: 0, presentCount: 0 }, history: [] });
  assert.match(html, /Not enough history yet/);
});

test('renderServerDetailPage shows the computed uptime percentage', () => {
  const html = renderServerDetailPage({ server: makeServer(), uptime: { uptimePercent: 87.5, totalRuns: 8, presentCount: 7 }, history: [] });
  assert.match(html, /87\.5%/);
  assert.match(html, /last 8 discovery runs/);
  assert.match(html, /7 of them/);
});

// ---------------------------------------------------------------------
// renderServerDetailPage — history section
// ---------------------------------------------------------------------
test('renderServerDetailPage shows "no recorded history" when history is empty', () => {
  const html = renderServerDetailPage({ server: makeServer(), uptime: null, history: [] });
  assert.match(html, /No recorded history yet/);
});

test('renderServerDetailPage renders a history table when snapshots exist', () => {
  const history = [
    { seenAt: '2026-08-15T00:00:00.000Z', playersNow: 3, maxPlayers: 70, day: 100 },
    { seenAt: '2026-08-15T01:00:00.000Z', playersNow: 7, maxPlayers: 70, day: 101 },
  ];
  const html = renderServerDetailPage({ server: makeServer(), uptime: null, history });
  assert.match(html, /2026-08-15T00:00:00\.000Z/);
  assert.match(html, /2026-08-15T01:00:00\.000Z/);
  assert.match(html, /3\/70/);
});

test('renderServerDetailPage shows the most recent snapshots first, capped at 20', () => {
  const history = Array.from({ length: 25 }, (_, i) => ({ seenAt: `run-${i}`, playersNow: i, maxPlayers: 70, day: i }));
  const html = renderServerDetailPage({ server: makeServer(), uptime: null, history });
  assert.match(html, /most recent 20 of 25/);
  // the last entry (run-24) should appear before an early one (run-0) since it's newest-first
  assert.ok(html.indexOf('run-24') < html.indexOf('run-5'));
  assert.doesNotMatch(html, /run-0<\/td>/); // outside the most-recent-20 window
});

// ---------------------------------------------------------------------
// renderServerDetailPage — change log (wipe/version detection)
// ---------------------------------------------------------------------
test('renderServerDetailPage shows "no changes" when the change log is empty', () => {
  const html = renderServerDetailPage({ server: makeServer(), uptime: null, history: [], changeLog: [] });
  assert.match(html, /No version changes or wipes detected yet/);
});

test('renderServerDetailPage renders a wipe entry distinctly from a version-change entry', () => {
  const changeLog = [
    { changeType: 'wipe', oldValue: '45', newValue: '1', seenAt: '2026-08-15T00:00:00.000Z' },
    { changeType: 'version', oldValue: '92.41', newValue: '92.42', seenAt: '2026-08-14T00:00:00.000Z' },
  ];
  const html = renderServerDetailPage({ server: makeServer(), uptime: null, history: [], changeLog });
  assert.match(html, /Wipe detected/);
  assert.match(html, /reset from 45 to 1/);
  assert.match(html, /Version changed/);
  assert.match(html, /92\.41.*92\.42/);
});

test('renderServerDetailPage escapes change log values (defensive, even though they come from our own DB)', () => {
  const changeLog = [{ changeType: 'version', oldValue: '<script>x</script>', newValue: '1.0', seenAt: 'now' }];
  const html = renderServerDetailPage({ server: makeServer(), uptime: null, history: [], changeLog });
  assert.doesNotMatch(html, /<script>x<\/script>/);
});

// ---------------------------------------------------------------------
// renderServerDetailPage — heatmaps
// ---------------------------------------------------------------------
function flatGrid(overrides = {}) {
  const grid = [];
  for (let dow = 0; dow < 7; dow += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      grid.push({ dayOfWeek: dow, hour, avgPlayers: null, sampleCount: 0, downtimePercent: null, totalRuns: 0, ...overrides });
    }
  }
  return grid;
}

test('renderServerDetailPage shows "not enough history" for peak times when the grid is empty', () => {
  const html = renderServerDetailPage({ server: makeServer(), uptime: null, history: [], peakTimes: flatGrid() });
  assert.match(html, /Not enough history yet to show peak-time patterns/);
});

test('renderServerDetailPage renders the peak-times SVG when data exists', () => {
  const html = renderServerDetailPage({ server: makeServer(), uptime: null, history: [], peakTimes: flatGrid({ sampleCount: 3 }) });
  assert.match(html, /<svg/);
  assert.match(html, /Average player count by hour of week/);
});

test('renderServerDetailPage shows "not enough history" for downtime patterns when the grid is empty', () => {
  const html = renderServerDetailPage({ server: makeServer(), uptime: null, history: [], downtimePatterns: flatGrid() });
  assert.match(html, /Not enough history yet to show downtime patterns/);
});

test('renderServerDetailPage renders the downtime SVG when data exists', () => {
  const html = renderServerDetailPage({ server: makeServer(), uptime: null, history: [], downtimePatterns: flatGrid({ totalRuns: 3 }) });
  assert.match(html, /<svg/);
  assert.match(html, /discovery runs the server was absent/);
});

// ---------------------------------------------------------------------
// renderServerDetailPage — embeddable badge
// ---------------------------------------------------------------------
test('renderServerDetailPage shows a rank badge when the server has a rankScore', () => {
  const html = renderServerDetailPage({
    server: makeServer({ rankScore: 87.5, rank: 12 }),
    uptime: null,
    history: [],
  });
  assert.match(html, /class="rank-badge"/);
  assert.match(html, /#12/);
  assert.match(html, /87\.5/);
  assert.match(html, /href="\/rankings"/);
});

test('renderServerDetailPage omits the rank badge when the server has no score yet', () => {
  const html = renderServerDetailPage({ server: makeServer(), uptime: null, history: [] });
  assert.doesNotMatch(html, /class="rank-badge"/);
});

test('renderServerDetailPage omits the embed section when no badgeUrl is given', () => {
  const html = renderServerDetailPage({ server: makeServer(), uptime: null, history: [] });
  assert.doesNotMatch(html, /Markdown:/);
});

test('renderServerDetailPage renders the embed image and markdown/HTML snippets when badgeUrl is given', () => {
  const html = renderServerDetailPage({ server: makeServer(), uptime: null, history: [], badgeUrl: '/servers/abc123/badge.svg' });
  assert.match(html, /<img src="\/servers\/abc123\/badge\.svg"/);
  assert.match(html, /Markdown:/);
  assert.match(html, /!\[ArkHelper status\]/);
  assert.match(html, /HTML:/);
});
