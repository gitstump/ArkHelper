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

const { escapeHtml } = require('./theme.js');
const { renderPage, LIST_NAV } = require('./layout.js');
const { hasActiveFilters, messageForPresetError, serversLocation } = require('./presets.js');

const PAGE_SIZE = 25;
const SORT_KEYS = { name: 'name', players: 'playersNow', day: 'day', map: 'map', rank: 'rankScore', ping: 'wildcardReportedPing' };
const PC_TOKENS = new Set(['PC', 'WINGDK']);
const CONSOLE_TOKENS = new Set(['XSX', 'XSS', 'PS5', 'PS4']);
const PLATFORM_BADGE_ORDER = ['PC', 'Console', 'PC+Console'];
const COMPACT_PLATFORM_FILTERS = new Set(PLATFORM_BADGE_ORDER);

function isOnline(s) {
  return s.playersNow !== null && s.playersNow !== undefined;
}

function freeSlots(s) {
  if (typeof s.playersNow !== 'number' || typeof s.maxPlayers !== 'number') return null;
  return s.maxPlayers - s.playersNow;
}

function platformBadge(platformType) {
  if (!platformType || typeof platformType !== 'string') return null;
  const tokens = platformType
    .split('+')
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);
  if (!tokens.length) return null;
  let pc = false;
  let cons = false;
  for (const t of tokens) {
    if (PC_TOKENS.has(t)) pc = true;
    if (CONSOLE_TOKENS.has(t)) cons = true;
  }
  if (pc && cons) return 'PC+Console';
  if (cons) return 'Console';
  if (pc) return 'PC';
  return null;
}

function getDistinctPlatforms(servers) {
  const present = new Set();
  for (const s of servers) {
    const badge = platformBadge(s.platformType);
    if (badge) present.add(badge);
  }
  return PLATFORM_BADGE_ORDER.filter((label) => present.has(label));
}

function platformMatches(s, platform) {
  if (!platform) return true;
  if (COMPACT_PLATFORM_FILTERS.has(platform)) return platformBadge(s.platformType) === platform;
  return (s.platformType || '').toUpperCase().includes(platform.toUpperCase());
}

function sortValue(s, sortKey) {
  if (sortKey === 'freeSlots') return freeSlots(s);
  if (sortKey === 'wipedAt' || sortKey === 'wipeDetectedAt') return s.wipeDetectedAt || null;
  const field = SORT_KEYS[sortKey] || SORT_KEYS.players;
  return s[field];
}

function filtersFromSearchParams(params) {
  return {
    search: params.get('search') || '',
    map: params.get('map') || '',
    gameMode: params.get('gameMode') || '',
    platform: params.get('platform') || '',
    hasPassword: params.get('hasPassword') || '',
    minPlayers: params.get('minPlayers') || '',
    maxPlayers: params.get('maxPlayers') || '',
    clusterId: params.get('clusterId') || '',
    online: params.get('online') || '',
    hasPing: params.get('hasPing') || '',
    minFreeSlots: params.get('minFreeSlots') || '',
    notFull: params.get('notFull') || '',
    wipedWithinDays: params.get('wipedWithinDays') || '',
  };
}

// ---------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------
function filterServers(servers, filters = {}, { now = Date.now } = {}) {
  const { search, map, gameMode, platform, hasPassword, minPlayers, maxPlayers, clusterId, online, hasPing, minFreeSlots, notFull, wipedWithinDays } = filters;

  let wipeCutoff = null;
  if (wipedWithinDays !== undefined && wipedWithinDays !== '') {
    const days = Number(wipedWithinDays);
    if (Number.isFinite(days) && days > 0) {
      wipeCutoff = new Date(now() - days * 24 * 60 * 60 * 1000).toISOString();
    }
  }

  return servers.filter((s) => {
    if (search && !(s.name || '').toLowerCase().includes(search.toLowerCase())) return false;
    if (map && s.map !== map) return false;
    if (gameMode && s.gameMode !== gameMode) return false;
    if (!platformMatches(s, platform)) return false;
    if (hasPassword === 'true' && s.hasPassword !== true) return false;
    if (hasPassword === 'false' && s.hasPassword !== false) return false;
    if (minPlayers !== undefined && minPlayers !== '' && (s.playersNow ?? -Infinity) < Number(minPlayers)) return false;
    if (maxPlayers !== undefined && maxPlayers !== '' && (s.playersNow ?? Infinity) > Number(maxPlayers)) return false;
    if (clusterId && s.clusterId !== clusterId) return false;
    if (online === 'true' && !isOnline(s)) return false;
    if (hasPing === 'true' && typeof s.wildcardReportedPing !== 'number') return false;
    if (notFull === 'true') {
      if (typeof s.playersNow !== 'number' || typeof s.maxPlayers !== 'number' || s.playersNow >= s.maxPlayers) return false;
    }
    if (minFreeSlots !== undefined && minFreeSlots !== '') {
      const min = Number(minFreeSlots);
      const slots = freeSlots(s);
      if (slots === null || slots < min) return false;
    }
    if (wipeCutoff) {
      if (!s.wipeDetectedAt || s.wipeDetectedAt < wipeCutoff) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------
// Sorting (never mutates the input array)
// ---------------------------------------------------------------------
function sortServers(servers, sortKey = 'players', sortDir = 'desc') {
  const key = sortKey === 'freeSlots' || sortKey === 'wipedAt' || sortKey === 'wipeDetectedAt' || SORT_KEYS[sortKey] ? sortKey : 'players';
  const dir = sortDir === 'asc' ? 1 : -1;

  return [...servers].sort((a, b) => {
    const av = sortValue(a, key);
    const bv = sortValue(b, key);
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
const PAGE_CSS = `
.hero { margin-bottom: var(--space-5); }
.hero-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-3); }
.hero-stat { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: var(--space-4); }
.hero-stat .fig { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 1.7rem; font-weight: 700; color: var(--accent); line-height: 1.15; }
.hero-stat .fig a { text-decoration: none; }
.hero-stat .fig.up, .hero-stat .fig.online { color: var(--online); }
.hero-stat .fig.outage { color: var(--offline); }
.hero-stat .fig.update, .hero-stat .fig.degraded { color: var(--degraded); }
.hero-stat .fig.unreachable { color: var(--muted); }
.hero-stat .lbl { color: var(--muted); font-size: 0.75rem; margin-top: var(--space-1); }
.filters { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-4); }
.filters .narrow { width: 6rem; }
.pagination { display: flex; gap: var(--space-4); align-items: center; margin-top: var(--space-4); color: var(--muted); }
.presets { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; margin-top: var(--space-4); }
.preset { display: flex; align-items: center; gap: var(--space-2); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 2px var(--space-2); }
.preset form { display: inline; margin: 0; }
.preset button { padding: 2px var(--space-2); font-size: 0.8rem; }
.share-link { color: var(--muted); font-size: 0.8rem; width: 16rem; }
.save-preset { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; margin-top: var(--space-2); }
.preset-error { color: var(--degraded); margin: var(--space-2) 0 0; }
.browser-table th, .browser-table td { padding: 6px 8px; white-space: nowrap; }
.browser-table td.name { white-space: normal; }
.status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; vertical-align: middle; }
.status-dot.online { background: var(--online); }
.status-dot.offline { background: var(--offline); }
.cap { display: flex; align-items: center; gap: var(--space-2); }
.cap-bar { width: 48px; height: 4px; background: var(--border); border-radius: 2px; overflow: hidden; flex-shrink: 0; }
.cap-fill { display: block; height: 100%; background: var(--accent); }
.server-lists { margin: var(--space-4) 0 var(--space-2); }
.server-lists h2 { margin: 0 0 var(--space-2); }
.server-lists ul { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-4); list-style: none; padding: 0; margin: 0; }
.list-intro { color: var(--muted); margin: 0 0 var(--space-3); }
.list-note { color: var(--muted); font-size: 0.85rem; margin: 0 0 var(--space-3); }
.wipe-meta { color: var(--muted); font-size: 0.78rem; }
@media (max-width: 800px) { .hero-stats { grid-template-columns: 1fr 1fr; } }
`;

const STYLE = `<style>${PAGE_CSS}</style>`;

function dash(value) {
  if (value === null || value === undefined || value === '') return '\u2014';
  return String(value);
}

function statusWord(status) {
  if (!status) return null;
  const state = status.state;
  if (state === 'NORMAL') return { key: 'up', label: 'Normal' };
  if (state === 'DEGRADED') return { key: 'degraded', label: 'Degraded' };
  if (state === 'OUTAGE') return { key: 'outage', label: 'Outage' };
  if (state === 'UPDATE_ROLLOUT') return { key: 'update', label: 'Update' };
  if (state === 'UNREACHABLE') return { key: 'unreachable', label: 'Unreachable' };
  const key = status.verdictKey;
  if (key === 'up') return { key: 'up', label: 'Normal' };
  if (key === 'outage') return { key: 'outage', label: 'Outage' };
  if (key === 'update') return { key: 'update', label: 'Update' };
  if (key === 'unreachable') return { key: 'unreachable', label: 'Unreachable' };
  return null;
}

function networkUptime24h(status) {
  if (!status || typeof status.offlinePct !== 'number' || !Number.isFinite(status.offlinePct)) return null;
  return Math.round((100 - status.offlinePct) * 10) / 10;
}

function fig(value, suffix = '') {
  if (value === null || value === undefined || Number.isNaN(value)) return '\u2014';
  return `${escapeHtml(String(value))}${suffix}`;
}

function renderHeroBand({ counters, rosterMeta, status }) {
  const official =
    status && typeof status.onlineCount === 'number'
      ? status.onlineCount
      : counters && typeof counters.totalOfficial === 'number'
        ? counters.totalOfficial
        : rosterMeta && rosterMeta.totalOfficial != null
          ? rosterMeta.totalOfficial
          : null;
  const players = counters && typeof counters.playersOnline === 'number' ? counters.playersOnline : null;
  const uptime = networkUptime24h(status);
  const word = statusWord(status);
  const wordHtml = word
    ? `<a class="fig ${escapeHtml(word.key)}" href="/is-ark-down">${escapeHtml(word.label)}</a>`
    : `<a class="fig" href="/is-ark-down">\u2014</a>`;

  const metaLine =
    rosterMeta && rosterMeta.pveCount != null && rosterMeta.pvpCount != null
      ? `<p class="note">Tracking <strong class="num">${escapeHtml(String(rosterMeta.totalOfficial))}</strong> official servers ` +
        `(${escapeHtml(String(rosterMeta.pveCount))} PvE / ${escapeHtml(String(rosterMeta.pvpCount))} PvP). ` +
        `Last updated ${escapeHtml(String(rosterMeta.generatedAt))}.</p>`
      : '';

  return `<section class="hero">
    <div class="hero-stats">
      <div class="hero-stat"><div class="fig num">${fig(official)}</div><div class="lbl">Official Servers Online</div></div>
      <div class="hero-stat"><div class="fig num">${fig(players)}</div><div class="lbl">Players Online</div></div>
      <div class="hero-stat"><div class="fig num">${fig(uptime, '%')}</div><div class="lbl">Network Uptime % (24h)</div></div>
      <div class="hero-stat">${wordHtml}<div class="lbl">Network Status</div></div>
    </div>
    ${metaLine}
  </section>`;
}

function sortLink({ currentSort, currentDir, key, label, filters, basePath = '/servers' }) {
  const nextDir = currentSort === key && currentDir === 'desc' ? 'asc' : 'desc';
  const params = new URLSearchParams({ ...filters, sort: key, dir: nextDir });
  const arrow = currentSort === key ? (currentDir === 'desc' ? ' \u25BC' : ' \u25B2') : '';
  return `<a href="${basePath}?${params.toString()}">${escapeHtml(label)}${arrow}</a>`;
}

function capacityPct(s) {
  const now = s.playersNow;
  const max = s.maxPlayers;
  if (typeof now !== 'number' || typeof max !== 'number' || max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((now / max) * 100)));
}

function formatWipeDate(iso) {
  if (!iso || typeof iso !== 'string') return '';
  const day = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : iso;
}

function renderServerRow(s, { showWipeDate = false } = {}) {
  const online = isOnline(s);
  const rankDisplay = typeof s.rank === 'number' ? String(s.rank) : typeof s.rankScore === 'number' ? String(s.rankScore) : '\u2014';
  const ping = typeof s.wildcardReportedPing === 'number' ? `${s.wildcardReportedPing}` : '\u2014';
  const uptime = typeof s.uptimePercent === 'number' ? `${s.uptimePercent}%` : '\u2014';
  const pct = capacityPct(s);
  const badge = platformBadge(s.platformType);
  const badgeHtml = badge ? `<span class="platform-badge">${escapeHtml(badge)}</span>` : '';
  const wipeHtml =
    showWipeDate && s.wipeDetectedAt
      ? `<div class="wipe-meta">Wiped ${escapeHtml(formatWipeDate(s.wipeDetectedAt))} \u00b7 Day ${escapeHtml(dash(s.day))}</div>`
      : '';
  return `<tr>
      <td><span class="status-dot ${online ? 'online' : 'offline'}" title="${online ? 'Online' : 'Offline'}"></span></td>
      <td class="name"><a href="/servers/${encodeURIComponent(s.id || '')}">${escapeHtml(s.name || '(unnamed)')}</a>${badgeHtml}${wipeHtml}</td>
      <td>${escapeHtml(s.map || '')}</td>
      <td class="num">${escapeHtml(dash(s.day))}</td>
      <td class="num">${escapeHtml(s.version || '\u2014')}</td>
      <td class="num"><div class="cap"><span>${escapeHtml(dash(s.playersNow))} / ${escapeHtml(dash(s.maxPlayers))}</span><span class="cap-bar" aria-hidden="true"><span class="cap-fill" style="width:${pct}%"></span></span></div></td>
      <td class="num">${escapeHtml(ping)}</td>
      <td class="num">${escapeHtml(uptime)}</td>
      <td class="num">${escapeHtml(rankDisplay)}</td>
    </tr>`;
}

function renderPresetBar({ presets = [], loggedIn = false, shareOrigin = '', currentQuery = '' }) {
  if (!presets.length) return '';
  const items = presets
    .map((p) => {
      const href = serversLocation(p.query || p.queryString || '');
      const deleteField = loggedIn && p.id != null
        ? `<input type="hidden" name="id" value="${escapeHtml(String(p.id))}">`
        : `<input type="hidden" name="name" value="${escapeHtml(p.name || '')}">`;
      const share = loggedIn && p.shareToken
        ? `<input class="share-link" type="text" readonly value="${escapeHtml(`${shareOrigin}/p/${p.shareToken}`)}" aria-label="Copy share link">`
        : '';
      return `<span class="preset">
        <a href="${escapeHtml(href)}">${escapeHtml(p.name || '')}</a>
        ${share}
        <form method="POST" action="/presets/delete">
          ${deleteField}
          <input type="hidden" name="returnQuery" value="${escapeHtml(currentQuery)}">
          <button type="submit" aria-label="Delete preset">\u00d7</button>
        </form>
      </span>`;
    })
    .join('');
  return `<div class="presets">${items}</div>`;
}

function renderSavePresetForm(currentQuery) {
  if (!hasActiveFilters(currentQuery)) return '';
  return `<form method="POST" action="/presets" class="save-preset">
    <input type="hidden" name="query" value="${escapeHtml(currentQuery)}">
    <input type="text" name="name" maxlength="40" placeholder="Preset name" required>
    <button type="submit">Save as preset</button>
  </form>`;
}

function renderListIndex() {
  const items = LIST_NAV.map((item) => `<li><a href="${item.href}">${escapeHtml(item.label)}</a></li>`).join('');
  return `<nav class="server-lists" aria-label="Server lists">
    <h2>Server lists</h2>
    <ul>${items}</ul>
  </nav>`;
}

function renderBrowserBody({
  page,
  filters,
  sort,
  dir,
  counters,
  mapOptions,
  platformOptions,
  rosterAvailable,
  presets,
  loggedIn,
  shareOrigin,
  currentQuery,
  presetError,
  rosterMeta,
  status,
  showHero,
  heading = 'Servers',
  intro = '',
  extraNote = '',
  formAction = '/servers',
  basePath = '/servers',
  showPresets = true,
  showListIndex = false,
  browserLink = '',
  showWipeDate = false,
  lockedFilterKeys = [],
}) {
  const f = filters || {};
  const query = currentQuery || '';
  const maps = mapOptions || [];
  const platforms = platformOptions || [];
  const locked = new Set(lockedFilterKeys);
  const errorText = messageForPresetError(presetError);
  const errorBar = errorText ? `<p class="preset-error">${escapeHtml(errorText)}</p>` : '';
  const presetBar = showPresets ? renderPresetBar({ presets, loggedIn, shareOrigin, currentQuery: query }) : '';
  const saveForm = showPresets ? renderSavePresetForm(query) : '';
  const hero = showHero ? renderHeroBand({ counters, rosterMeta, status }) : '';
  const listIndex = showListIndex ? renderListIndex() : '';
  const introHtml = intro ? `<p class="list-intro">${escapeHtml(intro)}</p>` : '';
  const noteHtml = extraNote ? `<p class="list-note">${escapeHtml(extraNote)}</p>` : '';
  const backLink = browserLink ? `<p class="note"><a href="${escapeHtml(browserLink)}">View these filters in the full server browser</a></p>` : '';
  const hiddenLocked = [...locked]
    .filter((key) => f[key] !== undefined && f[key] !== '')
    .map((key) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(String(f[key]))}">`)
    .join('');

  const countersBar = rosterAvailable
    ? `<p class="counters">${escapeHtml(String(counters.totalOfficial))} official servers &middot; ` +
      `${escapeHtml(String(counters.playersOnline))} players online &middot; ` +
      `${counters.avgPing !== null ? escapeHtml(String(counters.avgPing)) + 'ms avg ping' : 'ping unavailable'} &middot; ` +
      `${escapeHtml(String(counters.pveCount))} PvE / ${escapeHtml(String(counters.pvpCount))} PvP</p>`
    : `<p class="counters">Server roster data isn't available right now (the discovery service may not be running).</p>`;
  const homeMetaNote =
    showHero && !rosterMeta
      ? `<p class="note">Server roster data isn't available right now (the discovery service may not be running).</p>`
      : '';
  const matchCount =
    page && typeof page.totalCount === 'number' ? `<p class="counters">${escapeHtml(String(page.totalCount))} matching servers.</p>` : '';

  if (!rosterAvailable) {
    return `${hero}<h1>${escapeHtml(heading)}</h1>${introHtml}${countersBar}${homeMetaNote}`;
  }

  const gameModeSelect = locked.has('gameMode')
    ? ''
    : `<select name="gameMode">
    <option value="">All modes</option>
    <option value="pve" ${f.gameMode === 'pve' ? 'selected' : ''}>PvE</option>
    <option value="pvp" ${f.gameMode === 'pvp' ? 'selected' : ''}>PvP</option>
  </select>`;

  const platformSelect = `<select name="platform" aria-label="Platform">
    <option value="">Any platform</option>
    ${platforms.map((p) => `<option value="${escapeHtml(p)}" ${f.platform === p ? 'selected' : ''}>${escapeHtml(p)}</option>`).join('')}
  </select>`;

  const filterForm = `
<form method="GET" action="${escapeHtml(formAction)}" class="filters">
  ${hiddenLocked}
  <input type="text" name="search" placeholder="Search server name" value="${escapeHtml(f.search || '')}">
  <select name="map">
    <option value="">All maps</option>
    ${maps.map((m) => `<option value="${escapeHtml(m)}" ${f.map === m ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('')}
  </select>
  ${gameModeSelect}
  ${platformSelect}
  <select name="hasPassword">
    <option value="">Any</option>
    <option value="false" ${f.hasPassword === 'false' ? 'selected' : ''}>Public only</option>
    <option value="true" ${f.hasPassword === 'true' ? 'selected' : ''}>Passworded only</option>
  </select>
  <input class="narrow" type="number" name="minPlayers" placeholder="Min players" value="${escapeHtml(f.minPlayers || '')}">
  <input class="narrow" type="number" name="maxPlayers" placeholder="Max players" value="${escapeHtml(f.maxPlayers || '')}">
  <button type="submit">Filter</button>
</form>`;

  const rows = page.items.map((s) => renderServerRow(s, { showWipeDate })).join('');
  const linkOpts = { currentSort: sort, currentDir: dir, filters: f, basePath };

  const resultsTable = page.items.length
    ? `<table class="browser-table">
      <thead><tr>
        <th></th>
        <th>${sortLink({ ...linkOpts, key: 'name', label: 'Name' })}</th>
        <th>${sortLink({ ...linkOpts, key: 'map', label: 'Map' })}</th>
        <th>${sortLink({ ...linkOpts, key: 'day', label: 'Day' })}</th>
        <th>Version</th>
        <th>${sortLink({ ...linkOpts, key: 'players', label: 'Players' })}</th>
        <th>Ping</th>
        <th>Uptime</th>
        <th>${sortLink({ ...linkOpts, key: 'rank', label: 'Rank' })}</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`
    : `<p>No servers match these filters.</p>`;

  const prevParams = new URLSearchParams({ ...f, sort, dir, page: String(page.page - 1) });
  const nextParams = new URLSearchParams({ ...f, sort, dir, page: String(page.page + 1) });
  const pagination = `<p class="pagination">
    ${page.page > 1 ? `<a href="${basePath}?${prevParams.toString()}">&laquo; Prev</a>` : '<span>&laquo; Prev</span>'}
    Page ${page.page} of ${page.totalPages} (${page.totalCount} matching)
    ${page.page < page.totalPages ? `<a href="${basePath}?${nextParams.toString()}">Next &raquo;</a>` : '<span>Next &raquo;</span>'}
  </p>`;

  return `${hero}
  <h1>${escapeHtml(heading)}</h1>
  ${introHtml}
  ${matchCount}
  ${noteHtml}
  ${backLink}
  ${countersBar}
  ${homeMetaNote}
  ${listIndex}
  ${presetBar}
  ${errorBar}
  ${saveForm}
  ${filterForm}
  ${resultsTable}
  ${pagination}`;
}

function renderBrowserPage(opts = {}) {
  const {
    account = null,
    live = null,
    rosterMeta = null,
    currentPath = '/servers',
    showHero = false,
    rosterAvailable,
    documentTitle,
    metaDescription,
  } = opts;
  const title = documentTitle || (currentPath === '/' ? 'ArkHelper' : 'ArkHelper \u2014 Servers');
  const footerLive = live || (rosterMeta ? { totalOfficial: rosterMeta.totalOfficial, generatedAt: rosterMeta.generatedAt } : null);
  return renderPage({
    title,
    description: metaDescription,
    currentPath,
    account,
    live: footerLive,
    extraCss: PAGE_CSS,
    body: renderBrowserBody({
      ...opts,
      showHero: showHero || currentPath === '/',
      showListIndex: opts.showListIndex !== undefined ? opts.showListIndex : Boolean(rosterAvailable) && (currentPath === '/' || currentPath === '/servers'),
    }),
  });
}

module.exports = {
  PAGE_SIZE,
  filterServers,
  sortServers,
  paginateServers,
  computeLiveCounters,
  getDistinctMaps,
  getDistinctPlatforms,
  platformBadge,
  filtersFromSearchParams,
  isOnline,
  freeSlots,
  renderBrowserPage,
  renderBrowserBody,
  renderHeroBand,
  renderPresetBar,
  renderSavePresetForm,
  renderServerRow,
  renderListIndex,
  statusWord,
  networkUptime24h,
  STYLE,
  PAGE_CSS,
};
