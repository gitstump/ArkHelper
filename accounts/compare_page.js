#!/usr/bin/env node
'use strict';

/**
 * compare_page.js
 *
 * Side-by-side official-server comparison at /compare. Selection lives
 * entirely in the URL (`?s=<id>&s=<id>`), so every view is bookmarkable.
 * No HTTP of its own — the route fetches the roster and passes it in.
 */

const { escapeHtml } = require('./theme.js');
const { renderPage } = require('./layout.js');
const { isOnline, platformBadge } = require('./server_browser.js');
const { regionLabel } = require('./country.js');

const COMPARE_CAP = 4;
const SEARCH_LIMIT = 10;
const EM = '\u2014';

const ATTR_ROWS = [
  { key: 'status', label: 'Status' },
  { key: 'map', label: 'Map' },
  { key: 'mode', label: 'Mode' },
  { key: 'platform', label: 'Platform' },
  { key: 'region', label: 'Region' },
  { key: 'players', label: 'Players' },
  { key: 'ping', label: 'Ping' },
  { key: 'uptime', label: 'Uptime' },
  { key: 'rank', label: 'Rank' },
  { key: 'cluster', label: 'Cluster' },
  { key: 'version', label: 'Version' },
  { key: 'day', label: 'Day' },
];

const PAGE_CSS = `
.compare-table { width: 100%; margin-top: var(--space-4); }
.compare-table th, .compare-table td { padding: var(--space-2) var(--space-3); vertical-align: top; }
.compare-table th[scope="row"] { text-align: left; color: var(--muted); white-space: nowrap; font-weight: 600; }
.compare-table .col-head { font-weight: 650; }
.compare-remove { display: block; font-size: 0.8rem; font-weight: 400; margin-top: 2px; }
.compare-unlisted { display: block; color: var(--muted); font-size: 0.8rem; font-weight: 400; margin-top: 2px; }
td.compare-best {
  color: var(--accent);
  font-weight: 650;
  box-shadow: inset 0 0 0 1px var(--accent);
  background: var(--surface);
}
.compare-add { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-5); }
.compare-matches { list-style: none; padding: 0; margin: var(--space-3) 0 0; }
.compare-matches li { margin: var(--space-2) 0; }
`;

function toSearchParams(query) {
  if (query instanceof URLSearchParams) return query;
  if (typeof query === 'string') {
    const stripped = query.startsWith('?') ? query.slice(1) : query;
    return new URLSearchParams(stripped);
  }
  if (query && typeof query.getAll === 'function') return query;
  return new URLSearchParams();
}

function parseCompareIds(query) {
  const params = toSearchParams(query);
  const ids = [];
  const seen = new Set();
  for (const value of params.getAll('s')) {
    for (const part of String(value).split(',')) {
      const id = part.trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  }
  const truncated = ids.length > COMPARE_CAP;
  return { ids: ids.slice(0, COMPARE_CAP), truncated };
}

function compareHref(ids) {
  if (!ids.length) return '/compare';
  const qs = ids.map((id) => `s=${encodeURIComponent(id)}`).join('&');
  return `/compare?${qs}`;
}

function rosterList(roster) {
  if (Array.isArray(roster)) return roster;
  if (roster && Array.isArray(roster.servers)) return roster.servers;
  return [];
}

function indexById(servers) {
  const map = new Map();
  for (const s of servers) {
    if (!s || s.id == null || s.id === '') continue;
    const key = String(s.id);
    if (!map.has(key)) map.set(key, s);
  }
  return map;
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function effectivePing(server) {
  if (!server) return null;
  const reported = finiteNumber(server.wildcardReportedPing);
  if (reported !== null) return reported;
  return finiteNumber(server.ping);
}

function formatMode(mode) {
  if (mode === 'pve') return 'PvE';
  if (mode === 'pvp') return 'PvP';
  return EM;
}

function dash(value) {
  if (value === null || value === undefined || value === '') return EM;
  return String(value);
}

function rankNumeric(server) {
  if (!server) return { kind: null, value: null };
  const position = finiteNumber(server.rank);
  if (position !== null) return { kind: 'position', value: position };
  const score = finiteNumber(server.rankScore);
  if (score !== null) return { kind: 'score', value: score };
  return { kind: null, value: null };
}

function bestIndexes(values, { higherWins }) {
  const numeric = values
    .map((v, i) => ({ i, v }))
    .filter((x) => typeof x.v === 'number' && Number.isFinite(x.v));
  if (numeric.length < 2) return new Set();
  const best = higherWins ? Math.max(...numeric.map((x) => x.v)) : Math.min(...numeric.map((x) => x.v));
  return new Set(numeric.filter((x) => x.v === best).map((x) => x.i));
}

function rankBestIndexes(columns) {
  const metas = columns.map((col) => (col.listed ? rankNumeric(col.server) : { kind: null, value: null }));
  const present = metas.filter((m) => m.kind);
  if (present.length < 2) return new Set();
  const kinds = new Set(present.map((m) => m.kind));
  if (kinds.size !== 1) return new Set();
  const kind = present[0].kind;
  return bestIndexes(
    metas.map((m) => (m.kind === kind ? m.value : null)),
    { higherWins: kind === 'score' }
  );
}

function cellValues(server, listed) {
  if (!listed) {
    return {
      status: EM,
      map: EM,
      mode: EM,
      platform: EM,
      region: EM,
      players: EM,
      ping: EM,
      uptime: EM,
      rank: EM,
      cluster: EM,
      version: EM,
      day: EM,
    };
  }
  const ping = effectivePing(server);
  const uptime = finiteNumber(server.uptimePercent);
  const rank = rankNumeric(server);
  const badge = platformBadge(server.platformType);
  return {
    status: isOnline(server) ? 'Online' : 'Offline',
    map: dash(server.map),
    mode: formatMode(server.gameMode),
    platform: badge || EM,
    region: regionLabel(server.country),
    players: `${dash(server.playersNow)} / ${dash(server.maxPlayers)}`,
    ping: ping === null ? EM : String(ping),
    uptime: uptime === null ? EM : `${uptime}%`,
    rank: rank.value === null ? EM : String(rank.value),
    cluster: dash(server.clusterId),
    version: dash(server.version),
    day: dash(server.day),
  };
}

function searchMatches(servers, q, selectedIds) {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return [];
  const selected = new Set(selectedIds.map(String));
  const matches = [];
  for (const s of servers) {
    if (!s || s.id == null || s.id === '') continue;
    if (selected.has(String(s.id))) continue;
    const name = typeof s.name === 'string' ? s.name : '';
    if (!name.toLowerCase().includes(needle)) continue;
    matches.push(s);
    if (matches.length >= SEARCH_LIMIT) break;
  }
  return matches;
}

function renderAddForm(ids, q) {
  const hidden = ids.map((id) => `<input type="hidden" name="s" value="${escapeHtml(id)}">`).join('');
  return `<form method="GET" action="/compare" class="compare-add">
    ${hidden}
    <input type="text" name="q" value="${escapeHtml(q)}" placeholder="Search server name" aria-label="Search server name">
    <button type="submit">Search</button>
  </form>`;
}

function renderSearchResults(matches, ids, q) {
  if (!String(q || '').trim()) return '';
  if (!matches.length) return `<p class="note">no servers match</p>`;
  const items = matches
    .map((s) => {
      const href = compareHref([...ids, String(s.id)]);
      const name = escapeHtml(s.name || '(unnamed)');
      const map = escapeHtml(dash(s.map));
      const players = `${escapeHtml(dash(s.playersNow))} / ${escapeHtml(dash(s.maxPlayers))}`;
      return `<li><a href="${escapeHtml(href)}">${name}</a> \u2014 ${map} \u00b7 ${players}</li>`;
    })
    .join('');
  return `<ul class="compare-matches">${items}</ul>`;
}

function renderCompareTable(columns) {
  const pingBest = bestIndexes(
    columns.map((col) => (col.listed ? effectivePing(col.server) : null)),
    { higherWins: false }
  );
  const uptimeBest = bestIndexes(
    columns.map((col) => (col.listed ? finiteNumber(col.server.uptimePercent) : null)),
    { higherWins: true }
  );
  const rankBest = rankBestIndexes(columns);
  const bestFor = { ping: pingBest, uptime: uptimeBest, rank: rankBest };

  const headers = columns
    .map((col) => {
      const href = `/servers/${encodeURIComponent(col.id)}`;
      const removeHref = compareHref(columns.filter((c) => c.id !== col.id).map((c) => c.id));
      const label = col.listed ? escapeHtml(col.server.name || '(unnamed)') : escapeHtml(col.id);
      const unlisted = col.listed ? '' : `<span class="compare-unlisted">Not currently listed</span>`;
      return `<th class="col-head"><a href="${href}">${label}</a><a class="compare-remove" href="${escapeHtml(removeHref)}">remove</a>${unlisted}</th>`;
    })
    .join('');

  const body = ATTR_ROWS.map((row) => {
    const cells = columns
      .map((col, i) => {
        const values = cellValues(col.server, col.listed);
        const highlight = bestFor[row.key] && bestFor[row.key].has(i) ? ' class="compare-best"' : '';
        return `<td${highlight}>${escapeHtml(values[row.key])}</td>`;
      })
      .join('');
    return `<tr><th scope="row">${escapeHtml(row.label)}</th>${cells}</tr>`;
  }).join('');

  return `<table class="compare-table">
    <thead><tr><th></th>${headers}</tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

function renderComparePage({
  ids = [],
  roster = [],
  q = '',
  account = null,
  rosterAvailable = true,
  truncated = false,
  live = null,
} = {}) {
  const title = 'ArkHelper \u2014 Compare Servers';
  const description = 'Side-by-side official ARK: Survival Ascended server comparison. Bookmark and share any matchup.';
  const selected = Array.isArray(ids) ? ids.map(String).filter(Boolean).slice(0, COMPARE_CAP) : [];

  if (!rosterAvailable) {
    return renderPage({
      title,
      description,
      currentPath: '/compare',
      account,
      live,
      extraCss: PAGE_CSS,
      body: `<h1>Compare Servers</h1>
  <p>Server data isn't available right now (the discovery service may not be running).</p>`,
    });
  }

  const servers = rosterList(roster);
  const byId = indexById(servers);
  const columns = selected.map((id) => {
    const server = byId.get(id);
    return { id, server: server || { id }, listed: Boolean(server) };
  });
  const atCap = selected.length >= COMPARE_CAP || truncated;
  const capNote = atCap ? `<p class="note">Comparison is capped at 4 servers.</p>` : '';
  const query = String(q || '').trim();

  let main;
  if (selected.length === 0) {
    main = `<p>Compare official ARK: Survival Ascended servers side by side. Add servers from the checkbox column in the server browser, or the search box below. Every comparison lives in the URL, so you can bookmark or share it.</p>`;
  } else {
    const hint =
      selected.length === 1 ? `<p class="note">Comparisons work best with 2 or more servers.</p>` : '';
    main = `${hint}${renderCompareTable(columns)}`;
  }

  const addSection = atCap ? '' : renderAddForm(selected, query);
  const matches = atCap || !query ? [] : searchMatches(servers, query, selected);
  const searchSection = atCap ? '' : renderSearchResults(matches, selected, query);

  return renderPage({
    title,
    description,
    currentPath: '/compare',
    account,
    live,
    extraCss: PAGE_CSS,
    body: `<h1>Compare Servers</h1>
  ${capNote}
  ${main}
  ${addSection}
  ${searchSection}`,
  });
}

module.exports = {
  COMPARE_CAP,
  SEARCH_LIMIT,
  ATTR_ROWS,
  parseCompareIds,
  compareHref,
  renderComparePage,
};
