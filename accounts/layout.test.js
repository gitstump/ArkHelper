'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderPage, renderNav, renderAuth, renderFooter, pathMatches, GITHUB_REPO } = require('./layout.js');

test('renderPage includes a meta description when one is provided', () => {
  const html = renderPage({ title: 'Low ping', description: 'Find ARK low ping servers.', currentPath: '/', body: '<p>x</p>' });
  assert.match(html, /<meta name="description" content="Find ARK low ping servers.">/);
});

test('renderPage wordmark links to home', () => {
  const html = renderPage({ title: 'ArkHelper', currentPath: '/rankings', body: '<p>x</p>' });
  assert.match(html, /<a class="wordmark" href="\/">ArkHelper<\/a>/);
});

test('renderPage wraps body in the shared shell with theme CSS', () => {
  const html = renderPage({ title: 'ArkHelper', currentPath: '/', body: '<p>hello</p>' });
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<title>ArkHelper<\/title>/);
  assert.match(html, /--accent:/);
  assert.match(html, /class="wordmark"/);
  assert.match(html, /Live tracking for the ARK: Survival Ascended network/);
  assert.match(html, /<p>hello<\/p>/);
  assert.match(html, /Independent service, not affiliated with Studio Wildcard/);
  assert.match(html, /<\/html>$/);
});

test('renderNav groups Servers and Stats into details dropdowns and keeps Favorites as a link', () => {
  const html = renderNav('/rankings');
  assert.match(html, /<details class="nav-drop">/);
  assert.match(html, /<summary class="active">Stats<\/summary>/);
  assert.match(html, /href="\/servers"/);
  assert.match(html, /href="\/lists\/official-pve"/);
  assert.match(html, /href="\/lists\/low-ping"/);
  assert.match(html, /href="\/lists\/available-now"/);
  assert.match(html, /href="\/rankings"/);
  assert.match(html, /href="\/leaderboards"/);
  assert.match(html, /href="\/leaderboards\/map-uptime"/);
  assert.match(html, /href="\/leaderboards\/pve-vs-pvp"/);
  assert.match(html, /href="\/is-ark-down"/);
  assert.match(html, /href="\/favorites"/);
  assert.match(html, /class="active" href="\/rankings"/);
  assert.doesNotMatch(html, /Leaderboards &amp; Stats/);
  assert.match(html, />Favorites<\/a>/);
});

test('renderNav marks the Servers group active on derived list pages', () => {
  const html = renderNav('/lists/low-ping');
  assert.match(html, /<summary class="active">Servers<\/summary>/);
  assert.match(html, /class="active" href="\/lists\/low-ping"/);
});

test('pathMatches treats / and /servers as the Servers section, including detail paths', () => {
  assert.equal(pathMatches('/', ['/', '/servers']), true);
  assert.equal(pathMatches('/servers', ['/', '/servers']), true);
  assert.equal(pathMatches('/servers/abc', ['/', '/servers']), true);
  assert.equal(pathMatches('/lists/official-pve', ['/', '/servers', '/lists']), true);
  assert.equal(pathMatches('/stats', ['/', '/servers']), false);
  assert.equal(pathMatches('/status', ['/is-ark-down', '/status']), true);
});

test('renderAuth shows a Discord login link when logged out', () => {
  const html = renderAuth(null);
  assert.match(html, /Login with Discord/);
  assert.match(html, /href="\/auth\/discord\/login"/);
  assert.doesNotMatch(html, /Log out/);
});

test('renderAuth shows the Discord name, id, and logout form when logged in', () => {
  const html = renderAuth({ username: 'brian', discordId: '42' });
  assert.match(html, /Logged in as <strong>brian<\/strong>/);
  assert.match(html, /Discord ID: 42/);
  assert.match(html, /action="\/auth\/logout"/);
  assert.match(html, /method="POST"/);
});

test('renderAuth escapes a hostile username', () => {
  const html = renderAuth({ username: '<script>evil()</script>', discordId: '1' });
  assert.doesNotMatch(html, /<script>evil\(\)<\/script>/);
  assert.match(html, /&lt;script&gt;evil\(\)&lt;\/script&gt;/);
});

test('renderFooter lists the sitemap columns, GitHub repo, and live counts', () => {
  const html = renderFooter({ totalOfficial: 3179, generatedAt: '2026-08-15T16:52:24.124Z' });
  assert.match(html, /Server Tools/);
  assert.match(html, /href="\/servers">Browser/);
  assert.match(html, /href="\/lists\/official-pve">Official PvE/);
  assert.match(html, /href="\/lists\/official-pvp">Official PvP/);
  assert.match(html, /href="\/lists\/low-ping">Low Ping/);
  assert.match(html, /href="\/lists\/most-populated">Most Populated/);
  assert.match(html, /href="\/lists\/recently-wiped">Recently Wiped/);
  assert.match(html, /href="\/lists\/available-now">Available Now/);
  assert.match(html, /href="\/rankings">Rankings/);
  assert.match(html, /href="\/leaderboards">Leaderboards/);
  assert.match(html, /href="\/leaderboards\/map-uptime">Map Uptime/);
  assert.match(html, /href="\/leaderboards\/pve-vs-pvp">PvE vs PvP/);
  assert.match(html, /href="\/is-ark-down">Is ARK Down/);
  assert.match(html, /href="\/favorites">Favorites/);
  assert.match(html, /href="\/servers">Presets/);
  assert.match(html, /Project/);
  assert.match(html, /href="\/">About/);
  assert.match(html, new RegExp(GITHUB_REPO.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(html, /3179/);
  assert.match(html, /2026-08-15T16:52:24\.124Z/);
});

test('renderFooter shows em dashes when live data is missing', () => {
  const html = renderFooter(null);
  assert.match(html, /\u2014/);
});
