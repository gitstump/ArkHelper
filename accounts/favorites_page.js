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

const { renderServerRow, STYLE } = require('./server_browser.js');
const { escapeHtml } = require('./home_page.js');

function renderFavoritesPage({ loggedIn, servers, rosterAvailable, staleFavoriteIds = [] }) {
  if (!loggedIn) {
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>ArkHelper \u2014 Favorites</title>${STYLE}</head>
<body>
  <h1><a href="/">ArkHelper</a> &rsaquo; Favorites</h1>
  <p>You need to be logged in to have favorites. <a href="/auth/discord/login">Login with Discord</a></p>
</body></html>`;
  }

  if (!rosterAvailable) {
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>ArkHelper \u2014 Favorites</title>${STYLE}</head>
<body>
  <h1><a href="/">ArkHelper</a> &rsaquo; Favorites</h1>
  <p>Server data isn't available right now (the discovery service may not be running), so favorites can't be matched to live status.</p>
</body></html>`;
  }

  const staleNote =
    staleFavoriteIds.length > 0
      ? `<p class="note">${escapeHtml(String(staleFavoriteIds.length))} favorited server(s) no longer appear in the official list (likely gone offline or renamed) and aren't shown below.</p>`
      : '';

  const body =
    servers.length > 0
      ? `<table>
      <thead><tr><th>Name</th><th>Map</th><th>Mode</th><th>Players</th><th>Day</th><th>Cluster</th><th></th></tr></thead>
      <tbody>${servers.map(renderServerRow).join('')}</tbody>
    </table>`
      : `<p>You haven't favorited any servers yet. Find one on the <a href="/servers">server browser</a> and favorite it from its detail page.</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ArkHelper \u2014 Favorites</title>
${STYLE}
</head>
<body>
  <h1><a href="/">ArkHelper</a> &rsaquo; Favorites</h1>
  ${staleNote}
  ${body}
</body>
</html>`;
}

module.exports = { renderFavoritesPage };
