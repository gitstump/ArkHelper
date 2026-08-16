#!/usr/bin/env node
'use strict';

/**
 * home_page.js
 *
 * The landing page at "/" — shows login state and, if the discovery
 * service happens to be running, live roster stats. Deliberately plain
 * server-rendered HTML with a couple of inline <form> POSTs — no
 * client-side JS needed for this MVP, no framework dependency.
 *
 * renderHomepage is a pure function (string in, string out) so it's
 * fully testable without spinning up a server. fetchRosterMetaSafe
 * never throws — a discovery service that's down or slow degrades to
 * "stats unavailable" rather than breaking the page.
 */

const { realHttpGetLocal, fetchJsonSafe } = require('./local_fetch.js');

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderHomepage({ account, rosterMeta }) {
  const authSection = account
    ? `<p>Logged in as <strong>${escapeHtml(account.username || 'unknown')}</strong> (Discord ID: ${escapeHtml(String(account.discordId))})</p>
       <form method="POST" action="/auth/logout"><button type="submit">Log out</button></form>`
    : `<p><a href="/auth/discord/login">Login with Discord</a></p>`;

  const statsSection = rosterMeta
    ? `<p>Tracking <strong>${escapeHtml(String(rosterMeta.totalOfficial))}</strong> official servers ` +
      `(${escapeHtml(String(rosterMeta.pveCount))} PvE / ${escapeHtml(String(rosterMeta.pvpCount))} PvP). ` +
      `Last updated ${escapeHtml(String(rosterMeta.generatedAt))}.</p>`
    : `<p>Server roster data isn't available right now (the discovery service may not be running).</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ArkHelper</title>
<style>
  body { background:#141210; color:#e8e6e3; font-family: system-ui, -apple-system, sans-serif; max-width: 640px; margin: 4rem auto; padding: 0 1rem; line-height: 1.5; }
  h1 { color: #f2b544; }
  a { color: #7fd0ff; }
  button { background:#2a2620; color:#e8e6e3; border:1px solid #443f36; padding: 0.5rem 1rem; border-radius: 4px; cursor:pointer; font-size: 1rem; }
  button:hover { background:#332e26; }
</style>
</head>
<body>
  <h1>ArkHelper</h1>
  <p><a href="/servers">Browse servers &rsaquo;</a> &middot; <a href="/stats">Stats &amp; leaderboards &rsaquo;</a> &middot; <a href="/favorites">My favorites &rsaquo;</a></p>
  ${authSection}
  ${statsSection}
</body>
</html>`;
}

// ---------------------------------------------------------------------
// Roster stats (best-effort — never throws). Thin alias over the shared
// local_fetch helper — kept as its own name here since "roster meta" is
// what this module actually asks for, even though the underlying fetch
// logic is generic and shared with server_browser.js now.
// ---------------------------------------------------------------------
const fetchRosterMetaSafe = fetchJsonSafe;

module.exports = {
  escapeHtml,
  renderHomepage,
  fetchRosterMetaSafe,
  realHttpGetLocal,
};
