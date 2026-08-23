#!/usr/bin/env node
'use strict';

/**
 * clusters_page.js
 *
 * /clusters index and /clusters/:id per-cluster pages. Aggregates are
 * pure functions over the stamped official roster (clusterId, playersNow,
 * maxPlayers, uptimePercent, rankScore, map, gameMode).
 */

const { escapeHtml } = require('./theme.js');
const { renderPage } = require('./layout.js');
const { resolveMap } = require('./maps.js');

const MAPS_NAME_LIMIT = 4;

const PAGE_CSS = `
.telemetry { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: var(--space-3); margin: var(--space-5) 0; }
.telemetry .cell { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: var(--space-3); }
.telemetry .fig { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 1.2rem; font-weight: 700; color: var(--accent); }
.telemetry .lbl { color: var(--muted); font-size: 0.75rem; margin-top: var(--space-1); }
.breakdown { display: flex; flex-wrap: wrap; gap: var(--space-3); margin: 0 0 var(--space-4); }
.breakdown .chip { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: var(--space-2) var(--space-3); }
.breakdown .chip .fig { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-weight: 700; }
.cluster-links { margin: var(--space-5) 0 0; }
.available-clusters { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-4); list-style: none; padding: 0; margin: var(--space-3) 0 0; }
`;

function round1(n) {
  return Math.round(n * 10) / 10;
}

function avg(values) {
  if (!values.length) return null;
  return values.reduce((sum, n) => sum + n, 0) / values.length;
}

function formatNum(value, suffix = '') {
  if (value === null || value === undefined || Number.isNaN(value)) return '\u2014';
  return `${value}${suffix}`;
}

function dash(value) {
  if (value === null || value === undefined || value === '') return '\u2014';
  return String(value);
}

function modeLabel(gameMode) {
  if (gameMode === 'pve') return 'PvE';
  if (gameMode === 'pvp') return 'PvP';
  return '\u2014';
}

function playersNowOf(server) {
  return typeof server.playersNow === 'number' && Number.isFinite(server.playersNow) ? server.playersNow : 0;
}

function maxPlayersOf(server) {
  return typeof server.maxPlayers === 'number' && Number.isFinite(server.maxPlayers) ? server.maxPlayers : 0;
}

function fillPercent(playersOnline, capacity) {
  if (typeof capacity !== 'number' || !Number.isFinite(capacity) || capacity <= 0) return null;
  if (typeof playersOnline !== 'number' || !Number.isFinite(playersOnline)) return null;
  return round1((playersOnline / capacity) * 100);
}

function mapDisplayName(mapId) {
  if (!mapId) return null;
  return resolveMap(mapId).displayName || mapId;
}

function formatMapsCell(maps) {
  const list = Array.isArray(maps) ? maps : [];
  if (list.length === 0) return '\u2014';
  if (list.length <= MAPS_NAME_LIMIT) return list.map((m) => mapDisplayName(m) || m).join(', ');
  return `${list.length} maps`;
}

/**
 * Path segment for a cluster ID. Returns encodeURIComponent(id) when the
 * ID round-trips through encode/decode and does not contain `/` (the
 * maps-style handler treats a slash as a nested path). Otherwise null —
 * callers must render the ID as plain text, not a href.
 */
function clusterPathSegment(clusterId) {
  if (typeof clusterId !== 'string' || clusterId.length === 0) return null;
  if (clusterId.includes('/')) return null;
  try {
    const encoded = encodeURIComponent(clusterId);
    if (decodeURIComponent(encoded) !== clusterId) return null;
    return encoded;
  } catch {
    return null;
  }
}

function clusterHref(clusterId) {
  const segment = clusterPathSegment(clusterId);
  return segment ? `/clusters/${segment}` : null;
}

function clusterLinkHtml(clusterId) {
  const id = typeof clusterId === 'string' ? clusterId : '';
  if (!id) return escapeHtml('\u2014');
  const href = clusterHref(id);
  const label = escapeHtml(id);
  return href ? `<a href="${escapeHtml(href)}">${label}</a>` : label;
}

function serversForCluster(servers, clusterId) {
  if (typeof clusterId !== 'string' || !clusterId) return [];
  return (Array.isArray(servers) ? servers : []).filter((s) => s && s.clusterId === clusterId);
}

function computeClusterIndex(servers) {
  const byCluster = new Map();
  for (const s of Array.isArray(servers) ? servers : []) {
    if (!s || !s.clusterId) continue;
    const entry = byCluster.get(s.clusterId) || {
      clusterId: s.clusterId,
      serverCount: 0,
      playersOnline: 0,
      capacity: 0,
      uptimes: [],
      maps: new Set(),
      pve: 0,
      pvp: 0,
    };
    entry.serverCount += 1;
    entry.playersOnline += playersNowOf(s);
    entry.capacity += maxPlayersOf(s);
    if (typeof s.uptimePercent === 'number' && Number.isFinite(s.uptimePercent)) entry.uptimes.push(s.uptimePercent);
    if (s.map) entry.maps.add(s.map);
    if (s.gameMode === 'pve') entry.pve += 1;
    if (s.gameMode === 'pvp') entry.pvp += 1;
    byCluster.set(s.clusterId, entry);
  }
  return [...byCluster.values()]
    .map((e) => {
      const maps = [...e.maps].sort((a, b) => a.localeCompare(b));
      return {
        clusterId: e.clusterId,
        serverCount: e.serverCount,
        playersOnline: e.playersOnline,
        capacity: e.capacity,
        fillPercent: fillPercent(e.playersOnline, e.capacity),
        avgUptimePercent: e.uptimes.length ? round1(avg(e.uptimes)) : null,
        maps,
        mapCount: maps.length,
        pve: e.pve,
        pvp: e.pvp,
        href: clusterHref(e.clusterId),
      };
    })
    .sort((a, b) => b.playersOnline - a.playersOnline || String(a.clusterId).localeCompare(String(b.clusterId)));
}

function unavailableBody(heading) {
  return `<h1>${escapeHtml(heading)}</h1>
  <p>Server data isn't available right now (the discovery service may not be running).</p>`;
}

function renderMemberRow(s) {
  const name = escapeHtml(s && s.name ? s.name : '(unnamed)');
  const id = s && s.id != null ? String(s.id) : '';
  const nameCell = id
    ? `<a href="/servers/${encodeURIComponent(id)}">${name}</a>`
    : name;
  const map = escapeHtml(dash(s && s.map));
  const mode = escapeHtml(modeLabel(s && s.gameMode));
  const players = escapeHtml(dash(s && s.playersNow));
  const cap = escapeHtml(dash(s && s.maxPlayers));
  const ping =
    s && typeof s.wildcardReportedPing === 'number'
      ? String(s.wildcardReportedPing)
      : s && typeof s.ping === 'number'
        ? String(s.ping)
        : '\u2014';
  const uptime = s && typeof s.uptimePercent === 'number' ? `${s.uptimePercent}%` : '\u2014';
  const rank =
    s && typeof s.rank === 'number'
      ? String(s.rank)
      : s && typeof s.rankScore === 'number'
        ? String(s.rankScore)
        : '\u2014';
  return `<tr>
      <td>${nameCell}</td>
      <td>${map}</td>
      <td>${mode}</td>
      <td class="num">${players} / ${cap}</td>
      <td class="num">${escapeHtml(ping)}</td>
      <td class="num">${escapeHtml(uptime)}</td>
      <td class="num">${escapeHtml(rank)}</td>
    </tr>`;
}

function renderClusterIndexPage({ rosterAvailable, clusters, account = null, live = null } = {}) {
  if (!rosterAvailable) {
    return renderPage({
      title: 'ARK Clusters \u2014 Official Server Clusters | ArkHelper',
      description: 'Official ARK: Survival Ascended clusters: live server counts, players online, capacity, maps, and 7-day uptime.',
      currentPath: '/clusters',
      account,
      live,
      extraCss: PAGE_CSS,
      body: unavailableBody('Clusters'),
    });
  }

  const rows = Array.isArray(clusters) ? clusters : [];
  const table =
    rows.length === 0
      ? `<p class="note">No cluster data yet.</p>`
      : `<table>
      <thead><tr><th>Cluster</th><th>Servers</th><th>Players online</th><th>Capacity</th><th>Maps</th><th>Avg 7-day uptime</th></tr></thead>
      <tbody>${rows
        .map(
          (c) => `<tr>
            <td>${clusterLinkHtml(c.clusterId)}</td>
            <td class="num">${escapeHtml(String(c.serverCount))}</td>
            <td class="num">${escapeHtml(String(c.playersOnline))}</td>
            <td class="num">${escapeHtml(String(c.capacity))}</td>
            <td>${escapeHtml(formatMapsCell(c.maps))}</td>
            <td class="num">${escapeHtml(formatNum(c.avgUptimePercent, '%'))}</td>
          </tr>`
        )
        .join('')}</tbody>
    </table>`;

  return renderPage({
    title: 'ARK Clusters \u2014 Official Server Clusters | ArkHelper',
    description: 'Official ARK: Survival Ascended clusters: live server counts, players online, capacity, maps, and 7-day uptime.',
    currentPath: '/clusters',
    account,
    live,
    extraCss: PAGE_CSS,
    body: `<h1>Clusters</h1>
  <p class="note">Official ARK: Survival Ascended clusters on the live Wildcard roster, sorted by players online.</p>
  ${table}`,
  });
}

function renderMemberTable(servers) {
  const list = Array.isArray(servers) ? servers : [];
  if (!list.length) return `<p class="note">No servers in this cluster right now.</p>`;
  return `<table>
      <thead><tr><th>Name</th><th>Map</th><th>Mode</th><th>Players</th><th>Ping</th><th>Uptime</th><th>Rank</th></tr></thead>
      <tbody>${list.map((s) => renderMemberRow(s)).join('')}</tbody>
    </table>`;
}

function renderClusterPage({
  rosterAvailable,
  cluster,
  servers,
  account = null,
  live = null,
} = {}) {
  const id = cluster && cluster.clusterId ? String(cluster.clusterId) : '';
  const title = id ? `ARK ${id} Cluster \u2014 Official Network | ArkHelper` : 'ARK Cluster \u2014 Official Network | ArkHelper';
  const description = id
    ? `Official ARK: Survival Ascended ${id} cluster: member servers, players online, capacity, maps, and 7-day uptime.`
    : 'Official ARK: Survival Ascended cluster.';
  const currentPath = clusterHref(id) || `/clusters/${id}`;

  if (!rosterAvailable) {
    return renderPage({
      title,
      description,
      currentPath,
      account,
      live,
      extraCss: PAGE_CSS,
      body: unavailableBody(id || 'Cluster'),
    });
  }

  const t = cluster || {};
  const members = Array.isArray(servers) ? servers : [];
  const mapsLabel = formatMapsCell(t.maps);

  return renderPage({
    title,
    description,
    currentPath,
    account,
    live,
    extraCss: PAGE_CSS,
    body: `<h1>${escapeHtml(id || 'Cluster')}</h1>
  <p class="note">Official cluster on the live Wildcard roster.</p>
  <section class="telemetry" aria-label="Cluster telemetry">
    <div class="cell"><div class="fig num">${escapeHtml(String(t.serverCount ?? '\u2014'))}</div><div class="lbl">Servers</div></div>
    <div class="cell"><div class="fig num">${escapeHtml(String(t.playersOnline ?? '\u2014'))}</div><div class="lbl">Players online</div></div>
    <div class="cell"><div class="fig num">${escapeHtml(String(t.capacity ?? '\u2014'))}</div><div class="lbl">Combined capacity</div></div>
    <div class="cell"><div class="fig num">${escapeHtml(formatNum(t.fillPercent, '%'))}</div><div class="lbl">Fill</div></div>
    <div class="cell"><div class="fig num">${escapeHtml(formatNum(t.avgUptimePercent, '%'))}</div><div class="lbl">Avg 7-day uptime</div></div>
    <div class="cell"><div class="fig num">${escapeHtml(mapsLabel)}</div><div class="lbl">Maps represented</div></div>
  </section>
  <h2>Mode</h2>
  <div class="breakdown">
    <div class="chip"><span class="fig num">${escapeHtml(String(t.pve ?? 0))}</span> PvE</div>
    <div class="chip"><span class="fig num">${escapeHtml(String(t.pvp ?? 0))}</span> PvP</div>
  </div>
  <h2>Servers</h2>
  ${renderMemberTable(members)}
  <p class="cluster-links"><a href="/clusters">All clusters</a></p>`,
  });
}

function renderClusterNotFoundPage({ clusterId, clusters, account = null, live = null } = {}) {
  const rows = Array.isArray(clusters) ? clusters : [];
  const list =
    rows.length === 0
      ? `<p>See the <a href="/clusters">clusters index</a>.</p>`
      : `<p>Available clusters:</p>
  <ul class="available-clusters">${rows
    .map((c) => {
      const id = c && c.clusterId ? c.clusterId : c;
      return `<li>${clusterLinkHtml(id)}</li>`;
    })
    .join('')}</ul>
  <p class="note"><a href="/clusters">All clusters</a></p>`;

  return renderPage({
    title: 'Cluster not found \u2014 ArkHelper',
    description: 'That ARK cluster page does not exist.',
    currentPath: clusterHref(clusterId) || `/clusters/${clusterId || ''}`,
    account,
    live,
    extraCss: PAGE_CSS,
    body: `<h1>Cluster not found</h1>
  <p>No official cluster matches <code>${escapeHtml(clusterId || '')}</code>.</p>
  ${list}`,
  });
}

module.exports = {
  MAPS_NAME_LIMIT,
  clusterPathSegment,
  clusterHref,
  clusterLinkHtml,
  serversForCluster,
  computeClusterIndex,
  formatMapsCell,
  renderClusterIndexPage,
  renderClusterPage,
  renderClusterNotFoundPage,
};
