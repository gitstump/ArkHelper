#!/usr/bin/env node
'use strict';

/**
 * stats_page.js
 *
 * Network-wide stats and leaderboards. Built around what we actually
 * have — live player counts (always available), uptime, and a
 * composite ranking preview (full table lives at /rankings; both
 * available once discovery's history has accumulated a few runs).
 */

const { escapeHtml } = require('./home_page.js');

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
const STYLE = `<style>
  body { background:#141210; color:#e8e6e3; font-family: system-ui, -apple-system, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
  h1, h1 a { color: #f2b544; text-decoration: none; }
  h2 { color: #f2b544; margin-top: 2rem; font-size: 1.1rem; }
  a { color: #7fd0ff; }
  table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; }
  th, td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid #2a2620; }
  .note { color: #b8b3a8; font-size: 0.9rem; }
  .counters { color: #b8b3a8; }
  .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; }
  @media (max-width: 600px) { .stats-grid { grid-template-columns: 1fr; } }
</style>`;

function renderStatsPage({
  rosterAvailable,
  counters,
  modeStats,
  mapStats,
  clusterStats,
  platformStats,
  topByPlayers,
  uptimeLeaderboard,
  uptimeAvailable,
  ranking,
  rankingAvailable,
}) {
  if (!rosterAvailable) {
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>ArkHelper \u2014 Stats</title>${STYLE}</head>
<body><h1><a href="/">ArkHelper</a> &rsaquo; Stats</h1><p>Server data isn't available right now (the discovery service may not be running).</p></body></html>`;
  }

  const countersBar = `<p class="counters">${escapeHtml(String(counters.totalOfficial))} official servers &middot; ${escapeHtml(String(counters.playersOnline))} players online</p>`;

  const rankingSection = !rankingAvailable
    ? `<h2>Top ranked servers</h2><p class="note">History tracking isn't enabled on the discovery service, so ranking isn't available.</p>`
    : ranking.servers.length === 0
    ? `<h2>Top ranked servers</h2><p class="note">Not enough history recorded yet — ranking needs a few discovery runs before it's meaningful${ranking.totalRuns != null ? ` (based on ${escapeHtml(String(ranking.totalRuns))} run(s) so far)` : ''}.</p>`
    : `<h2>Top ranked servers</h2>
    <p class="note">Composite score out of 100: 40% reliability (uptime) + 25% connection (ping) + 25% activity (average population) + 10% confidence (history age). <a href="/rankings">Full rankings with score breakdowns &rsaquo;</a></p>
    <table>
      <thead><tr><th>#</th><th>Server</th><th>Score</th><th>Reliability</th><th>Connection</th><th>Activity</th><th>Confidence</th></tr></thead>
      <tbody>${ranking.servers
        .map((s) => {
          const c = s.components || {};
          return `<tr><td>${s.rank}</td><td><a href="/servers/${encodeURIComponent(s.serverId)}">${escapeHtml(displayNameFor(s))}</a></td><td>${escapeHtml(String(s.rankScore ?? ''))}</td><td>${escapeHtml(String(c.reliability ?? ''))}</td><td>${escapeHtml(String(c.connection ?? ''))}</td><td>${escapeHtml(String(c.activity ?? ''))}</td><td>${escapeHtml(String(c.confidence ?? ''))}</td></tr>`;
        })
        .join('')}</tbody>
    </table>`;

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

  const uptimeSection = !uptimeAvailable
    ? `<h2>Highest uptime servers</h2><p class="note">History tracking isn't enabled on the discovery service, so this leaderboard isn't available.</p>`
    : uptimeLeaderboard.servers.length === 0
    ? `<h2>Highest uptime servers</h2><p class="note">Not enough history recorded yet — this fills in automatically as the discovery service keeps running (based on ${escapeHtml(String(uptimeLeaderboard.totalRuns))} run(s) so far).</p>`
    : `<h2>Highest uptime servers</h2>
    <p class="note">Based on ${escapeHtml(String(uptimeLeaderboard.totalRuns))} discovery run(s). See the note on any server's detail page for what "uptime" means given our data source.</p>
    <table>
      <thead><tr><th>#</th><th>Server</th><th>Uptime</th></tr></thead>
      <tbody>${uptimeLeaderboard.servers
        .map(
          (s, i) =>
            `<tr><td>${i + 1}</td><td><a href="/servers/${encodeURIComponent(s.serverId)}">${escapeHtml(displayNameFor(s))}</a>${
              s.map ? ` <span class="note">(${escapeHtml(s.map)})</span>` : ''
            }</td><td>${escapeHtml(String(s.uptimePercent))}%</td></tr>`
        )
        .join('')}</tbody>
    </table>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ArkHelper \u2014 Stats</title>
${STYLE}
</head>
<body>
  <h1><a href="/">ArkHelper</a> &rsaquo; Stats</h1>
  ${countersBar}
  ${rankingSection}
  ${topByPlayersSection}
  ${uptimeSection}
  <div class="stats-grid">
    <div>${modeSection}${platformSection}</div>
    <div>${mapSection}${clusterSection}</div>
  </div>
</body>
</html>`;
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
