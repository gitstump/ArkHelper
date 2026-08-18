'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  COMPARE_CAP,
  ATTR_ROWS,
  parseCompareIds,
  compareHref,
  renderComparePage,
} = require('./compare_page.js');

function server(id, overrides = {}) {
  return {
    id,
    name: `Server ${id}`,
    map: 'TheIsland_WP',
    gameMode: 'pve',
    platformType: 'PC',
    country: 'DE',
    playersNow: 10,
    maxPlayers: 70,
    wildcardReportedPing: 40,
    uptimePercent: 90,
    rank: 2,
    rankScore: 80,
    clusterId: 'PVECrossplay',
    version: '92.41',
    day: 100,
    ...overrides,
  };
}

function attrRow(html, label) {
  const re = new RegExp(`<tr><th scope="row">${label}</th>([\\s\\S]*?)</tr>`);
  const m = html.match(re);
  assert.ok(m, `missing attribute row ${label}`);
  return m[1];
}

function rowCells(html, label) {
  return [...attrRow(html, label).matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)].map((m) => ({
    attrs: m[1],
    text: m[2],
  }));
}

test('parseCompareIds collects repeated s params in first-seen order', () => {
  const result = parseCompareIds(new URLSearchParams('s=a&s=b&s=c'));
  assert.deepEqual(result.ids, ['a', 'b', 'c']);
  assert.equal(result.truncated, false);
});

test('parseCompareIds splits comma-separated values and trims empties', () => {
  const result = parseCompareIds('s=a, b,,c&s=d');
  assert.deepEqual(result.ids, ['a', 'b', 'c', 'd']);
  assert.equal(result.truncated, false);
});

test('parseCompareIds dedups while preserving first-seen order', () => {
  const result = parseCompareIds('s=a&s=b&s=a&s=c,b');
  assert.deepEqual(result.ids, ['a', 'b', 'c']);
});

test('parseCompareIds caps at 4 and sets truncated', () => {
  const result = parseCompareIds('s=1&s=2&s=3&s=4&s=5');
  assert.deepEqual(result.ids, ['1', '2', '3', '4']);
  assert.equal(result.truncated, true);
  assert.equal(result.ids.length, COMPARE_CAP);
});

test('parseCompareIds returns empty ids for missing or garbage input', () => {
  assert.deepEqual(parseCompareIds(undefined), { ids: [], truncated: false });
  assert.deepEqual(parseCompareIds(null), { ids: [], truncated: false });
  assert.deepEqual(parseCompareIds(''), { ids: [], truncated: false });
  assert.deepEqual(parseCompareIds('s=&s=,,, &s=%20'), { ids: [], truncated: false });
  assert.deepEqual(parseCompareIds({ nope: true }), { ids: [], truncated: false });
});

test('parseCompareIds accepts a leading-question-mark query string', () => {
  assert.deepEqual(parseCompareIds('?s=alpha&s=beta').ids, ['alpha', 'beta']);
});

test('compareHref encodeURIComponents ids including colon-form', () => {
  assert.equal(compareHref(['10.0.0.1:7777', 'b']), '/compare?s=10.0.0.1%3A7777&s=b');
  assert.equal(compareHref([]), '/compare');
});

test('renderComparePage empty state explains the tool and shows the add form', () => {
  const html = renderComparePage({ ids: [], roster: [server('1')], rosterAvailable: true });
  assert.match(html, /side by side/i);
  assert.match(html, /checkbox column/);
  assert.match(html, /search box below/);
  assert.match(html, /<form method="GET" action="\/compare"/);
  assert.match(html, /name="q"/);
  assert.match(html, />Search</);
  assert.doesNotMatch(html, /class="compare-table"/);
});

test('renderComparePage roster-unavailable state does not crash', () => {
  const html = renderComparePage({ ids: ['1', '2'], rosterAvailable: false });
  assert.match(html, /discovery service may not be running/);
  assert.doesNotMatch(html, /class="compare-table"/);
});

test('renderComparePage renders a 2-server table with attributes as rows in order', () => {
  const html = renderComparePage({
    ids: ['1', '2'],
    roster: [
      server('1', { name: 'Alpha', map: 'TheIsland_WP' }),
      server('2', { name: 'Bravo', map: 'Extinction_WP', gameMode: 'pvp' }),
    ],
    rosterAvailable: true,
  });
  assert.match(html, />Alpha</);
  assert.match(html, />Bravo</);
  const order = ATTR_ROWS.map((r) => r.label);
  let last = -1;
  for (const label of order) {
    const at = html.indexOf(`<th scope="row">${label}</th>`);
    assert.ok(at !== -1, `missing row ${label}`);
    assert.ok(at > last, `${label} out of order`);
    last = at;
  }
  const status = rowCells(html, 'Status');
  assert.equal(status[0].text, 'Online');
  const mode = rowCells(html, 'Mode');
  assert.equal(mode[0].text, 'PvE');
  assert.equal(mode[1].text, 'PvP');
});

test('renderComparePage uses effective ping (wildcardReportedPing else ping)', () => {
  const html = renderComparePage({
    ids: ['1', '2'],
    roster: [
      server('1', { wildcardReportedPing: 12, ping: 99 }),
      server('2', { wildcardReportedPing: undefined, ping: 55 }),
    ],
    rosterAvailable: true,
  });
  const ping = rowCells(html, 'Ping');
  assert.equal(ping[0].text, '12');
  assert.equal(ping[1].text, '55');
});

test('renderComparePage degrades missing fields to em-dashes', () => {
  const html = renderComparePage({
    ids: ['1', '2'],
    roster: [
      { id: '1', name: 'Sparse' },
      server('2'),
    ],
    rosterAvailable: true,
  });
  assert.equal(rowCells(html, 'Map')[0].text, '\u2014');
  assert.equal(rowCells(html, 'Mode')[0].text, '\u2014');
  assert.equal(rowCells(html, 'Platform')[0].text, '\u2014');
  assert.equal(rowCells(html, 'Region')[0].text, '\u2014');
  assert.equal(rowCells(html, 'Ping')[0].text, '\u2014');
  assert.equal(rowCells(html, 'Uptime')[0].text, '\u2014');
  assert.equal(rowCells(html, 'Rank')[0].text, '\u2014');
  assert.equal(rowCells(html, 'Cluster')[0].text, '\u2014');
  assert.equal(rowCells(html, 'Version')[0].text, '\u2014');
  assert.equal(rowCells(html, 'Day')[0].text, '\u2014');
  assert.equal(rowCells(html, 'Players')[0].text, '\u2014 / \u2014');
  assert.equal(rowCells(html, 'Status')[0].text, 'Offline');
});

test('renderComparePage unknown-id column is linked, marked unlisted, and dashed', () => {
  const html = renderComparePage({
    ids: ['gone:7777'],
    roster: [server('1')],
    rosterAvailable: true,
  });
  assert.match(html, /href="\/servers\/gone%3A7777"/);
  assert.match(html, />gone:7777</);
  assert.match(html, /Not currently listed/);
  for (const row of ATTR_ROWS) {
    const cells = rowCells(html, row.label);
    assert.equal(cells.length, 1);
    assert.equal(cells[0].text, '\u2014');
  }
});

test('renderComparePage highlights best ping (lowest), uptime (highest), and rank only', () => {
  const html = renderComparePage({
    ids: ['1', '2'],
    roster: [
      server('1', { name: 'A', wildcardReportedPing: 20, uptimePercent: 70, rank: 5, rankScore: 40 }),
      server('2', { name: 'B', wildcardReportedPing: 80, uptimePercent: 99, rank: 1, rankScore: 90 }),
    ],
    rosterAvailable: true,
  });
  const ping = rowCells(html, 'Ping');
  assert.match(ping[0].attrs, /compare-best/);
  assert.doesNotMatch(ping[1].attrs, /compare-best/);
  const uptime = rowCells(html, 'Uptime');
  assert.doesNotMatch(uptime[0].attrs, /compare-best/);
  assert.match(uptime[1].attrs, /compare-best/);
  const rank = rowCells(html, 'Rank');
  assert.doesNotMatch(rank[0].attrs, /compare-best/);
  assert.match(rank[1].attrs, /compare-best/);
  assert.equal(rank[1].text, '1');
  for (const label of ['Status', 'Map', 'Mode', 'Platform', 'Region', 'Players', 'Cluster', 'Version', 'Day']) {
    for (const cell of rowCells(html, label)) {
      assert.doesNotMatch(cell.attrs, /compare-best/, `${label} should not highlight`);
    }
  }
});

test('renderComparePage rank highlight uses highest rankScore when positions are absent', () => {
  const html = renderComparePage({
    ids: ['1', '2'],
    roster: [
      server('1', { rank: undefined, rankScore: 40 }),
      server('2', { rank: undefined, rankScore: 90 }),
    ],
    rosterAvailable: true,
  });
  const rank = rowCells(html, 'Rank');
  assert.equal(rank[0].text, '40');
  assert.equal(rank[1].text, '90');
  assert.doesNotMatch(rank[0].attrs, /compare-best/);
  assert.match(rank[1].attrs, /compare-best/);
});

test('renderComparePage highlights ties and skips a row with fewer than two numeric values', () => {
  const html = renderComparePage({
    ids: ['1', '2', '3'],
    roster: [
      server('1', { wildcardReportedPing: 30, uptimePercent: undefined }),
      server('2', { wildcardReportedPing: 30, uptimePercent: 88 }),
      server('3', { wildcardReportedPing: undefined, ping: undefined, uptimePercent: undefined }),
    ],
    rosterAvailable: true,
  });
  const ping = rowCells(html, 'Ping');
  assert.match(ping[0].attrs, /compare-best/);
  assert.match(ping[1].attrs, /compare-best/);
  assert.doesNotMatch(ping[2].attrs, /compare-best/);
  const uptime = rowCells(html, 'Uptime');
  assert.equal(uptime.filter((c) => /compare-best/.test(c.attrs)).length, 0);
});

test('renderComparePage remove links drop that id and omit q', () => {
  const html = renderComparePage({
    ids: ['1', '2'],
    q: 'island',
    roster: [server('1', { name: 'Alpha' }), server('2', { name: 'Bravo' })],
    rosterAvailable: true,
  });
  assert.match(html, /class="compare-remove" href="\/compare\?s=2"/);
  assert.match(html, /class="compare-remove" href="\/compare\?s=1"/);
  const removes = html.match(/class="compare-remove"[^>]*>/g).join('\n');
  assert.doesNotMatch(removes, /[?&]q=/);
});

test('renderComparePage add form carries hidden s inputs for the current selection', () => {
  const html = renderComparePage({
    ids: ['1', '2'],
    roster: [server('1'), server('2')],
    rosterAvailable: true,
  });
  assert.match(html, /<input type="hidden" name="s" value="1">/);
  assert.match(html, /<input type="hidden" name="s" value="2">/);
  assert.match(html, /name="q"/);
  assert.match(html, />Search</);
});

test('renderComparePage search is case-insensitive, excludes selected, and caps at 10', () => {
  const roster = [
    server('sel', { name: 'Island Selected' }),
    ...Array.from({ length: 12 }, (_, i) => server(`m${i}`, { name: `ISLAND Match ${i}`, map: 'TheIsland_WP', playersNow: i })),
    server('other', { name: 'NoSuchClusterBox' }),
  ];
  const html = renderComparePage({
    ids: ['sel'],
    q: 'island',
    roster,
    rosterAvailable: true,
  });
  const list = html.match(/<ul class="compare-matches">[\s\S]*?<\/ul>/)[0];
  assert.doesNotMatch(list, /Island Selected/);
  assert.doesNotMatch(list, /s=sel&amp;s=sel/);
  assert.match(html, /ISLAND Match 0/);
  assert.match(html, /href="\/compare\?s=sel&amp;s=m0"/);
  assert.match(html, /TheIsland_WP/);
  const matchHrefs = html.match(/href="\/compare\?s=sel&amp;s=m\d+"/g) || [];
  assert.equal(matchHrefs.length, 10);
  assert.doesNotMatch(html, /ISLAND Match 10/);
  assert.doesNotMatch(list, /NoSuchClusterBox/);
  assert.doesNotMatch(html, /NoSuchClusterBox/);
});

test('renderComparePage search with no matches shows a one-line note', () => {
  const html = renderComparePage({
    ids: ['1'],
    q: 'zzzz',
    roster: [server('1'), server('2', { name: 'Bravo' })],
    rosterAvailable: true,
  });
  assert.match(html, /no servers match/);
});

test('renderComparePage at 4 servers hides the add form and shows the cap note', () => {
  const html = renderComparePage({
    ids: ['1', '2', '3', '4'],
    q: 'island',
    roster: [server('1'), server('2'), server('3'), server('4'), server('5', { name: 'Island Extra' })],
    rosterAvailable: true,
    truncated: false,
  });
  assert.match(html, /capped at 4/);
  assert.doesNotMatch(html, /class="compare-add"/);
  assert.doesNotMatch(html, /Island Extra/);
});

test('renderComparePage truncated flag shows the cap note', () => {
  const html = renderComparePage({
    ids: ['1', '2', '3', '4'],
    roster: [server('1'), server('2'), server('3'), server('4')],
    rosterAvailable: true,
    truncated: true,
  });
  assert.match(html, /capped at 4/);
});

test('renderComparePage single-column hint and unnamed header', () => {
  const html = renderComparePage({
    ids: ['1'],
    roster: [{ id: '1', map: 'TheIsland_WP' }],
    rosterAvailable: true,
  });
  assert.match(html, /work best with 2 or more/);
  assert.match(html, /\(unnamed\)/);
});

test('renderComparePage title, meta description, and currentPath', () => {
  const html = renderComparePage({ ids: [], roster: [], rosterAvailable: true });
  assert.match(html, /<title>ArkHelper \u2014 Compare Servers<\/title>/);
  assert.match(html, /<meta name="description" content="Side-by-side official ARK: Survival Ascended server comparison/);
  assert.match(html, /href="\/compare"/);
});
