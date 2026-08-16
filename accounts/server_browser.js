#!/usr/bin/env node
'use strict';

/**
 * server_browser.js
 *
 * The actual "browse servers" page — Phase 3. Filtering/sorting/
 * pagination are plain pure functions (easy to test in isolation),
 * rendering is server-side HTML with a GET form for filters, same
 * no-client-JS approach as the homepage: filtered/sorted/paginated
 * views are just URLs, so they're bookmarkable and shareable for free.
 *
 * Data source: fetches the full roster from the discovery service's
 * /roster endpoint (not /roster/meta, which the homepage uses — this
 * page needs every server, not just the counts) via the shared
 * fetchJsonSafe helper, so a down/slow discovery service degrades to
 * "no data" instead of breaking the page.
 */

const { escapeHtml } = require('./home_page.js');

const PAGE_SIZE = 25;
const SORT_KEYS = { name: 'name', players: 'playersNow', day: 'day', map: 'map' };

// ---------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------
function filterServers(servers, filters = {}) {
  const { search, map, gameMode, platform, hasPassword, minPlayers, maxPlayers, clusterId } = filters;

  return servers.filter((s) => {
    if (search && !(s.name || '').toLowerCase().includes(search.toLowerCase())) return false;
    if (map && s.map !== map) return false;
    if (gameMode && s.gameMode !== gameMode) return false;
    if (platform && !(s.platformType || '').toUpperCase().includes(platform.toUpperCase())) return false;
    if (hasPassword === 'true' && s.hasPassword !== true) return false;
    if (hasPassword === 'false' && s.hasPassword !== false) return false;
    if (minPlayers !== undefined && minPlayers !== '' && (s.playersNow ?? -Infinity) < Number(minPlayers)) return false;
    if (maxPlayers !== undefined && maxPlayers !== '' && (s.playersNow ?? Infinity) > Number(maxPlayers)) return false;
    if (clusterId && s.clusterId !== clusterId) return false;
    return true;
  });
}

// ---------------------------------------------------------------------
// Sorting (never mutates the input array)
// ---------------------------------------------------------------------
function sortServers(servers, sortKey = 'players', sortDir = 'desc') {
  const field = SORT_KEYS[sortKey] || SORT_KEYS.players;
  const dir = sortDir === 'asc' ? 1 : -1;

  return [...servers].sort((a, b) => {
    const av = a[field];
    const bv = b[field];
    // Nulls always sort last regardless of direction, rather than
    // jumping to the front on a "desc" sort where null coerces to 0.
    if (av === null || av === undefined) return bv === null || bv === undefined ? 0 : 1;
    if (bv === null || bv === undefined) return -1;
    if (typeof av === 'string') return dir * av.localeCompare(bv);
    return dir * (av - bv);
  });
}

// ---------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------
function paginateServers(servers, page = 1, pageSize = PAGE_SIZE) {
  const totalCount = servers.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const clampedPage = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const start = (clampedPage - 1) * pageSize;
  return {
    items: servers.slice(start, start + pageSize),
    page: clampedPage,
    totalPages,
    totalCount,
  };
}

// ---------------------------------------------------------------------
// Live counters (computed over the full, unfiltered roster — these are
// network-wide stats, not a reflection of the current filtered view)
// ---------------------------------------------------------------------
function computeLiveCounters(servers) {
  const pings = servers.map((s) => s.wildcardReportedPing).filter((p) => typeof p === 'number');
  return {
    totalOfficial: servers.length,
    playersOnline: servers.reduce((sum, s) => sum + (s.playersNow || 0), 0),
    avgPing: pings.length > 0 ? Math.round(pings.reduce((a, b) => a + b, 0) / pings.length) : null,
    pveCount: servers.filter((s) => s.gameMode === 'pve').length,
    pvpCount: servers.filter((s) => s.gameMode === 'pvp').length,
  };
}

function getDistinctMaps(servers) {
  return [...new Set(servers.map((s) => s.map).filter(Boolean))].sort();
}

// ---------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------
const STYLE = `<style>
  body { background:#141210; color:#e8e6e3; font-family: system-ui, -apple-system, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
  h1, h1 a { color: #f2b544; text-decoration: none; }
  a { color: #7fd0ff; }
  table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
  th, td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid #2a2620; }
  th a { color: #e8e6e3; }
  .filters { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 1rem; }
  .filters input, .filters select { background:#1c1a16; color:#e8e6e3; border:1px solid #443f36; padding:0.4rem; border-radius:4px; }
  button { background:#2a2620; color:#e8e6e3; border:1px solid #443f36; padding: 0.4rem 1rem; border-radius: 4px; cursor:pointer; }
  .counters { color: #b8b3a8; }
  .pagination { display:flex; gap:1rem; align-items:center; margin-top:1rem; color:#b8b3a8; }
</style>`;

function sortLink({ currentSort, currentDir, key, label, filters }) {
  const nextDir = currentSort === key && currentDir === 'desc' ? 'asc' : 'desc';
  const params = new URLSearchParams({ ...filters, sort: key, dir: nextDir });
  const arrow = currentSort === key ? (currentDir === 'desc' ? ' \u25BC' : ' \u25B2') : '';
  return `<a href="/servers?${params.toString()}">${escapeHtml(label)}${arrow}</a>`;
}

function renderServerRow(s) {
  return `<tr>
      <td><a href="/servers/${encodeURIComponent(s.id || '')}">${escapeHtml(s.name || '(unnamed)')}</a></td>
      <td>${escapeHtml(s.map || '')}</td>
      <td>${s.gameMode === 'pve' ? 'PvE' : s.gameMode === 'pvp' ? 'PvP' : '\u2014'}</td>
      <td>${escapeHtml(String(s.playersNow ?? '\u2014'))}/${escapeHtml(String(s.maxPlayers ?? '\u2014'))}</td>
      <td>${escapeHtml(String(s.day ?? '\u2014'))}</td>
      <td>${escapeHtml(s.clusterId || '\u2014')}</td>
      <td>${s.hasPassword ? '\uD83D\uDD12' : ''}</td>
    </tr>`;
}

function renderBrowserPage({ page, filters, sort, dir, counters, mapOptions, rosterAvailable }) {
  const f = filters || {};

  const countersBar = rosterAvailable
    ? `<p class="counters">${escapeHtml(String(counters.totalOfficial))} official servers &middot; ` +
      `${escapeHtml(String(counters.playersOnline))} players online &middot; ` +
      `${counters.avgPing !== null ? escapeHtml(String(counters.avgPing)) + 'ms avg ping' : 'ping unavailable'} &middot; ` +
      `${escapeHtml(String(counters.pveCount))} PvE / ${escapeHtml(String(counters.pvpCount))} PvP</p>`
    : `<p class="counters">Server data isn't available right now (the discovery service may not be running).</p>`;

  if (!rosterAvailable) {
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>ArkHelper \u2014 Servers</title>${STYLE}</head>
<body><h1><a href="/">ArkHelper</a> &rsaquo; Servers</h1>${countersBar}</body></html>`;
  }

  const filterForm = `
<form method="GET" action="/servers" class="filters">
  <input type="text" name="search" placeholder="Search server name" value="${escapeHtml(f.search || '')}">
  <select name="map">
    <option value="">All maps</option>
    ${mapOptions.map((m) => `<option value="${escapeHtml(m)}" ${f.map === m ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('')}
  </select>
  <select name="gameMode">
    <option value="">All modes</option>
    <option value="pve" ${f.gameMode === 'pve' ? 'selected' : ''}>PvE</option>
    <option value="pvp" ${f.gameMode === 'pvp' ? 'selected' : ''}>PvP</option>
  </select>
  <select name="hasPassword">
    <option value="">Any</option>
    <option value="false" ${f.hasPassword === 'false' ? 'selected' : ''}>Public only</option>
    <option value="true" ${f.hasPassword === 'true' ? 'selected' : ''}>Passworded only</option>
  </select>
  <input type="number" name="minPlayers" placeholder="Min players" value="${escapeHtml(f.minPlayers || '')}" style="width:6rem">
  <input type="number" name="maxPlayers" placeholder="Max players" value="${escapeHtml(f.maxPlayers || '')}" style="width:6rem">
  <button type="submit">Filter</button>
</form>`;

  const rows = page.items.map(renderServerRow).join('');

  const resultsTable = page.items.length
    ? `<table>
      <thead><tr>
        <th>${sortLink({ currentSort: sort, currentDir: dir, key: 'name', label: 'Name', filters: f })}</th>
        <th>${sortLink({ currentSort: sort, currentDir: dir, key: 'map', label: 'Map', filters: f })}</th>
        <th>Mode</th>
        <th>${sortLink({ currentSort: sort, currentDir: dir, key: 'players', label: 'Players', filters: f })}</th>
        <th>${sortLink({ currentSort: sort, currentDir: dir, key: 'day', label: 'Day', filters: f })}</th>
        <th>Cluster</th>
        <th></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`
    : `<p>No servers match these filters.</p>`;

  const prevParams = new URLSearchParams({ ...f, sort, dir, page: String(page.page - 1) });
  const nextParams = new URLSearchParams({ ...f, sort, dir, page: String(page.page + 1) });
  const pagination = `<p class="pagination">
    ${page.page > 1 ? `<a href="/servers?${prevParams.toString()}">&laquo; Prev</a>` : '<span>&laquo; Prev</span>'}
    Page ${page.page} of ${page.totalPages} (${page.totalCount} matching)
    ${page.page < page.totalPages ? `<a href="/servers?${nextParams.toString()}">Next &raquo;</a>` : '<span>Next &raquo;</span>'}
  </p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ArkHelper \u2014 Servers</title>
${STYLE}
</head>
<body>
  <h1><a href="/">ArkHelper</a> &rsaquo; Servers</h1>
  ${countersBar}
  ${filterForm}
  ${resultsTable}
  ${pagination}
</body>
</html>`;
}

module.exports = {
  PAGE_SIZE,
  filterServers,
  sortServers,
  paginateServers,
  computeLiveCounters,
  getDistinctMaps,
  renderBrowserPage,
  renderServerRow,
  STYLE,
};
