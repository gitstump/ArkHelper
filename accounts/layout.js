#!/usr/bin/env node
'use strict';

/**
 * layout.js
 *
 * Shared page shell: header nav, footer sitemap, and the document
 * wrapper. Pages pass inner HTML + a currentPath so the active nav
 * link can be marked. Badge/heatmap SVG endpoints do not use this.
 *
 * Shared client-side JS lives here: a small inline script that closes
 * header-nav <details> on outside click / Escape. Pages may pass extraJs
 * for their own vanilla behaviour (the tool calculators).
 * Nav stays fully usable with JS disabled (native <details> + name=).
 */

const { THEME_CSS, escapeHtml } = require('./theme.js');
const { MAP_REGISTRY } = require('./maps.js');
const { siteOrigin } = require('./origin.js');

const GITHUB_REPO = 'https://github.com/gitstump/ArkHelper';

const LIST_NAV = [
  { href: '/lists/official-pve', label: 'Official PvE' },
  { href: '/lists/official-pvp', label: 'Official PvP' },
  { href: '/lists/low-ping', label: 'Low Ping' },
  { href: '/lists/most-populated', label: 'Most Populated' },
  { href: '/lists/recently-wiped', label: 'Recently Wiped' },
  { href: '/lists/available-now', label: 'Available Now' },
];

const TOOLS_NAV = [
  { href: '/tools/crafting-cost', label: 'Crafting Cost', match: ['/tools/crafting-cost'] },
  { href: '/tools/demolish-refund', label: 'Demolish Refund', match: ['/tools/demolish-refund'] },
];

const STATS_NAV = [
  { href: '/rankings', label: 'Rankings', match: ['/rankings'] },
  { href: '/mods', label: 'Mods', match: ['/mods'] },
  { href: '/leaderboards', label: 'Leaderboards', match: ['/leaderboards'] },
  { href: '/leaderboards/map-uptime', label: 'Map Uptime' },
  { href: '/leaderboards/pve-vs-pvp', label: 'PvE vs PvP' },
  { href: '/leaderboards/regions', label: 'Regions' },
  { href: '/is-ark-down', label: 'Is ARK Down', match: ['/is-ark-down', '/status'] },
  { href: '/rates', label: 'Rates' },
  { href: '/news', label: 'News' },
];

const MAPS_NAV = [...MAP_REGISTRY]
  .sort((a, b) => a.displayName.localeCompare(b.displayName))
  .map((m) => ({ href: `/maps/${m.slug}`, label: m.displayName }));

const NAV = [
  {
    label: 'Servers',
    match: ['/', '/servers', '/lists', '/compare'],
    children: [
      { href: '/servers', label: 'Server Browser', match: ['/', '/servers'] },
      { href: '/compare', label: 'Compare' },
      ...LIST_NAV,
    ],
  },
  {
    label: 'Maps',
    match: ['/maps'],
    columns: 2,
    children: MAPS_NAV,
  },
  {
    label: 'Stats',
    match: ['/rankings', '/stats', '/leaderboards', '/is-ark-down', '/status', '/rates', '/news', '/mods'],
    children: STATS_NAV,
  },
  { href: '/guides', label: 'Guides', match: ['/guides'] },
  { href: '/colors', label: 'Colors', match: ['/colors'] },
  {
    label: 'Tools',
    match: ['/tools'],
    children: TOOLS_NAV,
  },
  { href: '/alerts', label: 'Alerts', match: ['/alerts'] },
  { href: '/favorites', label: 'Favorites', match: ['/favorites'] },
];

function pathMatches(currentPath, match) {
  const path = currentPath || '/';
  for (const prefix of match) {
    if (path === prefix) return true;
    if (prefix !== '/' && path.startsWith(`${prefix}/`)) return true;
  }
  return false;
}

function renderNavLink(item, currentPath) {
  const match = item.match || [item.href];
  const active = pathMatches(currentPath, match) ? ' active' : '';
  return `<a class="${active.trim()}" href="${item.href}">${escapeHtml(item.label)}</a>`;
}

function renderNavGroup(item, currentPath) {
  const groupActive = pathMatches(currentPath, item.match) ? ' active' : '';
  const menuClass = item.columns === 2 ? 'nav-menu nav-menu-cols' : 'nav-menu';
  const links = item.children.map((child) => renderNavLink(child, currentPath)).join('');
  return `<details class="nav-drop" name="mainnav">
      <summary class="${groupActive.trim()}">${escapeHtml(item.label)}</summary>
      <div class="${menuClass}">${links}</div>
    </details>`;
}

function renderNav(currentPath) {
  return NAV.map((item) => (item.children ? renderNavGroup(item, currentPath) : renderNavLink(item, currentPath))).join('');
}

function renderAuth(account) {
  if (account) {
    const name = account.username || 'unknown';
    return `<div class="auth">
      <span title="Logged in via Discord">${escapeHtml(name)}</span>
      <form method="POST" action="/auth/logout"><button type="submit">Log out</button></form>
    </div>`;
  }
  return `<div class="auth"><a href="/auth/discord/login">Login with Discord</a></div>`;
}

function formatLiveCount(live) {
  if (live && live.totalOfficial != null) return escapeHtml(String(live.totalOfficial));
  return '\u2014';
}

function formatLiveUpdated(live) {
  if (live && live.generatedAt) return escapeHtml(String(live.generatedAt));
  return '\u2014';
}

function renderFooter(live, year = new Date().getFullYear()) {
  const listItems = LIST_NAV.map((item) => `<li><a href="${item.href}">${escapeHtml(item.label)}</a></li>`).join('');
  const statsItems = STATS_NAV.map((item) => `<li><a href="${item.href}">${escapeHtml(item.label)}</a></li>`).join('');
  return `<footer class="site-footer">
  <div class="footer-inner">
    <div class="footer-cols">
      <div>
        <h2>Servers</h2>
        <ul>
          <li><a href="/servers">Browser</a></li>
          <li><a href="/compare">Compare</a></li>
          <li><a href="/maps">Maps</a></li>
          <li><a href="/guides">Guides</a></li>
          <li><a href="/colors">Colors</a></li>
          <li><a href="/tools/crafting-cost">Crafting Cost</a></li>
          <li><a href="/tools/demolish-refund">Demolish Refund</a></li>
          <li><a href="/favorites">Favorites</a></li>
          <li><a href="/alerts">Alerts</a></li>
          <li><a href="/servers">Presets</a></li>
        </ul>
      </div>
      <div>
        <h2>Lists</h2>
        <ul>
          ${listItems}
        </ul>
      </div>
      <div>
        <h2>Stats</h2>
        <ul>
          ${statsItems}
        </ul>
      </div>
      <div>
        <h2>Project</h2>
        <ul>
          <li><a href="/">About</a></li>
          <li><a href="${GITHUB_REPO}">GitHub</a></li>
          <li>Tracking <span class="num">${formatLiveCount(live)}</span> official servers</li>
          <li>Last updated <span class="num">${formatLiveUpdated(live)}</span></li>
        </ul>
        <p class="footer-attrib">Includes GeoLite2 data created by MaxMind, available from <a href="https://www.maxmind.com">https://www.maxmind.com</a></p>
      </div>
    </div>
    <div class="footer-disclaimer">
      <p>\u00A9 ${year} ArkHelper. All trademarks are property of their respective owners.</p>
      <p>ArkHelper is an independent, unofficial fan service and is not affiliated with, endorsed by, or sponsored by Studio Wildcard, Snail Games, or any related entities.</p>
    </div>
  </div>
</footer>`;
}

function renderPage({ title, description, currentPath, account, live, extraCss = '', extraJs = '', body, year, origin }) {
  const pageTitle = title || 'ArkHelper';
  const escapedTitle = escapeHtml(pageTitle);
  const metaDescription = description
    ? `<meta name="description" content="${escapeHtml(description)}">
<meta property="og:description" content="${escapeHtml(description)}">
`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/assets/favicon-16.png">
<link rel="apple-touch-icon" sizes="180x180" href="/assets/apple-touch-icon.png">
<meta property="og:site_name" content="ArkHelper">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapedTitle}">
<meta property="og:image" content="${escapeHtml(siteOrigin(origin))}/assets/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<title>${escapedTitle}</title>
${metaDescription}<style>
${THEME_CSS}
${extraCss}
</style>
</head>
<body>
<div class="site">
  <header class="site-header">
    <div class="header-inner">
      <div class="brand">
        <a class="wordmark" href="/"><img src="/assets/icon-192.png" alt="ArkHelper" width="48" height="48" class="wordmark-logo"></a>
        <p class="tagline">Live tracking for the ARK: Survival Ascended network.</p>
      </div>
      <nav class="nav">${renderNav(currentPath)}</nav>
      ${renderAuth(account)}
    </div>
  </header>
  <main class="site-main">
    ${body}
  </main>
  ${renderFooter(live, year)}
</div>
<script>
document.addEventListener('click', function (e) {
  document.querySelectorAll('header.site-header nav.nav details[name="mainnav"][open]').forEach(function (d) {
    if (!d.contains(e.target)) d.removeAttribute('open');
  });
});
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    document.querySelectorAll('header.site-header nav.nav details[name="mainnav"][open]').forEach(function (d) {
      d.removeAttribute('open');
    });
  }
});
</script>
${extraJs ? `<script>\n${extraJs}\n</script>` : ''}
</body>
</html>`;
}

module.exports = {
  GITHUB_REPO,
  NAV,
  LIST_NAV,
  STATS_NAV,
  TOOLS_NAV,
  MAPS_NAV,
  pathMatches,
  renderNav,
  renderAuth,
  renderFooter,
  renderPage,
};
