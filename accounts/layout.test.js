'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderPage, renderNav, renderAuth, renderFooter, pathMatches, GITHUB_REPO, LIST_NAV, STATS_NAV } = require('./layout.js');

test('renderPage includes a meta description when one is provided', () => {
  const html = renderPage({ title: 'Low ping', description: 'Find ARK low ping servers.', currentPath: '/', body: '<p>x</p>' });
  assert.match(html, /<meta name="description" content="Find ARK low ping servers.">/);
  assert.match(html, /<meta property="og:description" content="Find ARK low ping servers.">/);
});

test('renderPage head includes favicon links and og:title matching the page title', () => {
  const html = renderPage({ title: 'Low ping \u2014 ArkHelper', currentPath: '/', body: '<p>x</p>' });
  const headEnd = html.indexOf('</head>');
  const head = html.slice(0, headEnd);
  assert.match(head, /<link rel="icon" href="\/favicon.ico" sizes="48x48">/);
  assert.match(head, /<link rel="icon" type="image\/png" sizes="32x32" href="\/assets\/favicon-32.png">/);
  assert.match(head, /<link rel="icon" type="image\/png" sizes="16x16" href="\/assets\/favicon-16.png">/);
  assert.match(head, /<link rel="apple-touch-icon" sizes="180x180" href="\/assets\/apple-touch-icon.png">/);
  assert.match(head, /<title>Low ping \u2014 ArkHelper<\/title>/);
  assert.match(head, /<meta property="og:title" content="Low ping \u2014 ArkHelper">/);
});

test('renderPage wordmark links to home', () => {
  const html = renderPage({ title: 'ArkHelper', currentPath: '/rankings', body: '<p>x</p>' });
  assert.match(html, /<a class="wordmark" href="\/"><img src="\/assets\/icon-192\.png" alt="ArkHelper" width="48" height="48" class="wordmark-logo"><\/a>/);
  assert.match(html, /Live tracking for the ARK: Survival Ascended network/);
});

test('renderPage wraps body in the shared shell with theme CSS', () => {
  const html = renderPage({ title: 'ArkHelper', currentPath: '/', body: '<p>hello</p>' });
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<title>ArkHelper<\/title>/);
  assert.match(html, /--accent:/);
  assert.match(html, /class="wordmark"/);
  assert.match(html, /Live tracking for the ARK: Survival Ascended network/);
  assert.match(html, /<p>hello<\/p>/);
  assert.match(html, /\u00A9 \d{4} ArkHelper\. All trademarks are property of their respective owners\./);
  assert.match(html, /ArkHelper is an independent, unofficial fan service and is not affiliated with, endorsed by, or sponsored by Studio Wildcard, Snail Games, or any related entities\./);
  assert.match(html, /<\/html>$/);
});

test('renderPage hides the tagline at 1280px so nav stays on one row', () => {
  const html = renderPage({ title: 'ArkHelper', currentPath: '/', body: '<p>hello</p>' });
  assert.match(html, /@media \(max-width: 1280px\)[\s\S]*?\.tagline \{ display: none; \}/);
});

test('renderNav groups Servers, Maps, and Stats into details dropdowns and keeps Alerts and Favorites as links', () => {
  const html = renderNav('/rankings');
  assert.match(html, /<details class="nav-drop" name="mainnav">/);
  assert.match(html, /<summary class="active">Stats<\/summary>/);
  assert.match(html, /href="\/servers"/);
  assert.match(html, /href="\/compare"/);
  assert.match(html, /href="\/lists\/official-pve"/);
  assert.match(html, /href="\/lists\/low-ping"/);
  assert.match(html, /href="\/lists\/available-now"/);
  assert.match(html, /href="\/maps\/the-island"/);
  assert.match(html, /href="\/maps\/aberration"/);
  assert.match(html, /href="\/maps\/genesis"/);
  assert.match(html, /class="nav-menu nav-menu-cols"/);
  assert.match(html, /href="\/rankings"/);
  assert.match(html, /href="\/mods"/);
  assert.match(html, /href="\/leaderboards"/);
  assert.match(html, /href="\/leaderboards\/map-uptime"/);
  assert.match(html, /href="\/leaderboards\/pve-vs-pvp"/);
  assert.match(html, /href="\/leaderboards\/regions"/);
  assert.match(html, /href="\/is-ark-down"/);
  assert.match(html, /href="\/rates"/);
  assert.match(html, /href="\/news"/);
  assert.match(html, /href="\/favorites"/);
  assert.match(html, /href="\/guides"/);
  assert.match(html, /class="active" href="\/rankings"/);
  const navMods = html.match(/href="\/mods"/g) || [];
  assert.equal(navMods.length, 1);
  assert.doesNotMatch(html, /Leaderboards &amp; Stats/);
  assert.match(html, />Guides<\/a>/);
  assert.match(html, /<summary class="">Tools<\/summary>/);
  assert.match(html, /href="\/tools\/demolish-refund"/);
  assert.match(html, />Alerts<\/a>/);
  assert.match(html, />Favorites<\/a>/);
  assert.match(html, /href="\/alerts"/);
  const serversAt = html.indexOf('>Servers</summary>');
  const mapsAt = html.indexOf('>Maps</summary>');
  const statsAt = html.indexOf('>Stats</summary>');
  const guidesAt = html.indexOf('>Guides</a>');
  const toolsAt = html.indexOf('>Tools</summary>');
  const alertsAt = html.indexOf('>Alerts</a>');
  const favAt = html.indexOf('>Favorites</a>');
  assert.ok(serversAt !== -1 && mapsAt !== -1 && statsAt !== -1);
  assert.ok(serversAt < mapsAt && mapsAt < statsAt);
  assert.ok(statsAt < guidesAt && guidesAt < toolsAt && toolsAt < alertsAt && alertsAt < favAt);
});

test('renderNav marks the Maps group active on per-map pages', () => {
  const html = renderNav('/maps/the-island');
  assert.match(html, /<summary class="active">Maps<\/summary>/);
  assert.match(html, /class="active" href="\/maps\/the-island"/);
});

test('renderNav marks the Servers group active on the compare page', () => {
  const html = renderNav('/compare');
  assert.match(html, /<summary class="active">Servers<\/summary>/);
  assert.match(html, /class="active" href="\/compare"/);
});

test('renderNav marks Guides active on the index and a guide page', () => {
  const index = renderNav('/guides');
  assert.match(index, /class="active" href="\/guides"/);
  const page = renderNav('/guides/beginners');
  assert.match(page, /class="active" href="\/guides"/);
  assert.doesNotMatch(page, /<summary class="active">Guides<\/summary>/);
});

test('renderNav marks the Tools group active on the demolish-refund page', () => {
  const html = renderNav('/tools/demolish-refund');
  assert.match(html, /<summary class="active">Tools<\/summary>/);
  assert.match(html, /class="active" href="\/tools\/demolish-refund"/);
});

test('renderNav marks Alerts active on the feed and keeps it a plain link', () => {
  const html = renderNav('/alerts');
  assert.match(html, /class="active" href="\/alerts"/);
  assert.doesNotMatch(html, /<summary class="active">Alerts<\/summary>/);
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

test('renderAuth shows the username and logout without Discord ID when logged in', () => {
  const html = renderAuth({ username: 'brian', discordId: '42' });
  assert.match(html, /title="Logged in via Discord"/);
  assert.match(html, />brian</);
  assert.match(html, /action="\/auth\/logout"/);
  assert.match(html, /method="POST"/);
  assert.match(html, />Log out</);
  assert.doesNotMatch(html, /Logged in as/);
  assert.doesNotMatch(html, /Discord ID/);
  assert.doesNotMatch(html, /42/);
});

test('renderAuth escapes a hostile username', () => {
  const html = renderAuth({ username: '<script>evil()</script>', discordId: '1' });
  assert.doesNotMatch(html, /<script>evil\(\)<\/script>/);
  assert.match(html, /&lt;script&gt;evil\(\)&lt;\/script&gt;/);
});

test('renderFooter lists the sitemap columns, GitHub repo, and live counts', () => {
  const html = renderFooter({ totalOfficial: 3179, generatedAt: '2026-08-15T16:52:24.124Z' });
  assert.match(html, /<h2>Servers<\/h2>/);
  assert.match(html, /<h2>Lists<\/h2>/);
  assert.match(html, /<h2>Stats<\/h2>/);
  assert.match(html, /<h2>Project<\/h2>/);
  assert.match(html, /href="\/servers">Browser/);
  assert.match(html, /href="\/compare">Compare/);
  assert.match(html, /href="\/maps">Maps/);
  assert.match(html, /href="\/guides">Guides/);
  assert.match(html, /href="\/tools\/demolish-refund">Demolish Refund/);
  assert.match(html, /href="\/lists\/official-pve">Official PvE/);
  assert.match(html, /href="\/lists\/official-pvp">Official PvP/);
  assert.match(html, /href="\/lists\/low-ping">Low Ping/);
  assert.match(html, /href="\/lists\/most-populated">Most Populated/);
  assert.match(html, /href="\/lists\/recently-wiped">Recently Wiped/);
  assert.match(html, /href="\/lists\/available-now">Available Now/);
  assert.match(html, /href="\/rankings">Rankings/);
  assert.match(html, /href="\/mods">Mods/);
  assert.match(html, /href="\/leaderboards">Leaderboards/);
  assert.match(html, /href="\/leaderboards\/map-uptime">Map Uptime/);
  assert.match(html, /href="\/leaderboards\/pve-vs-pvp">PvE vs PvP/);
  assert.match(html, /href="\/leaderboards\/regions">Regions/);
  assert.match(html, /href="\/is-ark-down">Is ARK Down/);
  assert.match(html, /href="\/rates">Rates/);
  assert.match(html, /href="\/news">News/);
  assert.match(html, /href="\/favorites">Favorites/);
  assert.match(html, /href="\/alerts">Alerts/);
  assert.match(html, /href="\/servers">Presets/);
  const favLi = html.indexOf('href="/favorites">Favorites');
  const alertsLi = html.indexOf('href="/alerts">Alerts');
  assert.ok(favLi !== -1 && alertsLi !== -1 && favLi < alertsLi);
  assert.match(html, /href="\/">About/);
  assert.match(html, /Includes GeoLite2 data created by MaxMind, available from/);
  assert.match(html, /href="https:\/\/www\.maxmind\.com"/);
  assert.match(html, new RegExp(GITHUB_REPO.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(html, /Tracking <span class="num">3179<\/span> official servers/);
  assert.match(html, /2026-08-15T16:52:24\.124Z/);
  for (const item of [...LIST_NAV, ...STATS_NAV]) {
    const matches = html.match(new RegExp(`href="${item.href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'g')) || [];
    assert.equal(matches.length, 1, `${item.href} should appear exactly once in the footer`);
  }
});

test('renderFooter honors an explicit year in the legal band', () => {
  const html = renderFooter(null, 2031);
  assert.match(html, /\u00A9 2031 ArkHelper\. All trademarks are property of their respective owners\./);
});

test('renderFooter shows em dashes when live data is missing', () => {
  const html = renderFooter(null);
  assert.match(html, /\u2014/);
});

test('nav and footer each show Mods exactly once', () => {
  const nav = renderNav('/mods');
  const footer = renderFooter(null);
  assert.equal((nav.match(/href="\/mods"/g) || []).length, 1);
  assert.equal((footer.match(/href="\/mods"/g) || []).length, 1);
  assert.match(nav, /<summary class="active">Stats<\/summary>/);
  assert.match(nav, /class="active" href="\/mods"/);
});

test('renderNav puts name="mainnav" on every header-nav details dropdown', () => {
  const html = renderNav('/');
  const tags = html.match(/<details\b[^>]*>/g) || [];
  assert.equal(tags.length, 4);
  for (const tag of tags) {
    assert.match(tag, /class="nav-drop"/);
    assert.match(tag, /name="mainnav"/);
  }
});

test('renderPage includes the nav-close script exactly once', () => {
  const html = renderPage({ title: 'ArkHelper', currentPath: '/', body: '<p>hello</p>' });
  const scripts = html.match(/<script\b/g) || [];
  assert.equal(scripts.length, 1);
  assert.match(html, /header\.site-header nav\.nav details\[name="mainnav"\]/);
  assert.match(html, /addEventListener\('click'/);
  assert.match(html, /addEventListener\('keydown'/);
  assert.match(html, /Escape/);
  assert.match(html, /removeAttribute\('open'\)/);
  // Footer must not pick up nav details or a second copy of the script.
  const footerStart = html.indexOf('<footer');
  const footerEnd = html.indexOf('</footer>') + '</footer>'.length;
  const footer = html.slice(footerStart, footerEnd);
  assert.doesNotMatch(footer, /<details/);
  assert.doesNotMatch(footer, /<script/);
});

test('renderPage does not wrap body-level details with name="mainnav"', () => {
  const html = renderPage({
    title: 'ArkHelper',
    currentPath: '/',
    body: '<details class="faq"><summary>Q</summary><p>A</p></details>',
  });
  const named = html.match(/<details\b[^>]*name="mainnav"[^>]*>/g) || [];
  assert.equal(named.length, 4);
  assert.match(html, /<details class="faq">/);
});
