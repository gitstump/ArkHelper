#!/usr/bin/env node
'use strict';

/**
 * leaderboards_page.js
 *
 * The /leaderboards suite: index, map uptime, PvE vs PvP, and
 * bottom-100. Top-100 reuses rankings_page.js (no duplicated scorer).
 * All aggregates are pure functions over the stamped roster.
 */

const { escapeHtml } = require('./theme.js');
const { renderPage } = require('./layout.js');
const { rankingFromRoster, renderRankingsPage, TOP_N } = require('./rankings_page.js');
const { flagEmoji, normalizeCountryCode, countryDisplayName } = require('./country.js');

const FULL_CONFIDENCE = 10;
const BOTTOM_N = 100;
const TOP_MAPS = 5;

const SUITE = [
  {
    href: '/rankings',
    title: 'Rankings',
    blurb: 'Composite top 100: reliability, ping, population, and history confidence.',
  },
  {
    href: '/leaderboards/map-uptime',
    title: 'Map Uptime',
    blurb: 'Every map ranked by average 7-day uptime, with population %.',
  },
  {
    href: '/leaderboards/pve-vs-pvp',
    title: 'PvE vs PvP',
    blurb: 'Side-by-side network comparison with deltas and top maps per mode.',
  },
  {
    href: '/leaderboards/regions',
    title: 'Regions',
    blurb: 'Official servers grouped by country: count, players, uptime, and ping.',
  },
  {
    href: '/leaderboards/top-100',
    title: 'Top 100',
    blurb: 'The same composite ranking as Rankings, in the leaderboard suite.',
  },
  {
    href: '/leaderboards/bottom-100',
    title: 'Bottom 100',
    blurb: 'Lowest scores among servers with a full week of history.',
  },
];

const PAGE_CSS = `
.lb-index { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: var(--space-3); list-style: none; padding: 0; margin: var(--space-4) 0 0; }
.lb-card { display: block; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: var(--space-4); text-decoration: none; color: inherit; }
.lb-card h2 { margin: 0 0 var(--space-2); font-size: 1.05rem; }
.lb-card p { margin: 0; color: var(--muted); font-size: 0.9rem; }
.lb-card:hover { border-color: var(--accent); }
.compare-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-5); }
.compare-grid h2 { margin-top: 0; }
.delta-strip { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: var(--space-3); margin: var(--space-5) 0; }
.delta-cell { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: var(--space-3); }
.delta-cell .fig { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 1.2rem; font-weight: 700; color: var(--accent); }
.delta-cell .lbl { color: var(--muted); font-size: 0.75rem; margin-top: var(--space-1); }
@media (max-width: 700px) { .compare-grid { grid-template-columns: 1fr; } }
`;

function isOnline(s) {
  return s && s.playersNow !== null && s.playersNow !== undefined;
}

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

function formatDelta(value, suffix = '') {
  if (value === null || value === undefined || Number.isNaN(value)) return '\u2014';
  const sign = value > 0 ? '+' : value < 0 ? '' : '';
  return `${sign}${value}${suffix}`;
}

function computeMapUptime(servers) {
  const byMap = new Map();
  for (const s of Array.isArray(servers) ? servers : []) {
    if (!s || !s.map) continue;
    const entry = byMap.get(s.map) || { map: s.map, serverCount: 0, uptimes: [], pops: [] };
    entry.serverCount += 1;
    if (typeof s.uptimePercent === 'number' && Number.isFinite(s.uptimePercent)) entry.uptimes.push(s.uptimePercent);
    if (typeof s.avgPopulationPercent === 'number' && Number.isFinite(s.avgPopulationPercent)) entry.pops.push(s.avgPopulationPercent);
    byMap.set(s.map, entry);
  }
  return [...byMap.values()]
    .map((e) => ({
      map: e.map,
      serverCount: e.serverCount,
      avgUptimePercent: e.uptimes.length ? round1(avg(e.uptimes)) : null,
      avgPopulationPercent: e.pops.length ? round1(avg(e.pops)) : null,
    }))
    .sort((a, b) => {
      const au = a.avgUptimePercent;
      const bu = b.avgUptimePercent;
      if (au === null && bu === null) return a.map.localeCompare(b.map);
      if (au === null) return 1;
      if (bu === null) return -1;
      return bu - au || a.map.localeCompare(b.map);
    });
}

function topMapsByServers(servers, limit = TOP_MAPS) {
  const byMap = new Map();
  for (const s of servers) {
    if (!s || !s.map) continue;
    byMap.set(s.map, (byMap.get(s.map) || 0) + 1);
  }
  return [...byMap.entries()]
    .map(([map, serverCount]) => ({ map, serverCount }))
    .sort((a, b) => b.serverCount - a.serverCount || a.map.localeCompare(b.map))
    .slice(0, limit);
}

function computeModeSide(servers, mode) {
  const list = (Array.isArray(servers) ? servers : []).filter((s) => s && s.gameMode === mode);
  const uptimes = list.map((s) => s.uptimePercent).filter((n) => typeof n === 'number' && Number.isFinite(n));
  const pings = list.map((s) => s.wildcardReportedPing).filter((n) => typeof n === 'number' && Number.isFinite(n));
  const onlineCount = list.filter(isOnline).length;
  const totalPlayers = list.reduce((sum, s) => sum + (s.playersNow || 0), 0);
  return {
    mode,
    serverCount: list.length,
    onlinePercent: list.length ? round1((onlineCount / list.length) * 100) : null,
    avgUptime: uptimes.length ? round1(avg(uptimes)) : null,
    avgPing: pings.length ? Math.round(avg(pings)) : null,
    totalPlayers,
    avgPlayers: list.length ? round1(totalPlayers / list.length) : null,
    topMaps: topMapsByServers(list),
  };
}

function delta(a, b) {
  if (typeof a !== 'number' || typeof b !== 'number') return null;
  return round1(a - b);
}

function computePveVsPvp(servers) {
  const pve = computeModeSide(servers, 'pve');
  const pvp = computeModeSide(servers, 'pvp');
  return {
    pve,
    pvp,
    deltas: {
      serverCount: delta(pve.serverCount, pvp.serverCount),
      onlinePercent: delta(pve.onlinePercent, pvp.onlinePercent),
      avgUptime: delta(pve.avgUptime, pvp.avgUptime),
      avgPing: delta(pve.avgPing, pvp.avgPing),
      totalPlayers: delta(pve.totalPlayers, pvp.totalPlayers),
      avgPlayers: delta(pve.avgPlayers, pvp.avgPlayers),
    },
  };
}

function computeRegions(servers) {
  const byCode = new Map();
  const unknown = { code: null, name: 'Unknown', serverCount: 0, playersOnline: 0, uptimes: [], pings: [] };

  function bucketFor(s) {
    const code = normalizeCountryCode(s && s.country);
    if (!code) return unknown;
    let entry = byCode.get(code);
    if (!entry) {
      entry = {
        code,
        name: countryDisplayName(s) || code,
        serverCount: 0,
        playersOnline: 0,
        uptimes: [],
        pings: [],
      };
      byCode.set(code, entry);
    } else if (entry.name === code) {
      const named = countryDisplayName(s);
      if (named && named !== code) entry.name = named;
    }
    return entry;
  }

  for (const s of Array.isArray(servers) ? servers : []) {
    if (!s) continue;
    const entry = bucketFor(s);
    entry.serverCount += 1;
    entry.playersOnline += typeof s.playersNow === 'number' && Number.isFinite(s.playersNow) ? s.playersNow : 0;
    if (typeof s.uptimePercent === 'number' && Number.isFinite(s.uptimePercent)) entry.uptimes.push(s.uptimePercent);
    if (typeof s.wildcardReportedPing === 'number' && Number.isFinite(s.wildcardReportedPing)) entry.pings.push(s.wildcardReportedPing);
  }

  function finalize(e) {
    return {
      code: e.code,
      name: e.name,
      serverCount: e.serverCount,
      playersOnline: e.playersOnline,
      avgUptimePercent: e.uptimes.length ? round1(avg(e.uptimes)) : null,
      avgPing: e.pings.length ? Math.round(avg(e.pings)) : null,
    };
  }

  const known = [...byCode.values()]
    .map(finalize)
    .sort((a, b) => b.serverCount - a.serverCount || a.name.localeCompare(b.name) || (a.code || '').localeCompare(b.code || ''));
  if (unknown.serverCount > 0) known.push(finalize(unknown));
  return known;
}

function bottomFromRoster(servers, { limit = BOTTOM_N, minConfidence = FULL_CONFIDENCE } = {}) {
  return rankingFromRoster(servers, { limit, order: 'asc', minConfidence });
}

function unavailableBody(heading) {
  return `<h1>${escapeHtml(heading)}</h1>
  <p>Server data isn't available right now (the discovery service may not be running).</p>`;
}

function renderLeaderboardsIndex({ account = null, live = null, rosterAvailable = true } = {}) {
  const cards = SUITE.map(
    (item) => `<li><a class="lb-card" href="${item.href}"><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.blurb)}</p></a></li>`
  ).join('');
  const note = rosterAvailable ? '' : `<p class="note">Live roster data isn't available right now; the pages below still open.</p>`;
  return renderPage({
    title: 'ArkHelper \u2014 Leaderboards',
    description: 'ARK: Survival Ascended leaderboards: map uptime, PvE vs PvP, regions, top 100, and bottom 100.',
    currentPath: '/leaderboards',
    account,
    live,
    extraCss: PAGE_CSS,
    body: `<h1>Leaderboards</h1>
  <p class="note">Official-network leaderboards from roster history, rankings, and live counts.</p>
  ${note}
  <ul class="lb-index">${cards}</ul>`,
  });
}

function renderMapUptimePage({ rosterAvailable, maps, account = null, live = null } = {}) {
  if (!rosterAvailable) {
    return renderPage({
      title: 'ARK Map Uptime Leaderboard \u2014 ArkHelper',
      description: 'Average 7-day uptime and population for every official ARK: Survival Ascended map.',
      currentPath: '/leaderboards/map-uptime',
      account,
      live,
      extraCss: PAGE_CSS,
      body: unavailableBody('Map Uptime'),
    });
  }

  const rows = Array.isArray(maps) ? maps : [];
  const table =
    rows.length === 0
      ? `<p class="note">No map data yet.</p>`
      : `<table>
      <thead><tr><th>Map</th><th>Servers</th><th>Avg 7-day uptime</th><th>Avg population %</th></tr></thead>
      <tbody>${rows
        .map(
          (m) => `<tr>
            <td>${escapeHtml(m.map)}</td>
            <td class="num">${escapeHtml(String(m.serverCount))}</td>
            <td class="num">${escapeHtml(formatNum(m.avgUptimePercent, '%'))}</td>
            <td class="num">${escapeHtml(formatNum(m.avgPopulationPercent, '%'))}</td>
          </tr>`
        )
        .join('')}</tbody>
    </table>`;

  return renderPage({
    title: 'ARK Map Uptime Leaderboard \u2014 ArkHelper',
    description: 'Average 7-day uptime and population for every official ARK: Survival Ascended map.',
    currentPath: '/leaderboards/map-uptime',
    account,
    live,
    extraCss: PAGE_CSS,
    body: `<h1>Map Uptime</h1>
  <p class="note">Every official map, sorted by average 7-day uptime. Population % is the mean how-full across that window.</p>
  ${table}`,
  });
}

function renderModeColumn(side, label) {
  const maps =
    side.topMaps.length === 0
      ? `<p class="note">No maps recorded.</p>`
      : `<table>
      <thead><tr><th>Map</th><th>Servers</th></tr></thead>
      <tbody>${side.topMaps
        .map((m) => `<tr><td>${escapeHtml(m.map)}</td><td class="num">${escapeHtml(String(m.serverCount))}</td></tr>`)
        .join('')}</tbody>
    </table>`;
  return `<div>
    <h2>${escapeHtml(label)}</h2>
    <table>
      <tbody>
        <tr><td>Servers</td><td class="num">${escapeHtml(String(side.serverCount))}</td></tr>
        <tr><td>Online %</td><td class="num">${escapeHtml(formatNum(side.onlinePercent, '%'))}</td></tr>
        <tr><td>Avg uptime</td><td class="num">${escapeHtml(formatNum(side.avgUptime, '%'))}</td></tr>
        <tr><td>Avg ping</td><td class="num">${escapeHtml(formatNum(side.avgPing, 'ms'))}</td></tr>
        <tr><td>Total players</td><td class="num">${escapeHtml(String(side.totalPlayers))}</td></tr>
        <tr><td>Avg players/server</td><td class="num">${escapeHtml(formatNum(side.avgPlayers))}</td></tr>
      </tbody>
    </table>
    <h3>Top maps</h3>
    ${maps}
  </div>`;
}

function renderPveVsPvpPage({ rosterAvailable, comparison, account = null, live = null } = {}) {
  if (!rosterAvailable || !comparison) {
    return renderPage({
      title: 'ARK PvE vs PvP \u2014 ArkHelper',
      description: 'Official ARK: Survival Ascended PvE versus PvP: servers, uptime, ping, players, and top maps.',
      currentPath: '/leaderboards/pve-vs-pvp',
      account,
      live,
      extraCss: PAGE_CSS,
      body: unavailableBody('PvE vs PvP'),
    });
  }

  const d = comparison.deltas;
  const strip = `<section class="delta-strip" aria-label="PvE minus PvP">
    <div class="delta-cell"><div class="fig num">${escapeHtml(formatDelta(d.serverCount))}</div><div class="lbl">Servers (PvE \u2212 PvP)</div></div>
    <div class="delta-cell"><div class="fig num">${escapeHtml(formatDelta(d.onlinePercent, '%'))}</div><div class="lbl">Online %</div></div>
    <div class="delta-cell"><div class="fig num">${escapeHtml(formatDelta(d.avgUptime, '%'))}</div><div class="lbl">Avg uptime</div></div>
    <div class="delta-cell"><div class="fig num">${escapeHtml(formatDelta(d.avgPing, 'ms'))}</div><div class="lbl">Avg ping</div></div>
    <div class="delta-cell"><div class="fig num">${escapeHtml(formatDelta(d.totalPlayers))}</div><div class="lbl">Total players</div></div>
    <div class="delta-cell"><div class="fig num">${escapeHtml(formatDelta(d.avgPlayers))}</div><div class="lbl">Avg players/server</div></div>
  </section>`;

  return renderPage({
    title: 'ARK PvE vs PvP \u2014 ArkHelper',
    description: 'Official ARK: Survival Ascended PvE versus PvP: servers, uptime, ping, players, and top maps.',
    currentPath: '/leaderboards/pve-vs-pvp',
    account,
    live,
    extraCss: PAGE_CSS,
    body: `<h1>PvE vs PvP</h1>
  <p class="note">Official servers only. Deltas are PvE minus PvP (positive means PvE is higher).</p>
  ${strip}
  <div class="compare-grid">
    ${renderModeColumn(comparison.pve, 'PvE')}
    ${renderModeColumn(comparison.pvp, 'PvP')}
  </div>`,
  });
}

function regionRowLabel(region) {
  if (!region || !region.code) return escapeHtml(region && region.name ? region.name : 'Unknown');
  const flag = flagEmoji(region.code);
  const name = escapeHtml(region.name || region.code);
  return flag ? `${flag} ${name}` : name;
}

function renderRegionsPage({ rosterAvailable, regions, account = null, live = null } = {}) {
  if (!rosterAvailable) {
    return renderPage({
      title: 'ARK Regional Leaderboard \u2014 ArkHelper',
      description: 'Official ARK: Survival Ascended servers grouped by country: count, players online, uptime, and ping.',
      currentPath: '/leaderboards/regions',
      account,
      live,
      extraCss: PAGE_CSS,
      body: unavailableBody('Regions'),
    });
  }

  const rows = Array.isArray(regions) ? regions : [];
  const table =
    rows.length === 0
      ? `<p class="note">No region data yet.</p>`
      : `<table>
      <thead><tr><th>Country</th><th>Servers</th><th>Players online</th><th>Avg 7-day uptime</th><th>Avg ping</th></tr></thead>
      <tbody>${rows
        .map(
          (r) => `<tr>
            <td>${regionRowLabel(r)}</td>
            <td class="num">${escapeHtml(String(r.serverCount))}</td>
            <td class="num">${escapeHtml(String(r.playersOnline))}</td>
            <td class="num">${escapeHtml(formatNum(r.avgUptimePercent, '%'))}</td>
            <td class="num">${escapeHtml(formatNum(r.avgPing, 'ms'))}</td>
          </tr>`
        )
        .join('')}</tbody>
    </table>`;

  return renderPage({
    title: 'ARK Regional Leaderboard \u2014 ArkHelper',
    description: 'Official ARK: Survival Ascended servers grouped by country: count, players online, uptime, and ping.',
    currentPath: '/leaderboards/regions',
    account,
    live,
    extraCss: PAGE_CSS,
    body: `<h1>Regions</h1>
  <p class="note">Official servers grouped by GeoLite2 country. Servers without a resolved country are listed as Unknown.</p>
  ${table}`,
  });
}

function renderTop100Page(opts) {
  return renderRankingsPage({
    ...opts,
    currentPath: '/leaderboards/top-100',
    title: 'ARK Top 100 Servers \u2014 ArkHelper',
    description: 'The top 100 official ARK: Survival Ascended servers by composite rank score.',
    heading: 'Top 100',
    summaryKind: 'top',
  });
}

function renderBottom100Page(opts) {
  return renderRankingsPage({
    ...opts,
    currentPath: '/leaderboards/bottom-100',
    title: 'ARK Bottom 100 Servers \u2014 ArkHelper',
    description: 'The lowest-ranked official ARK servers with a full week of history.',
    heading: 'Bottom 100',
    summaryKind: 'lowest',
    intro: 'Servers with less than a full week of history are excluded so new servers aren\'t ranked at the bottom by accident.',
  });
}

module.exports = {
  SUITE,
  FULL_CONFIDENCE,
  BOTTOM_N,
  TOP_N,
  computeMapUptime,
  computePveVsPvp,
  computeRegions,
  bottomFromRoster,
  rankingFromRoster,
  renderLeaderboardsIndex,
  renderMapUptimePage,
  renderPveVsPvpPage,
  renderRegionsPage,
  renderTop100Page,
  renderBottom100Page,
};
