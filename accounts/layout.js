#!/usr/bin/env node
'use strict';

/**
 * layout.js
 *
 * Shared page shell: header nav, footer sitemap, and the document
 * wrapper. Pages pass inner HTML + a currentPath so the active nav
 * link can be marked. Badge/heatmap SVG endpoints do not use this.
 */

const { THEME_CSS, escapeHtml } = require('./theme.js');
const { MAP_REGISTRY } = require('./maps.js');

const GITHUB_REPO = 'https://github.com/gitstump/ArkHelper';

const LIST_NAV = [
  { href: '/lists/official-pve', label: 'Official PvE' },
  { href: '/lists/official-pvp', label: 'Official PvP' },
  { href: '/lists/low-ping', label: 'Low Ping' },
  { href: '/lists/most-populated', label: 'Most Populated' },
  { href: '/lists/recently-wiped', label: 'Recently Wiped' },
  { href: '/lists/available-now', label: 'Available Now' },
];

const STATS_NAV = [
  { href: '/rankings', label: 'Rankings', match: ['/rankings'] },
  { href: '/leaderboards', label: 'Leaderboards', match: ['/leaderboards'] },
  { href: '/leaderboards/map-uptime', label: 'Map Uptime' },
  { href: '/leaderboards/pve-vs-pvp', label: 'PvE vs PvP' },
  { href: '/is-ark-down', label: 'Is ARK Down', match: ['/is-ark-down', '/status'] },
];

const MAPS_NAV = [...MAP_REGISTRY]
  .sort((a, b) => a.displayName.localeCompare(b.displayName))
  .map((m) => ({ href: `/maps/${m.slug}`, label: m.displayName }));

const NAV = [
  {
    label: 'Servers',
    match: ['/', '/servers', '/lists'],
    children: [{ href: '/servers', label: 'Server Browser', match: ['/', '/servers'] }, ...LIST_NAV],
  },
  {
    label: 'Maps',
    match: ['/maps'],
    columns: 2,
    children: MAPS_NAV,
  },
  {
    label: 'Stats',
    match: ['/rankings', '/stats', '/leaderboards', '/is-ark-down', '/status'],
    children: STATS_NAV,
  },
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
  return `<details class="nav-drop">
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
      <span>Logged in as <strong>${escapeHtml(name)}</strong>${
        account.discordId != null ? ` (Discord ID: ${escapeHtml(String(account.discordId))})` : ''
      }</span>
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

function renderFooter(live) {
  const listItems = LIST_NAV.map((item) => `<li><a href="${item.href}">${escapeHtml(item.label)}</a></li>`).join('');
  const statsItems = STATS_NAV.map((item) => `<li><a href="${item.href}">${escapeHtml(item.label)}</a></li>`).join('');
  return `<footer class="site-footer">
  <div class="footer-inner">
    <div class="footer-cols">
      <div>
        <h2>Server Tools</h2>
        <ul>
          <li><a href="/servers">Browser</a></li>
          <li><a href="/maps">Maps</a></li>
          ${listItems}
          ${statsItems}
          <li><a href="/favorites">Favorites</a></li>
          <li><a href="/servers">Presets</a></li>
        </ul>
      </div>
      <div>
        <h2>Project</h2>
        <ul>
          <li><a href="/">About</a></li>
          <li><a href="${GITHUB_REPO}">GitHub</a></li>
        </ul>
      </div>
      <div>
        <h2>Live</h2>
        <ul>
          <li>Tracking <span class="num">${formatLiveCount(live)}</span> official servers</li>
          <li>Last updated <span class="num">${formatLiveUpdated(live)}</span></li>
        </ul>
      </div>
    </div>
    <p class="footer-disclaimer">Independent service, not affiliated with Studio Wildcard.</p>
  </div>
</footer>`;
}

function renderPage({ title, description, currentPath, account, live, extraCss = '', body }) {
  const metaDescription = description
    ? `<meta name="description" content="${escapeHtml(description)}">\n`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title || 'ArkHelper')}</title>
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
        <a class="wordmark" href="/">ArkHelper</a>
        <p class="tagline">Live tracking for the ARK: Survival Ascended network.</p>
      </div>
      <nav class="nav">${renderNav(currentPath)}</nav>
      ${renderAuth(account)}
    </div>
  </header>
  <main class="site-main">
    ${body}
  </main>
  ${renderFooter(live)}
</div>
</body>
</html>`;
}

module.exports = {
  GITHUB_REPO,
  NAV,
  LIST_NAV,
  STATS_NAV,
  MAPS_NAV,
  pathMatches,
  renderNav,
  renderAuth,
  renderFooter,
  renderPage,
};
