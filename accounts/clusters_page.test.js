'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  clusterPathSegment,
  clusterHref,
  clusterLinkHtml,
  serversForCluster,
  computeClusterIndex,
  formatMapsCell,
  renderClusterIndexPage,
  renderClusterPage,
  renderClusterNotFoundPage,
} = require('./clusters_page.js');

function fixtureRoster() {
  return [
    {
      id: 'island-pve',
      name: 'EU-PVE-TheIsland5313',
      map: 'TheIsland_WP',
      gameMode: 'pve',
      playersNow: 10,
      maxPlayers: 70,
      clusterId: 'C1',
      uptimePercent: 90,
      wildcardReportedPing: 20,
      rankScore: 80,
      rank: 2,
    },
    {
      id: 'ab-pvp',
      name: 'NA-PVP-Aberration1',
      map: 'Aberration_WP',
      gameMode: 'pvp',
      playersNow: 20,
      maxPlayers: 70,
      clusterId: 'C1',
      uptimePercent: 80,
      wildcardReportedPing: 40,
      rankScore: 70,
      rank: 4,
    },
    {
      id: 'gen-pve',
      name: 'EU-PVE-Genesis99',
      map: 'Genesis_WP',
      gameMode: 'pve',
      playersNow: 5,
      maxPlayers: 50,
      clusterId: 'C2',
      uptimePercent: 100,
      wildcardReportedPing: 10,
      rankScore: 95,
      rank: 1,
    },
    {
      id: 'no-cluster',
      name: 'Orphan',
      map: 'TheIsland_WP',
      gameMode: 'pve',
      playersNow: 99,
      maxPlayers: 70,
      uptimePercent: 50,
    },
    {
      id: 'c1-undefined-players',
      name: 'EU-PVE-TheIsland-Empty',
      map: 'TheIsland_WP',
      gameMode: 'pve',
      playersNow: undefined,
      maxPlayers: 70,
      clusterId: 'C1',
      uptimePercent: 70,
    },
  ];
}

test('computeClusterIndex excludes servers with no clusterId', () => {
  const index = computeClusterIndex(fixtureRoster());
  assert.equal(index.length, 2);
  assert.ok(!index.some((c) => c.clusterId == null));
  assert.ok(!index.some((c) => c.playersOnline === 99));
});

test('computeClusterIndex counts undefined playersNow as zero, not NaN', () => {
  const index = computeClusterIndex(fixtureRoster());
  const c1 = index.find((c) => c.clusterId === 'C1');
  assert.equal(c1.serverCount, 3);
  assert.equal(c1.playersOnline, 30);
  assert.equal(Number.isNaN(c1.playersOnline), false);
  assert.equal(c1.capacity, 210);
  assert.equal(c1.avgUptimePercent, 80);
  assert.deepEqual(c1.maps, ['Aberration_WP', 'TheIsland_WP']);
  assert.equal(c1.mapCount, 2);
  assert.equal(c1.pve, 2);
  assert.equal(c1.pvp, 1);
});

test('computeClusterIndex sorts by players online descending and is not capped', () => {
  const servers = Array.from({ length: 12 }, (_, i) => ({
    clusterId: `C${i}`,
    playersNow: i,
    maxPlayers: 70,
    map: 'TheIsland_WP',
    uptimePercent: 90,
  }));
  const index = computeClusterIndex(servers);
  assert.equal(index.length, 12);
  assert.equal(index[0].clusterId, 'C11');
  assert.equal(index[0].playersOnline, 11);
  assert.equal(index[11].clusterId, 'C0');
});

test('computeClusterIndex treats a missing maxPlayers as zero capacity, not NaN', () => {
  const index = computeClusterIndex([{ clusterId: 'X', playersNow: 4, map: 'M' }]);
  assert.equal(index[0].capacity, 0);
  assert.equal(index[0].fillPercent, null);
  assert.equal(Number.isNaN(index[0].capacity), false);
});

test('serversForCluster keeps only the requested cluster', () => {
  const c1 = serversForCluster(fixtureRoster(), 'C1');
  assert.equal(c1.length, 3);
  assert.ok(c1.every((s) => s.clusterId === 'C1'));
  assert.equal(serversForCluster(fixtureRoster(), 'C2').length, 1);
  assert.deepEqual(serversForCluster(null, 'C1'), []);
  assert.deepEqual(serversForCluster(fixtureRoster(), ''), []);
});

test('clusterPathSegment encodes URL-unsafe IDs and refuses a slash', () => {
  assert.equal(clusterPathSegment('PVECrossplay'), 'PVECrossplay');
  assert.equal(clusterPathSegment('C 1'), 'C%201');
  assert.equal(clusterPathSegment('C%1'), 'C%251');
  assert.equal(clusterPathSegment('foo/bar'), null);
  assert.equal(clusterPathSegment(''), null);
  assert.equal(clusterPathSegment(null), null);
  assert.equal(clusterHref('C 1'), '/clusters/C%201');
  assert.equal(clusterHref('foo/bar'), null);
});

test('clusterLinkHtml links a round-trippable ID and leaves a slash ID as text', () => {
  assert.match(clusterLinkHtml('C1'), /href="\/clusters\/C1"/);
  assert.doesNotMatch(clusterLinkHtml('foo/bar'), /<a /);
  assert.match(clusterLinkHtml('foo/bar'), /foo\/bar/);
});

test('formatMapsCell shows names when few and a count when many', () => {
  assert.equal(formatMapsCell(['TheIsland_WP', 'Aberration_WP']), 'The Island, Aberration');
  assert.equal(formatMapsCell(['A', 'B', 'C', 'D', 'E']), '5 maps');
  assert.equal(formatMapsCell([]), '\u2014');
});

test('renderClusterIndexPage lists every cluster and links round-trippable IDs', () => {
  const html = renderClusterIndexPage({ rosterAvailable: true, clusters: computeClusterIndex(fixtureRoster()) });
  assert.match(html, /<title>ARK Clusters/);
  assert.match(html, /href="\/clusters\/C1"/);
  assert.match(html, /href="\/clusters\/C2"/);
  const c1At = html.indexOf('>C1<');
  const c2At = html.indexOf('>C2<');
  assert.ok(c1At !== -1 && c2At !== -1 && c1At < c2At);
});

test('renderClusterIndexPage renders an unlinkable slash ID as plain text', () => {
  const html = renderClusterIndexPage({
    rosterAvailable: true,
    clusters: computeClusterIndex([{ clusterId: 'foo/bar', playersNow: 1, maxPlayers: 10, map: 'M' }]),
  });
  assert.match(html, /foo\/bar/);
  assert.doesNotMatch(html, /href="\/clusters\/foo/);
});

test('renderClusterIndexPage degrades when the roster is unavailable', () => {
  const html = renderClusterIndexPage({ rosterAvailable: false });
  assert.match(html, /isn't available right now/);
  assert.doesNotMatch(html, /<thead>/);
});

test('renderClusterPage lists member server names and cluster aggregates', () => {
  const servers = serversForCluster(fixtureRoster(), 'C1');
  const cluster = computeClusterIndex(servers)[0];
  const html = renderClusterPage({ rosterAvailable: true, cluster, servers });
  assert.match(html, /<title>ARK C1 Cluster/);
  assert.match(html, /EU-PVE-TheIsland5313/);
  assert.match(html, /NA-PVP-Aberration1/);
  assert.match(html, /EU-PVE-TheIsland-Empty/);
  assert.doesNotMatch(html, /EU-PVE-Genesis99/);
  assert.doesNotMatch(html, /Orphan/);
  assert.match(html, /href="\/servers\/island-pve"/);
  assert.match(html, />PvE</);
  assert.match(html, />PvP</);
});

test('renderClusterPage uses em-dashes for missing member fields and does not throw', () => {
  const servers = [{ id: 'x', name: 'Bare', clusterId: 'Z' }];
  const cluster = computeClusterIndex([{ clusterId: 'Z', playersNow: undefined }])[0];
  assert.doesNotThrow(() => renderClusterPage({ rosterAvailable: true, cluster, servers }));
  const html = renderClusterPage({ rosterAvailable: true, cluster, servers });
  assert.match(html, /Bare/);
  assert.match(html, /\u2014/);
});

test('renderClusterPage degrades when the roster is unavailable', () => {
  const html = renderClusterPage({ rosterAvailable: false, cluster: { clusterId: 'C1' } });
  assert.match(html, /isn't available right now/);
});

test('renderClusterNotFoundPage is a shell-wrapped 404 body that lists clusters', () => {
  const html = renderClusterNotFoundPage({
    clusterId: 'not-real',
    clusters: [{ clusterId: 'C1' }, { clusterId: 'C2' }],
  });
  assert.match(html, /Cluster not found/);
  assert.match(html, /not-real/);
  assert.match(html, /href="\/clusters\/C1"/);
  assert.match(html, /href="\/clusters\/C2"/);
  assert.match(html, /href="\/clusters"/);
});
