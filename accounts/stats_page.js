#!/usr/bin/env node
'use strict';

/**
 * stats_page.js
 *
 * Network-wide stats. Built around live roster breakdowns (mode, map,
 * platform, cluster, most populated). Ranked lists live in the
 * /leaderboards suite rather than being duplicated here.
 */

const { escapeHtml } = require('./home_page.js');
const { renderPage } = require('./layout.js');

// Leaderboard rows are enriched with a real name by auth_service.js
// when possible (joined against the live roster), but this stays
// defensive against a missing/malformed serverId regardless — a wrong
// upstream shape should degrade to "Unknown server," never throw.
function displayNameFor(entry) {
  if (entry.name) return entry.name;
  if (typeof entry.serverId === 'string' && entry.serverId.length > 0) {
    return `Server ${entry.serverId.slice(0, 8)}\u2026`;
  }
  return 'Unknown server';
}

// ---------------------------------------------------------------------
// Aggregation (pure functions over the roster array)
// ---------------------------------------------------------------------
function computeModeStats(servers) {
  const pve = servers.filter((s) => s.gameMode === 'pve');
  const pvp = servers.filter((s) => s.gameMode === 'pvp');
  const sum = (list) => list.reduce((total, s) => total + (s.playersNow || 0), 0);
  return {
    pve: { serverCount: pve.length, totalPlayers: sum(pve) },
    pvp: { serverCount: pvp.length, totalPlayers: sum(pvp) },
  };
}

function computeMapStats(servers) {
  const byMap = new Map();
  for (const s of servers) {
    if (!s.map) continue;
    const entry = byMap.get(s.map) || { map: s.map, serverCount: 0, totalPlayers: 0 };
    entry.serverCount += 1;
    entry.totalPlayers += s.playersNow || 0;
    byMap.set(s.map, entry);
  }
  return [...byMap.values()]
    .map((e) => ({ ...e, avgPlayers: e.serverCount > 0 ? Math.round((e.totalPlayers / e.serverCount) * 10) / 10 : 0 }))
    .sort((a, b) => b.totalPlayers - a.totalPlayers);
}

function computeClusterStats(servers, limit = 10) {
  const byCluster = new Map();
  for (const s of servers) {
    if (!s.clusterId) continue;
    const entry = byCluster.get(s.clusterId) || { clusterId: s.clusterId, serverCount: 0, totalPlayers: 0 };
    entry.serverCount += 1;
    entry.totalPlayers += s.playersNow || 0;
    byCluster.set(s.clusterId, entry);
  }
  return [...byCluster.values()].sort((a, b) => b.totalPlayers - a.totalPlayers).slice(0, limit);
}

// platformType strings look like "PC+XSX+WINGDK+PS5" — counts how many
// servers include each platform, not a parsed/structured breakdown.
function computePlatformStats(servers) {
  const platforms = ['PC', 'XSX', 'PS5', 'WINGDK'];
  return platforms
    .map((p) => ({
      platform: p,
      serverCount: servers.filter((s) => (s.platformType || '').includes(p)).length,
    }))
    .sort((a, b) => b.serverCount - a.serverCount);
}

function getTopServersByPlayers(servers, limit = 10) {
  return [...servers]
    .filter((s) => typeof s.playersNow === 'number')
    .sort((a, b) => b.playersNow - a.playersNow)
    .slice(0, limit);
}

// ---------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------
const PAGE_CSS = `
.stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-5); }
.stats-grid td:not(:first-child) { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
@media (max-width: 600px) { .stats-grid { grid-template-columns: 1fr; } }
`;

function renderStatsPage({
  rosterAvailable,
  counters,
  modeStats,
  mapStats,
  clusterStats,
  platformStats,
  topByPlayers,
  account = null,
  live = null,
}) {
  if (!rosterAvailable) {
    return renderPage({
      title: 'ArkHelper \u2014 Stats',
      currentPath: '/stats',
      account,
      live,
      extraCss: PAGE_CSS,
      body: `<h1>Stats</h1><p>Server data isn't available right now (the discovery service may not be running).</p>`,
    });
  }

  const countersBar = `<p class="counters">${escapeHtml(String(counters.totalOfficial))} official servers &middot; ${escapeHtml(String(counters.playersOnline))} players online</p>`;

  const suiteSection = `<h2>Leaderboards</h2>
    <p class="note">Ranked lists and comparisons live in the leaderboard suite. This page keeps the network breakdowns.</p>
    <ul>
      <li><a href="/rankings">Rankings</a> — composite top 100</li>
      <li><a href="/leaderboards">All leaderboards</a></li>
      <li><a href="/leaderboards/map-uptime">Map uptime</a></li>
      <li><a href="/leaderboards/pve-vs-pvp">PvE vs PvP</a></li>
      <li><a href="/leaderboards/regions">Regions</a></li>
      <li><a href="/leaderboards/top-100">Top 100</a></li>
      <li><a href="/leaderboards/bottom-100">Bottom 100</a></li>
    </ul>`;

  const modeSection = `<h2>By game mode</h2>
    <table>
      <thead><tr><th>Mode</th><th>Servers</th><th>Players</th></tr></thead>
      <tbody>
        <tr><td>PvE</td><td>${escapeHtml(String(modeStats.pve.serverCount))}</td><td>${escapeHtml(String(modeStats.pve.totalPlayers))}</td></tr>
        <tr><td>PvP</td><td>${escapeHtml(String(modeStats.pvp.serverCount))}</td><td>${escapeHtml(String(modeStats.pvp.totalPlayers))}</td></tr>
      </tbody>
    </table>`;

  const platformSection = `<h2>By platform</h2>
    <table>
      <thead><tr><th>Platform</th><th>Servers</th></tr></thead>
      <tbody>${platformStats.map((p) => `<tr><td>${escapeHtml(p.platform)}</td><td>${escapeHtml(String(p.serverCount))}</td></tr>`).join('')}</tbody>
    </table>
    <p class="note">A server can support multiple platforms (crossplay), so these counts overlap and won't sum to the total server count.</p>`;

  const mapSection = `<h2>By map</h2>
    <table>
      <thead><tr><th>Map</th><th>Servers</th><th>Total players</th><th>Avg players/server</th></tr></thead>
      <tbody>${mapStats
        .slice(0, 15)
        .map((m) => `<tr><td>${escapeHtml(m.map)}</td><td>${escapeHtml(String(m.serverCount))}</td><td>${escapeHtml(String(m.totalPlayers))}</td><td>${escapeHtml(String(m.avgPlayers))}</td></tr>`)
        .join('')}</tbody>
    </table>`;

  const clusterSection =
    clusterStats.length > 0
      ? `<h2>Top clusters</h2>
    <table>
      <thead><tr><th>Cluster</th><th>Servers</th><th>Total players</th></tr></thead>
      <tbody>${clusterStats.map((c) => `<tr><td>${escapeHtml(c.clusterId)}</td><td>${escapeHtml(String(c.serverCount))}</td><td>${escapeHtml(String(c.totalPlayers))}</td></tr>`).join('')}</tbody>
    </table>`
      : '';

  const topByPlayersSection = `<h2>Most populated servers right now</h2>
    <table>
      <thead><tr><th>#</th><th>Name</th><th>Map</th><th>Mode</th><th>Players</th></tr></thead>
      <tbody>${topByPlayers
        .map(
          (s, i) =>
            `<tr><td>${i + 1}</td><td><a href="/servers/${encodeURIComponent(s.id || '')}">${escapeHtml(s.name || '(unnamed)')}</a></td><td>${escapeHtml(s.map || '')}</td><td>${s.gameMode === 'pve' ? 'PvE' : s.gameMode === 'pvp' ? 'PvP' : '\u2014'}</td><td>${escapeHtml(String(s.playersNow ?? '\u2014'))}/${escapeHtml(String(s.maxPlayers ?? '\u2014'))}</td></tr>`
        )
        .join('')}</tbody>
    </table>`;

  return renderPage({
    title: 'ArkHelper \u2014 Stats',
    description: 'Official ARK: Survival Ascended network breakdowns by mode, map, platform, and cluster.',
    currentPath: '/stats',
    account,
    live,
    extraCss: PAGE_CSS,
    body: `<h1>Stats</h1>
  ${countersBar}
  ${suiteSection}
  ${topByPlayersSection}
  <div class="stats-grid">
    <div>${modeSection}${platformSection}</div>
    <div>${mapSection}${clusterSection}</div>
  </div>`,
  });
}

module.exports = {
  computeModeStats,
  computeMapStats,
  computeClusterStats,
  computePlatformStats,
  getTopServersByPlayers,
  displayNameFor,
  renderStatsPage,
};
