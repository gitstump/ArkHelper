'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { rankingFromRoster, renderRankingsPage, TOP_N } = require('./rankings_page.js');

function rankedServer(id, score, overrides = {}) {
  return {
    id,
    name: `Server ${id}`,
    rankScore: score,
    rank: overrides.rank,
    rankComponents: {
      reliability: 40,
      connection: 25,
      activity: 25,
      confidence: 10,
      ...overrides.components,
    },
    ...overrides,
  };
}

test('rankingFromRoster sorts by rankScore descending and caps at the limit', () => {
  const servers = [
    rankedServer('low', 10),
    rankedServer('high', 90),
    rankedServer('mid', 50),
    { id: 'unscored', name: 'No score yet' },
  ];
  const result = rankingFromRoster(servers, { limit: 2 });
  assert.deepEqual(result.servers.map((s) => s.serverId), ['high', 'mid']);
  assert.equal(result.totalRanked, 3);
  assert.equal(result.servers[0].rankScore, 90);
});

test('rankingFromRoster defaults to the top 100', () => {
  const servers = Array.from({ length: 120 }, (_, i) => rankedServer(String(i), 120 - i, { rank: i + 1 }));
  const result = rankingFromRoster(servers);
  assert.equal(result.servers.length, TOP_N);
  assert.equal(result.totalRanked, 120);
});

test('rankingFromRoster handles a missing or empty roster without throwing', () => {
  assert.deepEqual(rankingFromRoster(null).servers, []);
  assert.deepEqual(rankingFromRoster([]).servers, []);
});

test('renderRankingsPage shows a fallback when the roster is unavailable', () => {
  const html = renderRankingsPage({ rosterAvailable: false });
  assert.match(html, /discovery service may not be running/);
});

test('renderRankingsPage shows an empty-state note when nothing is scored yet', () => {
  const html = renderRankingsPage({ rosterAvailable: true, ranking: { servers: [], totalRanked: 0 } });
  assert.match(html, /No rank scores yet/);
});

test('renderRankingsPage renders name, score, and the four component values', () => {
  const html = renderRankingsPage({
    rosterAvailable: true,
    ranking: {
      totalRanked: 1,
      servers: [
        {
          rank: 1,
          serverId: 'abc123',
          name: 'NA-PVE-TheIsland5313',
          rankScore: 87.5,
          components: { reliability: 40, connection: 20, activity: 17.5, confidence: 10 },
        },
      ],
    },
  });
  assert.match(html, /NA-PVE-TheIsland5313/);
  assert.match(html, /href="\/servers\/abc123"/);
  assert.match(html, /87\.5/);
  assert.match(html, />40</);
  assert.match(html, />20</);
  assert.match(html, /17\.5/);
  assert.match(html, /How the score is built/);
  assert.match(html, /Reliability/);
  assert.match(html, /Connection/);
  assert.match(html, /Activity/);
  assert.match(html, /Confidence/);
});

test('renderRankingsPage escapes a hostile server name', () => {
  const html = renderRankingsPage({
    rosterAvailable: true,
    ranking: {
      totalRanked: 1,
      servers: [{ rank: 1, serverId: 'x', name: '<script>evil()</script>', rankScore: 1, components: {} }],
    },
  });
  assert.doesNotMatch(html, /<script>evil\(\)<\/script>/);
  assert.match(html, /&lt;script&gt;evil\(\)&lt;\/script&gt;/);
});

test('renderRankingsPage does not throw when serverId is missing', () => {
  assert.doesNotThrow(() =>
    renderRankingsPage({
      rosterAvailable: true,
      ranking: { totalRanked: 1, servers: [{ rank: 1, rankScore: 80, components: { reliability: 40, connection: 20, activity: 10, confidence: 10 } }] },
    })
  );
});
