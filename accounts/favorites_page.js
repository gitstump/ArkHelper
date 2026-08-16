#!/usr/bin/env node
'use strict';

/**
 * favorites_page.js
 *
 * "My Favorites" — the whole reason accounts exist. Lists whichever
 * servers the logged-in account has favorited, matched against the
 * live roster (a favorite is stored as just a server id in the DB;
 * this page joins that against current roster data to show live
 * status, not stale info from whenever it was favorited).
 */

const { renderServerRow, PAGE_CSS } = require('./server_browser.js');
const { escapeHtml } = require('./home_page.js');
const { renderPage } = require('./layout.js');

function renderFavoritesPage({ loggedIn, servers, rosterAvailable, staleFavoriteIds = [], account = null, live = null }) {
  let inner;
  if (!loggedIn) {
    inner = `<h1>Favorites</h1>
  <p>You need to be logged in to have favorites. <a href="/auth/discord/login">Login with Discord</a></p>`;
  } else if (!rosterAvailable) {
    inner = `<h1>Favorites</h1>
  <p>Server data isn't available right now (the discovery service may not be running), so favorites can't be matched to live status.</p>`;
  } else {
    const staleNote =
      staleFavoriteIds.length > 0
        ? `<p class="note">${escapeHtml(String(staleFavoriteIds.length))} favorited server(s) no longer appear in the official list (likely gone offline or renamed) and aren't shown below.</p>`
        : '';
    const table =
      servers.length > 0
        ? `<table class="browser-table">
      <thead><tr><th></th><th>Name</th><th>Map</th><th>Day</th><th>Version</th><th>Players</th><th>Ping</th><th>Uptime</th><th>Rank</th></tr></thead>
      <tbody>${servers.map(renderServerRow).join('')}</tbody>
    </table>`
        : `<p>You haven't favorited any servers yet. Find one on the <a href="/servers">server browser</a> and favorite it from its detail page.</p>`;
    inner = `<h1>Favorites</h1>${staleNote}${table}`;
  }

  return renderPage({
    title: 'ArkHelper \u2014 Favorites',
    currentPath: '/favorites',
    account,
    live,
    extraCss: PAGE_CSS,
    body: inner,
  });
}

module.exports = { renderFavoritesPage };
