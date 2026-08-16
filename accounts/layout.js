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

const GITHUB_REPO = 'https://github.com/gitstump/ArkHelper';

const NAV = [
  { href: '/servers', label: 'Servers', match: ['/', '/servers'] },
  { href: '/rankings', label: 'Rankings', match: ['/rankings'] },
  { href: '/stats', label: 'Stats', match: ['/stats'] },
  { href: '/is-ark-down', label: 'Is ARK Down', match: ['/is-ark-down', '/status'] },
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

function renderNav(currentPath) {
  return NAV.map((item) => {
    const active = pathMatches(currentPath, item.match) ? ' active' : '';
    return `<a class="${active.trim()}" href="${item.href}">${escapeHtml(item.label)}</a>`;
  }).join('');
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
  return `<footer class="site-footer">
  <div class="footer-inner">
    <div class="footer-cols">
      <div>
        <h2>Server Tools</h2>
        <ul>
          <li><a href="/servers">Browser</a></li>
          <li><a href="/rankings">Rankings</a></li>
          <li><a href="/stats">Stats</a></li>
          <li><a href="/is-ark-down">Is ARK Down</a></li>
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

function renderPage({ title, currentPath, account, live, extraCss = '', body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title || 'ArkHelper')}</title>
<style>
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
  pathMatches,
  renderNav,
  renderAuth,
  renderFooter,
  renderPage,
};
