#!/usr/bin/env node
'use strict';

/**
 * server_detail.js
 *
 * The per-server page — reached by clicking a server name in the
 * browser. Shows everything the roster knows about it, uptime %, a
 * simple history table, alert configuration (saves preference, doesn't
 * dispatch yet), peak-times and downtime-pattern heatmaps, a wipe/
 * version change log, and an embeddable status badge.
 *
 * Same pattern as the rest of the accounts service: pure render
 * function for testability, server-side HTML, no client JS needed.
 */

const { escapeHtml } = require('./home_page.js');
const { renderPeakTimesHeatmap, renderDowntimeHeatmap, hasAnyData } = require('./heatmap_svg.js');
const { buildEmbedSnippets } = require('./badge.js');

const STYLE = `<style>
  body { background:#141210; color:#e8e6e3; font-family: system-ui, -apple-system, sans-serif; max-width: 700px; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
  h1, h1 a { color: #f2b544; text-decoration: none; }
  a { color: #7fd0ff; }
  table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
  th, td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid #2a2620; }
  .facts td:first-child { color: #b8b3a8; width: 40%; }
  .note { color: #b8b3a8; font-size: 0.9rem; }
  .alert-form { display: flex; flex-direction: column; gap: 0.6rem; max-width: 400px; }
  .alert-form label { display: flex; align-items: center; gap: 0.5rem; }
  .alert-form input[type="number"] { width: 5rem; background:#1c1a16; color:#e8e6e3; border:1px solid #443f36; padding:0.3rem; border-radius:4px; }
  button { background:#2a2620; color:#e8e6e3; border:1px solid #443f36; padding: 0.4rem 1rem; border-radius: 4px; cursor:pointer; }
  .heatmap-wrap { overflow-x: auto; margin-top: 0.5rem; }
  .embed-box { background:#1c1a16; border:1px solid #443f36; padding:0.6rem; border-radius:4px; font-family: monospace; font-size:0.85rem; overflow-x:auto; white-space: pre; margin: 0.3rem 0; }
  .change-log li { margin-bottom: 0.3rem; }
  .rank-badge { display: inline-block; background:#2a2620; border:1px solid #443f36; color:#f2b544; padding: 0.15rem 0.55rem; border-radius: 999px; font-size: 0.85rem; font-variant-numeric: tabular-nums; margin-left: 0.5rem; vertical-align: middle; }
  .rank-badge a { color: #f2b544; text-decoration: none; }
</style>`;

function renderServerNotFoundPage(serverId) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>ArkHelper \u2014 Server not found</title>${STYLE}</head>
<body>
  <h1><a href="/">ArkHelper</a> &rsaquo; <a href="/servers">Servers</a> &rsaquo; Not found</h1>
  <p>No server with ID ${escapeHtml(String(serverId))} was found in the current roster. It may have gone offline, been renamed, or the discovery service hasn't refreshed recently.</p>
</body></html>`;
}

function renderRosterUnavailablePage() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>ArkHelper \u2014 Server</title>${STYLE}</head>
<body>
  <h1><a href="/">ArkHelper</a> &rsaquo; <a href="/servers">Servers</a></h1>
  <p>Server data isn't available right now (the discovery service may not be running).</p>
</body></html>`;
}

function renderServerDetailPage({ server, uptime, history, loggedIn, isFavorited, alertSettings, changeLog, peakTimes, downtimePatterns, badgeUrl }) {
  const modList = server.modIds && server.modIds.length ? server.modIds.map((id) => escapeHtml(id)).join(', ') : 'None (vanilla server)';

  const favoriteSection = !loggedIn
    ? `<p><a href="/auth/discord/login">Login with Discord</a> to favorite this server.</p>`
    : isFavorited
    ? `<form method="POST" action="/favorites/${encodeURIComponent(server.id)}/remove"><button type="submit">\u2605 Remove from favorites</button></form>`
    : `<form method="POST" action="/favorites/${encodeURIComponent(server.id)}"><button type="submit">\u2606 Add to favorites</button></form>`;

  const a = alertSettings || { notifyOnline: false, notifyDown: false, capacityThresholdPct: '', minFreeSlots: '' };
  const alertSection = !loggedIn
    ? '' // login prompt already shown above; no need to repeat it
    : `<h2>Alerts</h2>
    <p class="note">Configures what you'd want to be notified about for this server. Delivery (actually sending a Discord notification) isn't wired up yet — this saves your preference for when it is.</p>
    <form method="POST" action="/alerts/${encodeURIComponent(server.id)}" class="alert-form">
      <label><input type="checkbox" name="notifyDown" ${a.notifyDown ? 'checked' : ''}> Notify when this server goes down</label>
      <label><input type="checkbox" name="notifyOnline" ${a.notifyOnline ? 'checked' : ''}> Notify when it comes back online</label>
      <label>Capacity alert threshold (%): <input type="number" name="capacityThresholdPct" min="0" max="100" value="${escapeHtml(String(a.capacityThresholdPct ?? ''))}"></label>
      <label>Alert when free slots drop below: <input type="number" name="minFreeSlots" min="0" value="${escapeHtml(String(a.minFreeSlots ?? ''))}"></label>
      <button type="submit">Save alert settings</button>
    </form>`;

  const uptimeSection =
    uptime && uptime.uptimePercent !== null
      ? `<p><strong>${escapeHtml(String(uptime.uptimePercent))}%</strong> present across the last ${escapeHtml(String(uptime.totalRuns))} discovery runs ` +
        `(${escapeHtml(String(uptime.presentCount))} of them). <span class="note">This reflects how often the server appeared in Wildcard's official list, not a direct ping — see the note below.</span></p>`
      : `<p class="note">Not enough history yet to compute uptime — this builds up automatically as the discovery service keeps running.</p>`;

  const historySection =
    history && history.length > 0
      ? `<table>
        <thead><tr><th>Seen at</th><th>Players</th><th>Day</th></tr></thead>
        <tbody>${history
          .slice(-20)
          .reverse()
          .map((h) => `<tr><td>${escapeHtml(h.seenAt)}</td><td>${escapeHtml(String(h.playersNow ?? '\u2014'))}/${escapeHtml(String(h.maxPlayers ?? '\u2014'))}</td><td>${escapeHtml(String(h.day ?? '\u2014'))}</td></tr>`)
          .join('')}</tbody>
      </table>
      <p class="note">Showing the most recent ${Math.min(history.length, 20)} of ${history.length} recorded snapshots.</p>`
      : `<p class="note">No recorded history yet.</p>`;

  const changeLogSection =
    changeLog && changeLog.length > 0
      ? `<ul class="change-log">${changeLog
          .map((c) =>
            c.changeType === 'wipe'
              ? `<li>\u{1F4A5} <strong>Wipe detected</strong> \u2014 day count reset from ${escapeHtml(c.oldValue)} to ${escapeHtml(c.newValue)} <span class="note">(${escapeHtml(c.seenAt)})</span></li>`
              : `<li>\u{1F504} <strong>Version changed</strong> \u2014 ${escapeHtml(c.oldValue)} \u2192 ${escapeHtml(c.newValue)} <span class="note">(${escapeHtml(c.seenAt)})</span></li>`
          )
          .join('')}</ul>`
      : `<p class="note">No version changes or wipes detected yet.</p>`;

  const peakTimesSection =
    peakTimes && hasAnyData(peakTimes)
      ? `<div class="heatmap-wrap">${renderPeakTimesHeatmap(peakTimes)}</div><p class="note">Average player count by hour of week (UTC). Darker = fewer players, brighter green = more.</p>`
      : `<p class="note">Not enough history yet to show peak-time patterns.</p>`;

  const downtimeSection =
    downtimePatterns && hasAnyData(downtimePatterns)
      ? `<div class="heatmap-wrap">${renderDowntimeHeatmap(downtimePatterns)}</div><p class="note">% of discovery runs the server was absent, by hour of week (UTC). Darker = more reliable, brighter red = more downtime at that time.</p>`
      : `<p class="note">Not enough history yet to show downtime patterns.</p>`;

  const embedSection = badgeUrl
    ? (() => {
        const snippets = buildEmbedSnippets(badgeUrl, `/servers/${encodeURIComponent(server.id)}`);
        return `<p><img src="${escapeHtml(badgeUrl)}" alt="Live status badge"></p>
        <p class="note">Markdown:</p><div class="embed-box">${escapeHtml(snippets.markdown)}</div>
        <p class="note">HTML:</p><div class="embed-box">${escapeHtml(snippets.html)}</div>`;
      })()
    : '';

  const rankBadge =
    typeof server.rankScore === 'number'
      ? `<span class="rank-badge"><a href="/rankings" title="Composite rank score out of 100">#${escapeHtml(String(server.rank ?? '\u2014'))} \u00b7 ${escapeHtml(String(server.rankScore))}</a></span>`
      : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ArkHelper \u2014 ${escapeHtml(server.name || 'Server')}</title>
${STYLE}
</head>
<body>
  <h1><a href="/">ArkHelper</a> &rsaquo; <a href="/servers">Servers</a> &rsaquo; ${escapeHtml(server.name || '(unnamed)')}${rankBadge}</h1>

  ${favoriteSection}

  <table class="facts">
    <tr><td>Status</td><td>${server.playersNow !== null ? 'Registered / active' : 'Unknown'}</td></tr>
    <tr><td>Players</td><td>${escapeHtml(String(server.playersNow ?? '\u2014'))} / ${escapeHtml(String(server.maxPlayers ?? '\u2014'))}</td></tr>
    <tr><td>Map</td><td>${escapeHtml(server.map || '\u2014')}</td></tr>
    <tr><td>Mode</td><td>${server.gameMode === 'pve' ? 'PvE' : server.gameMode === 'pvp' ? 'PvP' : '\u2014'}</td></tr>
    <tr><td>Day</td><td>${escapeHtml(String(server.day ?? '\u2014'))}</td></tr>
    <tr><td>Version</td><td>${escapeHtml(server.version || '\u2014')}</td></tr>
    <tr><td>Cluster</td><td>${escapeHtml(server.clusterId || '\u2014')}</td></tr>
    <tr><td>Platforms</td><td>${escapeHtml(server.platformType || '\u2014')}</td></tr>
    <tr><td>Password protected</td><td>${server.hasPassword ? 'Yes' : 'No'}</td></tr>
    <tr><td>BattlEye</td><td>${server.battleye ? 'Enabled' : 'Disabled'}</td></tr>
    <tr><td>IP : Port</td><td>${escapeHtml(server.ip || '\u2014')} : ${escapeHtml(String(server.port ?? '\u2014'))}</td></tr>
    <tr><td>Mods</td><td>${modList}</td></tr>
    ${server.country ? `<tr><td>Country</td><td>${escapeHtml(server.countryName || server.country)}</td></tr>` : ''}
  </table>

  <h2>Uptime</h2>
  ${uptimeSection}

  <h2>Recent history</h2>
  ${historySection}

  <h2>Activity log</h2>
  ${changeLogSection}

  <h2>Peak times</h2>
  ${peakTimesSection}

  <h2>Downtime patterns</h2>
  ${downtimeSection}

  <h2>Embed this server's status</h2>
  ${embedSection}

  ${alertSection}
</body>
</html>`;
}

module.exports = {
  renderServerDetailPage,
  renderServerNotFoundPage,
  renderRosterUnavailablePage,
};
