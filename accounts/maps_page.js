#!/usr/bin/env node
'use strict';

/**
 * maps_page.js
 *
 * /maps index and /maps/<slug> per-map pages. Aggregates are pure
 * functions over the stamped roster (same fields the browser already
 * uses: playersNow, uptimePercent, rankScore, platformType, version).
 */

const { escapeHtml } = require('./theme.js');
const { renderPage } = require('./layout.js');
const { renderServerRow, PAGE_CSS: BROWSER_CSS, isOnline, platformBadge } = require('./server_browser.js');
const { resolveMap } = require('./maps.js');

const LEADING_LIMIT = 10;
const UNAVAILABLE_LIMIT = 20;
const PLATFORM_ORDER = ['PC', 'Console', 'PC+Console'];

const PAGE_CSS = `
${BROWSER_CSS}
.map-index { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: var(--space-3); list-style: none; padding: 0; margin: var(--space-4) 0 0; }
.map-card { display: block; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: var(--space-4); text-decoration: none; color: inherit; }
.map-card:hover { border-color: var(--accent); }
.map-card h2 { margin: 0 0 var(--space-3); font-size: 1.05rem; }
.map-card dl { margin: 0; display: grid; gap: var(--space-2); }
.map-card .fig { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 1.05rem; font-weight: 700; color: var(--accent); }
.map-card .lbl { color: var(--muted); font-size: 0.75rem; }
.telemetry { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: var(--space-3); margin: var(--space-5) 0; }
.telemetry .cell { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: var(--space-3); }
.telemetry .fig { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 1.2rem; font-weight: 700; color: var(--accent); }
.telemetry .lbl { color: var(--muted); font-size: 0.75rem; margin-top: var(--space-1); }
.breakdown { display: flex; flex-wrap: wrap; gap: var(--space-3); margin: 0 0 var(--space-4); }
.breakdown .chip { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: var(--space-2) var(--space-3); }
.breakdown .chip .fig { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-weight: 700; }
.map-links { margin: var(--space-5) 0 0; }
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

function serversForMap(servers, mapId) {
  return (Array.isArray(servers) ? servers : []).filter((s) => s && s.map === mapId);
}

function computeMapTelemetry(servers) {
  const list = Array.isArray(servers) ? servers : [];
  const online = list.filter(isOnline);
  let freeSlots = 0;
  for (const s of online) {
    if (typeof s.maxPlayers === 'number' && typeof s.playersNow === 'number') {
      freeSlots += s.maxPlayers - s.playersNow;
    }
  }
  const uptimes = list.map((s) => s.uptimePercent).filter((n) => typeof n === 'number' && Number.isFinite(n));
  return {
    playersOnline: list.reduce((sum, s) => sum + (s.playersNow || 0), 0),
    onlineCount: online.length,
    totalCount: list.length,
    freeSlots,
    avgUptimePercent: uptimes.length ? round1(avg(uptimes)) : null,
  };
}

function computeMapBreakdown(servers) {
  const list = Array.isArray(servers) ? servers : [];
  const platforms = { PC: 0, Console: 0, 'PC+Console': 0 };
  for (const s of list) {
    const badge = platformBadge(s.platformType);
    if (badge && Object.prototype.hasOwnProperty.call(platforms, badge)) platforms[badge] += 1;
  }
  return {
    pve: list.filter((s) => s.gameMode === 'pve').length,
    pvp: list.filter((s) => s.gameMode === 'pvp').length,
    platforms,
  };
}

function computeVersionCounts(servers) {
  const counts = new Map();
  for (const s of Array.isArray(servers) ? servers : []) {
    const key = s && s.version ? String(s.version) : '\u2014';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([version, serverCount]) => ({ version, serverCount }))
    .sort((a, b) => b.serverCount - a.serverCount || a.version.localeCompare(b.version));
}

function leadingServers(servers, limit = LEADING_LIMIT) {
  return [...(Array.isArray(servers) ? servers : [])]
    .filter((s) => typeof s.rankScore === 'number')
    .sort((a, b) => b.rankScore - a.rankScore || String(a.id || '').localeCompare(String(b.id || '')))
    .slice(0, limit);
}

function unavailableServers(servers, limit = UNAVAILABLE_LIMIT) {
  return [...(Array.isArray(servers) ? servers : [])]
    .filter((s) => !isOnline(s))
    .sort((a, b) => {
      const ar = typeof a.rank === 'number' ? a.rank : Infinity;
      const br = typeof b.rank === 'number' ? b.rank : Infinity;
      return ar - br || String(a.name || '').localeCompare(String(b.name || ''));
    })
    .slice(0, limit);
}

function computeMapIndex(servers) {
  const byMap = new Map();
  for (const s of Array.isArray(servers) ? servers : []) {
    if (!s || !s.map) continue;
    const entry = byMap.get(s.map) || { mapId: s.map, serverCount: 0, playersOnline: 0, uptimes: [] };
    entry.serverCount += 1;
    entry.playersOnline += s.playersNow || 0;
    if (typeof s.uptimePercent === 'number' && Number.isFinite(s.uptimePercent)) entry.uptimes.push(s.uptimePercent);
    byMap.set(s.map, entry);
  }
  return [...byMap.values()]
    .map((e) => {
      const info = resolveMap(e.mapId);
      return {
        id: info.id,
        displayName: info.displayName,
        slug: info.slug,
        known: info.known,
        serverCount: e.serverCount,
        playersOnline: e.playersOnline,
        avgUptimePercent: e.uptimes.length ? round1(avg(e.uptimes)) : null,
      };
    })
    .sort((a, b) => b.serverCount - a.serverCount || a.displayName.localeCompare(b.displayName));
}

function unavailableBody(heading) {
  return `<h1>${escapeHtml(heading)}</h1>
  <p>Server data isn't available right now (the discovery service may not be running).</p>`;
}

function renderMapIndexPage({ rosterAvailable, maps, account = null, live = null } = {}) {
  if (!rosterAvailable) {
    return renderPage({
      title: 'ARK Maps \u2014 Official Servers by Map | ArkHelper',
      description: 'Browse official ARK: Survival Ascended maps: live server counts, players online, and uptime for every map on the Wildcard roster.',
      currentPath: '/maps',
      account,
      live,
      extraCss: PAGE_CSS,
      body: unavailableBody('Maps'),
    });
  }

  const rows = Array.isArray(maps) ? maps : [];
  const cards =
    rows.length === 0
      ? `<p class="note">No map data yet.</p>`
      : `<ul class="map-index">${rows
          .map(
            (m) => `<li><a class="map-card" href="/maps/${escapeHtml(m.slug)}">
          <h2>${escapeHtml(m.displayName)}</h2>
          <dl>
            <div><div class="fig num">${escapeHtml(String(m.serverCount))}</div><div class="lbl">Servers</div></div>
            <div><div class="fig num">${escapeHtml(String(m.playersOnline))}</div><div class="lbl">Players online</div></div>
            <div><div class="fig num">${escapeHtml(formatNum(m.avgUptimePercent, '%'))}</div><div class="lbl">Avg uptime</div></div>
          </dl>
        </a></li>`
          )
          .join('')}</ul>`;

  return renderPage({
    title: 'ARK Maps \u2014 Official Servers by Map | ArkHelper',
    description: 'Browse official ARK: Survival Ascended maps: live server counts, players online, and uptime for every map on the Wildcard roster.',
    currentPath: '/maps',
    account,
    live,
    extraCss: PAGE_CSS,
    body: `<h1>Maps</h1>
  <p class="note">Official ARK: Survival Ascended maps, sorted by how many servers are running each one right now.</p>
  ${cards}`,
  });
}

function renderStandardTable(servers) {
  if (!servers.length) return `<p class="note">None right now.</p>`;
  return `<table class="browser-table">
      <thead><tr><th></th><th>Name</th><th>Map</th><th>Day</th><th>Version</th><th>Players</th><th>Ping</th><th>Uptime</th><th>Rank</th></tr></thead>
      <tbody>${servers.map((s) => renderServerRow(s)).join('')}</tbody>
    </table>`;
}

function renderMapPage({
  rosterAvailable,
  map,
  servers,
  telemetry,
  breakdown,
  versions,
  leading,
  unavailable,
  account = null,
  live = null,
} = {}) {
  const info = map && map.id ? map : resolveMap(map && map.id);
  const name = info.displayName || info.id || 'Map';
  const title = `ARK ${name} Servers \u2014 Official Network | ArkHelper`;
  const description = `Live official ARK: Survival Ascended ${name} servers: players online, uptime, PvE vs PvP, versions, and top-ranked servers.`;
  const currentPath = `/maps/${info.slug || ''}`;

  if (!rosterAvailable) {
    return renderPage({
      title,
      description,
      currentPath,
      account,
      live,
      extraCss: PAGE_CSS,
      body: unavailableBody(name),
    });
  }

  const t = telemetry || computeMapTelemetry(servers);
  const b = breakdown || computeMapBreakdown(servers);
  const versionRows = Array.isArray(versions) ? versions : computeVersionCounts(servers);
  const leadingRows = Array.isArray(leading) ? leading : leadingServers(servers);
  const offlineRows = Array.isArray(unavailable) ? unavailable : unavailableServers(servers);
  const blurb = info.blurb
    ? `<p class="note">${escapeHtml(info.blurb)}</p>`
    : `<p class="note">An official ARK: Survival Ascended map currently listed on the Wildcard roster.</p>`;

  const platformChips = PLATFORM_ORDER.filter((label) => b.platforms[label] > 0)
    .map(
      (label) =>
        `<div class="chip"><span class="fig num">${escapeHtml(String(b.platforms[label]))}</span> ${escapeHtml(label)}</div>`
    )
    .join('');

  const versionTable =
    versionRows.length === 0
      ? `<p class="note">No version data.</p>`
      : `<table>
      <thead><tr><th>Version</th><th>Servers</th></tr></thead>
      <tbody>${versionRows
        .map(
          (v) =>
            `<tr><td class="num">${escapeHtml(v.version)}</td><td class="num">${escapeHtml(String(v.serverCount))}</td></tr>`
        )
        .join('')}</tbody>
    </table>`;

  const offlineTable =
    offlineRows.length === 0
      ? `<p class="note">Every listed ${escapeHtml(name)} server is currently online.</p>`
      : `<table>
      <thead><tr><th>Name</th><th>Rank</th><th>7-day uptime</th></tr></thead>
      <tbody>${offlineRows
        .map((s) => {
          const rank = typeof s.rank === 'number' ? String(s.rank) : typeof s.rankScore === 'number' ? String(s.rankScore) : '\u2014';
          const uptime = typeof s.uptimePercent === 'number' ? `${s.uptimePercent}%` : '\u2014';
          return `<tr>
            <td><a href="/servers/${encodeURIComponent(s.id || '')}">${escapeHtml(s.name || '(unnamed)')}</a></td>
            <td class="num">${escapeHtml(rank)}</td>
            <td class="num">${escapeHtml(uptime)}</td>
          </tr>`;
        })
        .join('')}</tbody>
    </table>`;

  return renderPage({
    title,
    description,
    currentPath,
    account,
    live,
    extraCss: PAGE_CSS,
    body: `<h1>${escapeHtml(name)}</h1>
  ${blurb}
  <section class="telemetry" aria-label="Map telemetry">
    <div class="cell"><div class="fig num">${escapeHtml(String(t.playersOnline))}</div><div class="lbl">Players online</div></div>
    <div class="cell"><div class="fig num">${escapeHtml(String(t.onlineCount))} / ${escapeHtml(String(t.totalCount))}</div><div class="lbl">Online servers</div></div>
    <div class="cell"><div class="fig num">${escapeHtml(String(t.freeSlots))}</div><div class="lbl">Free slots</div></div>
    <div class="cell"><div class="fig num">${escapeHtml(formatNum(t.avgUptimePercent, '%'))}</div><div class="lbl">Avg 7-day availability</div></div>
  </section>
  <h2>Mode and platform</h2>
  <div class="breakdown">
    <div class="chip"><span class="fig num">${escapeHtml(String(b.pve))}</span> PvE</div>
    <div class="chip"><span class="fig num">${escapeHtml(String(b.pvp))}</span> PvP</div>
    ${platformChips}
  </div>
  <h2>Observed versions</h2>
  ${versionTable}
  <h2>Leading servers</h2>
  ${renderStandardTable(leadingRows)}
  <h2>Currently unavailable</h2>
  ${offlineTable}
  <p class="map-links"><a href="/servers?map=${encodeURIComponent(info.id)}">Browse all ${escapeHtml(name)} servers</a></p>`,
  });
}

function renderMapNotFoundPage({ slug, account = null, live = null } = {}) {
  return renderPage({
    title: 'Map not found \u2014 ArkHelper',
    description: 'That ARK map page does not exist.',
    currentPath: `/maps/${slug || ''}`,
    account,
    live,
    extraCss: PAGE_CSS,
    body: `<h1>Map not found</h1>
  <p>No official map matches <code>${escapeHtml(slug || '')}</code>. See the <a href="/maps">maps index</a>.</p>`,
  });
}

module.exports = {
  LEADING_LIMIT,
  UNAVAILABLE_LIMIT,
  serversForMap,
  computeMapTelemetry,
  computeMapBreakdown,
  computeVersionCounts,
  leadingServers,
  unavailableServers,
  computeMapIndex,
  renderMapIndexPage,
  renderMapPage,
  renderMapNotFoundPage,
};
