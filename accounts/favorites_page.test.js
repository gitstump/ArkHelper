'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderFavoritesPage } = require('./favorites_page.js');

function makeServer(overrides = {}) {
  return { id: '1', name: 'EU-PVE-TheIsland5313', map: 'TheIsland_WP', gameMode: 'pve', playersNow: 5, maxPlayers: 70, day: 100, clusterId: 'C', hasPassword: false, ...overrides };
}

test('renderFavoritesPage prompts login when logged out', () => {
  const html = renderFavoritesPage({ loggedIn: false, servers: [], rosterAvailable: true });
  assert.match(html, /need to be logged in/);
  assert.match(html, /href="\/auth\/discord\/login"/);
});

test('renderFavoritesPage shows the roster-unavailable message when discovery is down', () => {
  const html = renderFavoritesPage({ loggedIn: true, servers: [], rosterAvailable: false });
  assert.match(html, /discovery service may not be running/);
});

test('renderFavoritesPage shows an empty-state message when logged in with no favorites', () => {
  const html = renderFavoritesPage({ loggedIn: true, servers: [], rosterAvailable: true });
  assert.match(html, /haven't favorited any servers yet/);
  assert.match(html, /href="\/servers"/);
});

test('renderFavoritesPage lists favorited servers with a working detail link', () => {
  const html = renderFavoritesPage({ loggedIn: true, servers: [makeServer()], rosterAvailable: true });
  assert.match(html, /EU-PVE-TheIsland5313/);
  assert.match(html, /href="\/servers\/1"/);
});

test('renderFavoritesPage notes stale favorites that no longer appear in the roster', () => {
  const html = renderFavoritesPage({ loggedIn: true, servers: [], rosterAvailable: true, staleFavoriteIds: ['gone-1', 'gone-2'] });
  assert.match(html, /2 favorited server\(s\) no longer appear/);
});

test('renderFavoritesPage shows no stale note when there are no stale favorites', () => {
  const html = renderFavoritesPage({ loggedIn: true, servers: [makeServer()], rosterAvailable: true, staleFavoriteIds: [] });
  assert.doesNotMatch(html, /no longer appear/);
});
