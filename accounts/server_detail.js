#!/usr/bin/env node
'use strict';

/**
 * server_detail.js
 *
 * The per-server page — reached by clicking a server name in the
 * browser. Shows everything the roster knows about it, uptime %, a
 * simple history table, a rank-neighborhood table, alert configuration
 * (feed + optional Discord webhook), peak-times and downtime-pattern
 * heatmaps, a wipe/version change log, and an embeddable status badge.
 *
 * Same pattern as the rest of the accounts service: pure render
 * function for testability, server-side HTML, no client JS needed.
 */

const { escapeHtml } = require('./home_page.js');
const { renderPage } = require('./layout.js');
const { renderPeakTimesHeatmap, renderDowntimeHeatmap, hasAnyData } = require('./heatmap_svg.js');
const { buildEmbedSnippets } = require('./badge.js');
const { platformBadge } = require('./server_browser.js');
const { flagEmoji, countryDisplayName, normalizeCountryCode } = require('./country.js');
const { siteOrigin } = require('./origin.js');

const PAGE_CSS = `
.facts td:first-child { color: var(--muted); width: 40%; }
.facts td:last-child { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.alert-form { display: flex; flex-direction: column; gap: var(--space-3); max-width: 400px; }
.alert-form label { display: flex; align-items: center; gap: var(--space-2); }
.alert-form input[type="number"] { width: 5rem; }
.heatmap-wrap { overflow-x: auto; margin-top: var(--space-2); }
.embed-box { background: var(--surface); border: 1px solid var(--border); padding: var(--space-3); border-radius: var(--radius); font-family: var(--font-mono); font-size: 0.85rem; overflow-x: auto; white-space: pre; margin: var(--space-1) 0; }
.change-log li { margin-bottom: var(--space-1); }
.rank-badge { display: inline-block; background: var(--surface); border: 1px solid var(--border); color: var(--accent); padding: 2px 10px; border-radius: 999px; font-size: 0.85rem; font-family: var(--font-mono); font-variant-numeric: tabular-nums; margin-left: var(--space-2); vertical-align: middle; }
.rank-badge a { color: var(--accent); text-decoration: none; }
.rank-current { background: var(--surface); box-shadow: inset 3px 0 0 var(--accent); }
`;

function renderServerNotFoundPage(serverId, { account = null, live = null } = {}) {
  return renderPage({
    title: 'ArkHelper \u2014 Server not found',
    currentPath: '/servers',
    account,
    live,
    extraCss: PAGE_CSS,
    body: `<h1><a href="/servers">Servers</a> &rsaquo; Not found</h1>
  <p>No server with ID ${escapeHtml(String(serverId))} was found in the current roster. It may have gone offline, been renamed, or the discovery service hasn't refreshed recently.</p>`,
  });
}

function renderRosterUnavailablePage({ account = null, live = null } = {}) {
  return renderPage({
    title: 'ArkHelper \u2014 Server',
    currentPath: '/servers',
    account,
    live,
    extraCss: PAGE_CSS,
    body: `<h1><a href="/servers">Servers</a></h1>
  <p>Server data isn't available right now (the discovery service may not be running).</p>`,
  });
}

function dashNumber(value, suffix = '') {
  return typeof value === 'number' && Number.isFinite(value) ? `${value}${suffix}` : '\u2014';
}

function lookupServerName(serverNames, serverId) {
  if (!serverNames || serverId == null) return null;
  const name = typeof serverNames.get === 'function' ? serverNames.get(serverId) : serverNames[serverId];
  return typeof name === 'string' && name ? name : null;
}

function renderRankNeighborhoodSection(rankNeighborhood, currentServerId, serverNames) {
  const ranking = rankNeighborhood && rankNeighborhood.ranking;
  if (!ranking) return '';
  const neighbors = ranking.neighbors;
  if (!Array.isArray(neighbors) || neighbors.length === 0) return '';

  const rows = neighbors
    .map((raw) => {
      const n = raw && typeof raw === 'object' ? raw : {};
      const id = n.serverId;
      const isCurrent = id != null && id === currentServerId;
      const name = lookupServerName(serverNames, id);
      const idLabel = id == null || id === '' ? '\u2014' : String(id);
      let serverCell;
      if (name) {
        serverCell = isCurrent
          ? escapeHtml(name)
          : `<a href="/servers/${encodeURIComponent(id)}">${escapeHtml(name)}</a>`;
      } else {
        const rawId = `<span class="note num">${escapeHtml(idLabel)}</span>`;
        serverCell = isCurrent || id == null || id === ''
          ? rawId
          : `<a href="/servers/${encodeURIComponent(id)}">${rawId}</a>`;
      }
      const rowClass = isCurrent ? ' class="rank-current"' : '';
      return `<tr${rowClass}><td class="num">${escapeHtml(dashNumber(n.rank))}</td><td>${serverCell}</td><td class="num">${escapeHtml(dashNumber(n.rankScore))}</td><td class="num">${escapeHtml(dashNumber(n.uptimePercent, '%'))}</td></tr>`;
    })
    .join('');

  return `<h2>Rank neighborhood</h2>
  <p>Ranked #${escapeHtml(String(ranking.rank ?? '\u2014'))} of ${escapeHtml(String(ranking.totalRanked ?? '\u2014'))} \u2014 top ${escapeHtml(String(ranking.percentile ?? '\u2014'))}%</p>
  <table>
    <thead><tr><th>#</th><th>Server</th><th>Score</th><th>Uptime</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderServerDetailPage({ server, uptime, history, loggedIn, isFavorited, alertSettings, changeLog, peakTimes, downtimePatterns, badgeUrl, account = null, live = null, origin, rankNeighborhood = null, serverNames = null } = {}) {
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
    <p class="note">Alerts for this server show up on the Alerts page. If you've saved a Discord webhook there, they are sent to that channel too.</p>
    <form method="POST" action="/alerts/${encodeURIComponent(server.id)}" class="alert-form">
      <label><input type="checkbox" name="notifyDown" ${a.notifyDown ? 'checked' : ''}> Notify when this server goes down</label>
      <label><input type="checkbox" name="notifyOnline" ${a.notifyOnline ? 'checked' : ''}> Notify when it comes back online</label>
      <label>Capacity alert threshold (%): <input type="number" name="capacityThresholdPct" min="0" max="100" value="${escapeHtml(String(a.capacityThresholdPct ?? ''))}"></label>
      <label>Alert when free slots drop below: <input type="number" name="minFreeSlots" min="0" value="${escapeHtml(String(a.minFreeSlots ?? ''))}"></label>
      <button type="submit">Save alert settings</button>
    </form>`;

  const rosterUptime = typeof server.uptimePercent === 'number' ? server.uptimePercent : null;
  const uptimeSection =
    uptime && uptime.uptimePercent !== null && uptime.uptimePercent !== undefined
      ? `<p><strong>${escapeHtml(String(uptime.uptimePercent))}%</strong> present across the last ${escapeHtml(String(uptime.totalRuns))} discovery runs ` +
        `(${escapeHtml(String(uptime.presentCount))} of them). <span class="note">This reflects how often the server appeared in Wildcard's official list, not a direct ping — see the note below.</span></p>`
      : rosterUptime !== null
        ? `<p><strong>${escapeHtml(String(rosterUptime))}%</strong> over the last 7 days of discovery history. <span class="note">This reflects how often the server appeared in Wildcard's official list, not a direct ping — see the note below.</span></p>`
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
        const base = siteOrigin(origin);
        const pageUrl = `${base}/servers/${encodeURIComponent(server.id)}`;
        const snippets = buildEmbedSnippets(`${pageUrl}/badge.svg`, pageUrl);
        return `<p><img src="${escapeHtml(badgeUrl)}" alt="Live status badge"></p>
        <p class="note">Markdown:</p><div class="embed-box">${escapeHtml(snippets.markdown)}</div>
        <p class="note">HTML:</p><div class="embed-box">${escapeHtml(snippets.html)}</div>`;
      })()
    : '';

  const rankBadge =
    typeof server.rankScore === 'number'
      ? `<span class="rank-badge"><a href="/rankings" title="Composite rank score out of 100">#${escapeHtml(String(server.rank ?? '\u2014'))} \u00b7 ${escapeHtml(String(server.rankScore))}</a></span>`
      : '';

  const rankNeighborhoodSection = renderRankNeighborhoodSection(rankNeighborhood, server && server.id, serverNames);

  return renderPage({
    title: `ArkHelper \u2014 ${server.name || 'Server'}`,
    currentPath: `/servers/${server.id || ''}`,
    account,
    live,
    extraCss: PAGE_CSS,
    body: `<h1><a href="/servers">Servers</a> &rsaquo; ${escapeHtml(server.name || '(unnamed)')}${rankBadge}</h1>

  ${favoriteSection}

  <table class="facts">
    <tr><td>Status</td><td>${server.playersNow !== null ? 'Registered / active' : 'Unknown'}</td></tr>
    <tr><td>Players</td><td>${escapeHtml(String(server.playersNow ?? '\u2014'))} / ${escapeHtml(String(server.maxPlayers ?? '\u2014'))}</td></tr>
    <tr><td>Map</td><td>${escapeHtml(server.map || '\u2014')}</td></tr>
    <tr><td>Mode</td><td>${server.gameMode === 'pve' ? 'PvE' : server.gameMode === 'pvp' ? 'PvP' : '\u2014'}</td></tr>
    <tr><td>Day</td><td>${escapeHtml(String(server.day ?? '\u2014'))}</td></tr>
    <tr><td>Version</td><td>${escapeHtml(server.version || '\u2014')}</td></tr>
    <tr><td>Cluster</td><td>${escapeHtml(server.clusterId || '\u2014')}</td></tr>
    <tr><td>Platforms</td><td>${(() => {
      const badge = platformBadge(server.platformType);
      const raw = escapeHtml(server.platformType || '\u2014');
      return badge ? `<span class="platform-badge">${escapeHtml(badge)}</span> ${raw}` : raw;
    })()}</td></tr>
    <tr><td>Password protected</td><td>${server.hasPassword ? 'Yes' : 'No'}</td></tr>
    <tr><td>BattlEye</td><td>${server.battleye ? 'Enabled' : 'Disabled'}</td></tr>
    <tr><td>IP : Port</td><td>${escapeHtml(server.ip || '\u2014')} : ${escapeHtml(String(server.port ?? '\u2014'))}</td></tr>
    ${rosterUptime !== null ? `<tr><td>Uptime (7-day)</td><td>${escapeHtml(String(rosterUptime))}%</td></tr>` : ''}
    <tr><td>Mods</td><td>${modList}</td></tr>
    ${(() => {
      const code = normalizeCountryCode(server.country);
      const name = countryDisplayName(server);
      if (!code || !name) return '';
      const flag = flagEmoji(code);
      const label = flag ? `${flag} ${escapeHtml(name)}` : escapeHtml(name);
      return `<tr><td>Country</td><td>${label}</td></tr>`;
    })()}
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

  ${rankNeighborhoodSection}

  <h2>Embed this server's status</h2>
  ${embedSection}

  ${alertSection}`,
  });
}

module.exports = {
  renderServerDetailPage,
  renderServerNotFoundPage,
  renderRosterUnavailablePage,
};
