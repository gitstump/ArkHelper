'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderServerDetailPage, renderUnofficialServerDetailPage, renderServerNotFoundPage, renderRosterUnavailablePage } = require('./server_detail.js');

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
  assert.match(html, /href="\/compare\?s=abc123">Compare this server</);
});

test('renderServerDetailPage shows "None (vanilla server)" when there are no mods', () => {
  const html = renderServerDetailPage({ server: makeServer({ modIds: [] }), uptime: null, history: [] });
  assert.match(html, /None \(vanilla server\)/);
});

test('renderServerDetailPage lists mod IDs when present', () => {
  const html = renderServerDetailPage({ server: makeServer({ modIds: ['123', '456'] }), uptime: null, history: [] });
  assert.match(html, /123, 456/);
});

test('renderServerDetailPage shows transfer facts only when known, with verbatim Enabled/Disabled copy', () => {
  const bothOn = renderServerDetailPage({
    server: makeServer({ allowCharTransfers: true, allowItemTransfers: true }),
    uptime: null,
    history: [],
  });
  assert.match(bothOn, /<td>Character transfers<\/td><td>Enabled<\/td>/);
  assert.match(bothOn, /<td>Item transfers<\/td><td>Enabled<\/td>/);
  assert.doesNotMatch(bothOn, /Unknown/);

  const bothOff = renderServerDetailPage({
    server: makeServer({ allowCharTransfers: false, allowItemTransfers: false }),
    uptime: null,
    history: [],
  });
  assert.match(bothOff, /<td>Character transfers<\/td><td>Disabled<\/td>/);
  assert.match(bothOff, /<td>Item transfers<\/td><td>Disabled<\/td>/);

  const charsOnly = renderServerDetailPage({
    server: makeServer({ allowCharTransfers: true }),
    uptime: null,
    history: [],
  });
  assert.match(charsOnly, /<td>Character transfers<\/td><td>Enabled<\/td>/);
  assert.doesNotMatch(charsOnly, /<td>Item transfers<\/td>/);

  const unknown = renderServerDetailPage({ server: makeServer(), uptime: null, history: [] });
  assert.doesNotMatch(unknown, /<td>Character transfers<\/td>/);
  assert.doesNotMatch(unknown, /<td>Item transfers<\/td>/);
});

test('renderServerDetailPage shows country when present, omits the row when absent', () => {
  const withCountry = renderServerDetailPage({ server: makeServer({ country: 'US', countryName: 'United States' }), uptime: null, history: [] });
  assert.match(withCountry, /United States/);
  assert.match(withCountry, /\u{1F1FA}\u{1F1F8}/u);
  assert.match(withCountry, /<td>Country<\/td>/);

  const withoutCountry = renderServerDetailPage({ server: makeServer(), uptime: null, history: [] });
  assert.doesNotMatch(withoutCountry, /<td>Country<\/td>/);
  assert.doesNotMatch(withoutCountry, /\u{1F1FA}\u{1F1F8}/u);
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

test('renderServerDetailPage alert form copy says alerts appear on the Alerts page and Discord, not that delivery is unwired', () => {
  const html = renderServerDetailPage({ server: makeServer(), uptime: null, history: [], loggedIn: true, isFavorited: false, alertSettings: null });
  assert.doesNotMatch(html, /not wired/);
  assert.doesNotMatch(html, /isn.t wired up yet/);
  assert.match(html, /Alerts page/);
  assert.match(html, /Discord webhook/);
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

test('renderServerDetailPage falls back to roster 7-day uptime when history uptime is missing', () => {
  const html = renderServerDetailPage({
    server: makeServer({ uptimePercent: 96.4 }),
    uptime: null,
    history: [],
  });
  assert.match(html, /Uptime \(7-day\)/);
  assert.match(html, /96\.4%/);
  assert.doesNotMatch(html, /Not enough history yet to compute uptime/);
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

// ---------------------------------------------------------------------
// renderServerDetailPage — rank neighborhood
// ---------------------------------------------------------------------
function makeNeighborhood(overrides = {}) {
  return {
    serverId: 'abc123',
    totalRuns: 200,
    eligibleServerCount: 100,
    ranking: {
      rank: 10,
      percentile: 90.1,
      totalRanked: 100,
      neighbors: [
        { serverId: 'n1', rank: 8, rankScore: 82.1, uptimePercent: 99.2 },
        { serverId: 'n2', rank: 9, rankScore: 81.0, uptimePercent: 98.0 },
        { serverId: 'abc123', rank: 10, rankScore: 80.5, uptimePercent: 97.5 },
        { serverId: 'n3', rank: 11, rankScore: 79.0, uptimePercent: 96.1 },
        { serverId: 'n4', rank: 12, rankScore: 78.2, uptimePercent: 95.0 },
      ],
    },
    ...overrides,
  };
}

const NEIGHBOR_NAMES = new Map([
  ['n1', 'Alpha'],
  ['n2', 'Bravo'],
  ['abc123', 'EU-PVE-TheIsland5313'],
  ['n3', 'Charlie'],
  ['n4', 'Delta'],
]);

test('renderServerDetailPage shows a rank neighborhood table with the current server highlighted', () => {
  const html = renderServerDetailPage({
    server: makeServer(),
    uptime: null,
    history: [],
    rankNeighborhood: makeNeighborhood(),
    serverNames: NEIGHBOR_NAMES,
  });
  assert.match(html, /<h2>Rank neighborhood<\/h2>/);
  assert.match(html, /Ranked #10 of 100 \u2014 top 90\.1%/);
  const currentRow = html.match(/<tr class="rank-current">[\s\S]*?<\/tr>/);
  assert.ok(currentRow, 'current server row should be highlighted');
  assert.match(currentRow[0], /EU-PVE-TheIsland5313/);
  assert.doesNotMatch(currentRow[0], /<a /);
  assert.match(html, /href="\/servers\/n1"/);
  assert.match(html, /href="\/servers\/n2"/);
  assert.match(html, /href="\/servers\/n3"/);
  assert.match(html, /href="\/servers\/n4"/);
  assert.doesNotMatch(html, /href="\/servers\/abc123"/);
});

test('renderServerDetailPage falls back to the raw serverId when a neighbor is not on the roster', () => {
  const names = new Map([
    ['n1', 'Alpha'],
    ['abc123', 'EU-PVE-TheIsland5313'],
  ]);
  const html = renderServerDetailPage({
    server: makeServer(),
    uptime: null,
    history: [],
    rankNeighborhood: makeNeighborhood(),
    serverNames: names,
  });
  assert.match(html, /n2/);
  assert.match(html, /class="note num">n2</);
  assert.match(html, /href="\/servers\/n2"/);
});

test('renderServerDetailPage omits the rank neighborhood section when there is nothing to show', () => {
  const cases = [
    { rankNeighborhood: null },
    { rankNeighborhood: { ranking: null } },
    { rankNeighborhood: { ranking: { rank: 1, percentile: 99, totalRanked: 10, neighbors: [] } } },
    { rankNeighborhood: { ranking: { rank: 1, percentile: 99, totalRanked: 10 } } },
  ];
  for (const extra of cases) {
    const html = renderServerDetailPage({ server: makeServer(), uptime: null, history: [], ...extra });
    assert.doesNotMatch(html, /Rank neighborhood/);
  }
});

test('renderServerDetailPage renders em-dashes for a malformed neighbor without throwing', () => {
  const html = renderServerDetailPage({
    server: makeServer(),
    uptime: null,
    history: [],
    rankNeighborhood: {
      ranking: {
        rank: 1,
        percentile: 99.9,
        totalRanked: 10,
        neighbors: [{ serverId: 'ghost' }],
      },
    },
    serverNames: new Map(),
  });
  assert.match(html, /Rank neighborhood/);
  assert.match(html, /ghost/);
  assert.match(html, /<td class="num">\u2014<\/td><td><a href="\/servers\/ghost">/);
  assert.match(html, /ghost<\/span><\/a><\/td><td class="num">\u2014<\/td><td class="num">\u2014<\/td>/);
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

function snippetBoxes(html) {
  return [...html.matchAll(/<div class="embed-box">([\s\S]*?)<\/div>/g)].map((m) => m[1]);
}

test('embed snippets use the absolute site origin in all four URL positions', () => {
  const html = renderServerDetailPage({
    server: makeServer(),
    uptime: null,
    history: [],
    badgeUrl: '/servers/abc123/badge.svg',
  });
  const boxes = snippetBoxes(html);
  assert.equal(boxes.length, 2);
  const [markdown, htmlSnippet] = boxes;
  assert.match(markdown, /!\[ArkHelper status\]\(https:\/\/arkhelper\.info\/servers\/abc123\/badge\.svg\)/);
  assert.match(markdown, /\]\(https:\/\/arkhelper\.info\/servers\/abc123\)/);
  assert.match(htmlSnippet, /href=&quot;https:\/\/arkhelper\.info\/servers\/abc123&quot;/);
  assert.match(htmlSnippet, /src=&quot;https:\/\/arkhelper\.info\/servers\/abc123\/badge\.svg&quot;/);
  for (const box of boxes) {
    assert.doesNotMatch(box, /(?:\]\(|href=&quot;|src=&quot;)\/servers\//);
  }
  assert.match(html, /<img src="\/servers\/abc123\/badge\.svg" alt="Live status badge">/);
});

test('embed snippets honor an origin override and strip a trailing slash', () => {
  const html = renderServerDetailPage({
    server: makeServer(),
    uptime: null,
    history: [],
    badgeUrl: '/servers/abc123/badge.svg',
    origin: 'https://staging.example/',
  });
  const boxes = snippetBoxes(html);
  assert.equal(boxes.length, 2);
  const [markdown, htmlSnippet] = boxes;
  assert.match(markdown, /!\[ArkHelper status\]\(https:\/\/staging\.example\/servers\/abc123\/badge\.svg\)/);
  assert.match(markdown, /\]\(https:\/\/staging\.example\/servers\/abc123\)/);
  assert.match(htmlSnippet, /href=&quot;https:\/\/staging\.example\/servers\/abc123&quot;/);
  assert.match(htmlSnippet, /src=&quot;https:\/\/staging\.example\/servers\/abc123\/badge\.svg&quot;/);
  for (const box of boxes) {
    assert.doesNotMatch(box, /staging\.example\/\//);
    assert.doesNotMatch(box, /(?:\]\(|href=&quot;|src=&quot;)\/servers\//);
  }
});

// ---------------------------------------------------------------------
// renderServerDetailPage — Recent changes (two-cycle events)
// ---------------------------------------------------------------------
test('renderServerDetailPage shows the Recent changes empty state when there are no events', () => {
  const html = renderServerDetailPage({ server: makeServer(), uptime: null, history: [], changeEvents: [] });
  assert.match(html, /<h2>Recent changes<\/h2>/);
  assert.match(html, /Configuration and world changes we've observed on this server. A change is recorded only after it holds for two polling cycles, so brief glitches during a restart aren't logged here./);
  assert.match(html, /No changes observed yet. This server's settings have held steady since we started tracking it./);
  assert.doesNotMatch(html, /<ul class="change-log">[\s\S]*Updated from/);
  assert.doesNotMatch(html, /Wipes are inferred from a world day reset/);
});

test('renderServerDetailPage renders Recent changes with verbatim copy, newest first, capped at 10', () => {
  const changeEvents = [
    { eventType: 'version_change', field: 'version', oldValue: '92.45', newValue: '92.47', detectedAt: '2026-08-15T10:00:00.000Z' },
    { eventType: 'transfer_change', field: 'characterTransfers', oldValue: 'false', newValue: 'true', detectedAt: '2026-08-15T09:00:00.000Z' },
    { eventType: 'transfer_change', field: 'itemTransfers', oldValue: 'true', newValue: 'false', detectedAt: '2026-08-15T08:00:00.000Z' },
    { eventType: 'map_change', field: 'map', oldValue: 'TheIsland_WP', newValue: 'Extinction_WP', detectedAt: '2026-08-15T07:00:00.000Z' },
    { eventType: 'capacity_change', field: 'maxPlayers', oldValue: '70', newValue: '50', detectedAt: '2026-08-15T06:00:00.000Z' },
    { eventType: 'probable_wipe', field: null, oldValue: '45', newValue: '1', detectedAt: '2026-08-15T05:00:00.000Z' },
    { eventType: 'version_change', field: 'version', oldValue: '92.41', newValue: '92.42', detectedAt: '2026-08-15T04:00:00.000Z' },
    { eventType: 'version_change', field: 'version', oldValue: '92.40', newValue: '92.41', detectedAt: '2026-08-15T03:00:00.000Z' },
    { eventType: 'version_change', field: 'version', oldValue: '92.39', newValue: '92.40', detectedAt: '2026-08-15T02:00:00.000Z' },
    { eventType: 'version_change', field: 'version', oldValue: '92.38', newValue: '92.39', detectedAt: '2026-08-15T01:00:00.000Z' },
    { eventType: 'version_change', field: 'version', oldValue: '92.37', newValue: '92.38', detectedAt: '2026-08-15T00:00:00.000Z' },
  ];
  const html = renderServerDetailPage({ server: makeServer(), uptime: null, history: [], changeEvents });
  assert.match(html, /<h2>Recent changes<\/h2>/);
  assert.match(html, /Updated from 92\.45 to 92\.47/);
  assert.match(html, /Character transfers enabled/);
  assert.match(html, /Item transfers disabled/);
  assert.match(html, /Map changed from TheIsland_WP to Extinction_WP/);
  assert.match(html, /Player slots changed from 70 to 50/);
  assert.match(html, /Possible wipe \u2014 world day reset from 45 to day 1/);
  assert.match(html, /Wipes are inferred from a world day reset, not confirmed by the server. A day reset can also follow a save restore./);
  assert.ok(html.indexOf('Updated from 92.45 to 92.47') < html.indexOf('Character transfers enabled'));
  assert.ok(html.indexOf('2026-08-15T10:00:00.000Z') < html.indexOf('2026-08-15T09:00:00.000Z'));
  assert.doesNotMatch(html, /Updated from 92\.37 to 92\.38/);
  assert.match(html, /Updated from 92\.38 to 92\.39/);
});

test('renderServerDetailPage still shows Recent changes empty state when changeEvents is omitted', () => {
  const html = renderServerDetailPage({ server: makeServer(), uptime: null, history: [] });
  assert.match(html, /<h2>Recent changes<\/h2>/);
  assert.match(html, /No changes observed yet. This server's settings have held steady since we started tracking it./);
});

test('renderServerDetailPage escapes hostile Recent changes values', () => {
  const html = renderServerDetailPage({
    server: makeServer(),
    uptime: null,
    history: [],
    changeEvents: [{ eventType: 'version_change', field: 'version', oldValue: '<script>x</script>', newValue: '1.0', detectedAt: 'now' }],
  });
  assert.doesNotMatch(html, /<script>x<\/script>/);
  assert.match(html, /Updated from &lt;script&gt;x&lt;\/script&gt; to 1\.0/);
});

function makeUnofficialServer(overrides = {}) {
  return {
    id: 'u-sess-1',
    name: 'Community Box',
    map: 'TheIsland_WP',
    gameMode: 'pve',
    playersNow: 4,
    maxPlayers: 20,
    version: '92.41',
    platformType: 'PC',
    ping: 40,
    hasPassword: false,
    lastSeen: '2026-08-23T12:00:00.000Z',
    ...overrides,
  };
}

function officialOnlySections() {
  return [
    /<h2>Uptime<\/h2>/,
    /<h2>Recent history<\/h2>/,
    /<h2>Activity log<\/h2>/,
    /<h2>Peak times<\/h2>/,
    /<h2>Downtime patterns<\/h2>/,
    /Rank neighborhood/,
    /Compare this server/,
    /Embed this server/,
    /Add to favorites/,
    /Save alert settings/,
  ];
}

test('renderUnofficialServerDetailPage shows persisted facts and omits history sections', () => {
  const html = renderUnofficialServerDetailPage({
    server: makeUnofficialServer(),
    changeEvents: [],
    now: () => Date.parse('2026-08-23T12:00:00.000Z'),
  });
  assert.match(html, /Community Box/);
  assert.match(html, /<td>Players<\/td><td>4 \/ 20<\/td>/);
  assert.match(html, /<td>Map<\/td><td>TheIsland_WP<\/td>/);
  assert.match(html, />PvE</);
  assert.match(html, /<td>Version<\/td><td>92\.41<\/td>/);
  assert.match(html, /<td>Ping<\/td><td>40<\/td>/);
  assert.match(html, /<td>Last seen<\/td><td>2026-08-23T12:00:00\.000Z<\/td>/);
  assert.match(html, /<h2>Recent changes<\/h2>/);
  assert.doesNotMatch(html, /This server hasn't appeared in the server list/);
  for (const pattern of officialOnlySections()) {
    assert.doesNotMatch(html, pattern);
  }
});

test('renderUnofficialServerDetailPage shows transfer facts only when known, with verbatim Enabled/Disabled copy', () => {
  const bothOn = renderUnofficialServerDetailPage({
    server: makeUnofficialServer({ allowCharTransfers: true, allowItemTransfers: true }),
    now: () => Date.parse('2026-08-23T12:00:00.000Z'),
  });
  assert.match(bothOn, /<td>Character transfers<\/td><td>Enabled<\/td>/);
  assert.match(bothOn, /<td>Item transfers<\/td><td>Enabled<\/td>/);
  assert.doesNotMatch(bothOn, /Unknown/);

  const bothOff = renderUnofficialServerDetailPage({
    server: makeUnofficialServer({ allowCharTransfers: false, allowItemTransfers: false }),
    now: () => Date.parse('2026-08-23T12:00:00.000Z'),
  });
  assert.match(bothOff, /<td>Character transfers<\/td><td>Disabled<\/td>/);
  assert.match(bothOff, /<td>Item transfers<\/td><td>Disabled<\/td>/);

  const charsOnly = renderUnofficialServerDetailPage({
    server: makeUnofficialServer({ allowCharTransfers: true, allowItemTransfers: null }),
    now: () => Date.parse('2026-08-23T12:00:00.000Z'),
  });
  assert.match(charsOnly, /<td>Character transfers<\/td><td>Enabled<\/td>/);
  assert.doesNotMatch(charsOnly, /<td>Item transfers<\/td>/);

  const unknown = renderUnofficialServerDetailPage({
    server: makeUnofficialServer(),
    now: () => Date.parse('2026-08-23T12:00:00.000Z'),
  });
  assert.doesNotMatch(unknown, /<td>Character transfers<\/td>/);
  assert.doesNotMatch(unknown, /<td>Item transfers<\/td>/);
});

test('renderUnofficialServerDetailPage omits lines for fields that are not persisted', () => {
  const html = renderUnofficialServerDetailPage({
    server: {
      id: 'u-sparse',
      name: 'Sparse Box',
      lastSeen: '2026-08-23T12:00:00.000Z',
    },
    now: () => Date.parse('2026-08-23T12:00:00.000Z'),
  });
  assert.doesNotMatch(html, /<td>Players<\/td>/);
  assert.doesNotMatch(html, /<td>Map<\/td>/);
  assert.doesNotMatch(html, /<td>Mode<\/td>/);
  assert.doesNotMatch(html, /<td>Version<\/td>/);
  assert.doesNotMatch(html, /<td>Ping<\/td>/);
  assert.doesNotMatch(html, /<td>Platforms<\/td>/);
  assert.doesNotMatch(html, /<td>Password protected<\/td>/);
  assert.doesNotMatch(html, /<td>Character transfers<\/td>/);
  assert.doesNotMatch(html, /<td>Item transfers<\/td>/);
  assert.doesNotMatch(html, /<td>Country<\/td>/);
  assert.doesNotMatch(html, /<td>Day<\/td>/);
  assert.doesNotMatch(html, /N\/A/);
  assert.match(html, /<td>Last seen<\/td>/);
});

test('renderUnofficialServerDetailPage renders Recent changes events and the empty state', () => {
  const empty = renderUnofficialServerDetailPage({
    server: makeUnofficialServer(),
    changeEvents: [],
    now: () => Date.parse('2026-08-23T12:00:00.000Z'),
  });
  assert.match(empty, /<h2>Recent changes<\/h2>/);
  assert.match(empty, /Configuration and world changes we've observed on this server. A change is recorded only after it holds for two polling cycles, so brief glitches during a restart aren't logged here./);
  assert.match(empty, /No changes observed yet. This server's settings have held steady since we started tracking it./);
  assert.doesNotMatch(empty, /Wipes are inferred from a world day reset/);

  const withEvents = renderUnofficialServerDetailPage({
    server: makeUnofficialServer(),
    changeEvents: [
      { eventType: 'version_change', field: 'version', oldValue: '92.45', newValue: '92.47', detectedAt: '2026-08-22T10:00:00.000Z' },
    ],
    now: () => Date.parse('2026-08-23T12:00:00.000Z'),
  });
  assert.match(withEvents, /Updated from 92\.45 to 92\.47/);
  assert.doesNotMatch(withEvents, /No changes observed yet/);
});

test('renderUnofficialServerDetailPage shows the probable_wipe footnote verbatim', () => {
  const html = renderUnofficialServerDetailPage({
    server: makeUnofficialServer(),
    changeEvents: [
      { eventType: 'probable_wipe', field: null, oldValue: '45', newValue: '1', detectedAt: '2026-08-22T05:00:00.000Z' },
    ],
    now: () => Date.parse('2026-08-23T12:00:00.000Z'),
  });
  assert.match(html, /Possible wipe \u2014 world day reset from 45 to day 1/);
  assert.match(html, /Wipes are inferred from a world day reset, not confirmed by the server. A day reset can also follow a save restore./);
});

test('renderUnofficialServerDetailPage shows the absent line only when last seen is over 7 days ago', () => {
  const now = () => Date.parse('2026-08-23T12:00:00.000Z');
  const stale = renderUnofficialServerDetailPage({
    server: makeUnofficialServer({ lastSeen: '2026-08-15T11:59:59.000Z' }),
    now,
  });
  assert.match(
    stale,
    /This server hasn't appeared in the server list since 2026-08-15. It may have been taken offline./
  );

  const recent = renderUnofficialServerDetailPage({
    server: makeUnofficialServer({ lastSeen: '2026-08-16T12:00:00.000Z' }),
    now,
  });
  assert.doesNotMatch(recent, /This server hasn't appeared in the server list/);
});

test('official detail page still includes official-only sections', () => {
  const html = renderServerDetailPage({ server: makeServer(), uptime: null, history: [] });
  assert.match(html, /<h2>Uptime<\/h2>/);
  assert.match(html, /<h2>Recent history<\/h2>/);
  assert.match(html, /<h2>Activity log<\/h2>/);
  assert.match(html, /Compare this server/);
});
