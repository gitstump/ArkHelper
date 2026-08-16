#!/usr/bin/env node
'use strict';

/**
 * server_lists.js
 *
 * Canonical derived list pages. Each slug is a pre-filtered/pre-sorted
 * view of the official roster that reuses server_browser.js filtering,
 * sorting, pagination, and row rendering — not a forked table.
 */

const { serversLocation } = require('./presets.js');
const {
  filterServers,
  sortServers,
  paginateServers,
  renderBrowserPage,
} = require('./server_browser.js');

const LIST_DEFS = {
  'official-pve': {
    slug: 'official-pve',
    path: '/lists/official-pve',
    heading: 'Official PvE servers',
    documentTitle: 'ARK Official PvE Servers \u2014 ArkHelper',
    metaDescription:
      'Browse official ARK: Survival Ascended PvE servers ranked by uptime, ping, and population. Find the best PvE servers on the live network.',
    description: 'Official PvE servers on the live ARK: Survival Ascended network, sorted by composite rank.',
    filters: { gameMode: 'pve' },
    sort: 'rank',
    dir: 'desc',
    lockedKeys: ['gameMode'],
  },
  'official-pvp': {
    slug: 'official-pvp',
    path: '/lists/official-pvp',
    heading: 'Official PvP servers',
    documentTitle: 'ARK Official PvP Servers \u2014 ArkHelper',
    metaDescription:
      'Browse official ARK: Survival Ascended PvP servers ranked by uptime, ping, and population. Find the best PvP servers on the live network.',
    description: 'Official PvP servers on the live ARK: Survival Ascended network, sorted by composite rank.',
    filters: { gameMode: 'pvp' },
    sort: 'rank',
    dir: 'desc',
    lockedKeys: ['gameMode'],
  },
  'low-ping': {
    slug: 'low-ping',
    path: '/lists/low-ping',
    heading: 'Low ping ARK servers',
    documentTitle: 'ARK Low Ping Servers \u2014 ArkHelper',
    metaDescription:
      'Find ARK low ping servers on the official Survival Ascended network. Online official servers sorted by Wildcard-reported ping, lowest first.',
    description: 'Online official servers with a reported ping, sorted from lowest ping to highest.',
    filters: { online: 'true', hasPing: 'true' },
    sort: 'ping',
    dir: 'asc',
    lockedKeys: ['online', 'hasPing'],
  },
  'most-populated': {
    slug: 'most-populated',
    path: '/lists/most-populated',
    heading: 'Most populated ARK servers',
    documentTitle: 'Most Populated ARK Servers \u2014 ArkHelper',
    metaDescription:
      'The most populated ARK: Survival Ascended official servers right now, sorted by players online.',
    description: 'Online official servers sorted by current player count, most populated first.',
    filters: { online: 'true' },
    sort: 'players',
    dir: 'desc',
    lockedKeys: ['online'],
  },
  'recently-wiped': {
    slug: 'recently-wiped',
    path: '/lists/recently-wiped',
    heading: 'Recently wiped ARK servers',
    documentTitle: 'Recently Wiped ARK Servers \u2014 ArkHelper',
    metaDescription:
      'Recently wiped ARK servers on the official Survival Ascended network. Official servers with a wipe or day-reset detected in the last 14 days.',
    description: 'Official servers with a wipe or day-reset detected in the last 14 days, most recent first.',
    filters: { wipedWithinDays: '14' },
    sort: 'wipedAt',
    dir: 'desc',
    lockedKeys: ['wipedWithinDays'],
    needsWipes: true,
    showWipeDate: true,
  },
  'available-now': {
    slug: 'available-now',
    path: '/lists/available-now',
    heading: 'ARK servers available now',
    documentTitle: 'ARK Servers Available Now \u2014 ArkHelper',
    metaDescription:
      'ARK servers available now: official Survival Ascended servers that are online, not full, and have at least 5 observed free slots.',
    description: 'Online official servers with at least 5 observed free slots, not full, sorted by free slots remaining.',
    extraNote: 'Slot counts are observed from the last roster snapshot, not reserved. A slot can fill before you join.',
    filters: { online: 'true', minFreeSlots: '5', notFull: 'true' },
    sort: 'freeSlots',
    dir: 'desc',
    lockedKeys: ['online', 'minFreeSlots', 'notFull'],
  },
};

function getListDef(slug) {
  return LIST_DEFS[slug] || null;
}

function attachWipes(servers, wipes) {
  const byId = new Map();
  for (const w of Array.isArray(wipes) ? wipes : []) {
    if (!w || !w.serverId || !w.seenAt) continue;
    const prev = byId.get(w.serverId);
    if (!prev || w.seenAt > prev.seenAt) byId.set(w.serverId, w);
  }
  return servers.map((s) => {
    const w = byId.get(s.id);
    return w ? { ...s, wipeDetectedAt: w.seenAt } : s;
  });
}

function extraFiltersFrom(queryFilters, def) {
  const locked = new Set(def.lockedKeys || []);
  const extra = {};
  for (const [key, value] of Object.entries(queryFilters || {})) {
    if (locked.has(key)) continue;
    if (def.filters && Object.prototype.hasOwnProperty.call(def.filters, key)) continue;
    extra[key] = value;
  }
  return extra;
}

function applyList(servers, def, queryFilters = {}, { now = Date.now, page = 1, pageSize } = {}) {
  const filters = { ...(queryFilters || {}), ...def.filters };
  const filtered = filterServers(servers, filters, { now });
  const sorted = sortServers(filtered, def.sort, def.dir);
  return {
    filters,
    sort: def.sort,
    dir: def.dir,
    filtered,
    sorted,
    page: paginateServers(sorted, page, pageSize),
  };
}

function browserQueryString(def, extraFilters = {}) {
  const merged = { ...def.filters, sort: def.sort, dir: def.dir };
  for (const [key, value] of Object.entries(extraFilters || {})) {
    if ((def.lockedKeys || []).includes(key)) continue;
    if (value) merged[key] = value;
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return params.toString();
}

function renderListPage(opts = {}) {
  const def = opts.list;
  const extra = extraFiltersFrom(opts.filters, def);
  return renderBrowserPage({
    ...opts,
    currentPath: def.path,
    showHero: false,
    showPresets: false,
    showListIndex: false,
    heading: def.heading,
    intro: def.description,
    extraNote: def.extraNote || opts.extraNote || '',
    formAction: def.path,
    basePath: def.path,
    documentTitle: def.documentTitle,
    metaDescription: def.metaDescription,
    browserLink: serversLocation(browserQueryString(def, extra)),
    showWipeDate: Boolean(def.showWipeDate),
    lockedFilterKeys: def.lockedKeys || [],
  });
}

module.exports = {
  LIST_DEFS,
  getListDef,
  attachWipes,
  extraFiltersFrom,
  applyList,
  browserQueryString,
  renderListPage,
};
