#!/usr/bin/env node
'use strict';

/**
 * auth_service.js
 *
 * Wires discord_oauth.js and db.js into an HTTP server: the login
 * redirect, the callback that exchanges the code and creates/updates
 * the account + session, a /auth/me check, and logout. Plain
 * node:http, same style as discovery_service.js's roster feed — no
 * framework dependency.
 *
 * Routes:
 *   GET  /auth/discord/login     -> redirects to Discord's authorize page
 *   GET  /auth/discord/callback  -> exchanges code, creates session, redirects home
 *   GET  /auth/me                -> { loggedIn, account } for the current session
 *   POST /auth/logout            -> clears the session
 *   POST /presets                -> save current filters as a named preset
 *   POST /presets/delete         -> delete a preset (cookie or account)
 *   GET  /p/:token               -> public share-link redirect to /servers?...
 *   GET  /is-ark-down            -> public network status page (alias GET /status)
 *   GET  /maps                   -> official-map index
 *   GET  /maps/:slug             -> per-map telemetry page
 */

const http = require('http');
const crypto = require('node:crypto');
const {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  fetchDiscordUser,
  generateState,
} = require('./discord_oauth.js');
const {
  upsertAccount,
  createSession,
  getAccountBySessionToken,
  deleteSession,
  addFavorite,
  removeFavorite,
  listFavorites,
  upsertAlertSettings,
  getAlertSettings,
  addFilterPreset,
  listFilterPresets,
  deleteFilterPreset,
  getFilterPresetByShareToken,
  migrateCookiePresetsToAccount,
} = require('./db.js');
const { renderHomepage, fetchRosterMetaSafe } = require('./home_page.js');
const { fetchJsonSafe, createTtlCache } = require('./local_fetch.js');
const {
  filterServers,
  sortServers,
  paginateServers,
  computeLiveCounters,
  getDistinctMaps,
  getDistinctPlatforms,
  filtersFromSearchParams,
  renderBrowserPage,
} = require('./server_browser.js');
const { getListDef, attachWipes, applyList, renderListPage } = require('./server_lists.js');
const {
  PRESET_COOKIE,
  PRESET_COOKIE_MAX_AGE_SECONDS,
  messageForPresetError,
  sanitizeQueryString,
  serversLocation,
  parsePresetCookie,
  addCookiePreset,
  deleteCookiePreset,
} = require('./presets.js');
const { renderServerDetailPage, renderServerNotFoundPage, renderRosterUnavailablePage } = require('./server_detail.js');
const { renderBadgeSvg, renderUnknownBadgeSvg } = require('./badge.js');
const { renderFavoritesPage } = require('./favorites_page.js');
const { rankingFromRoster, renderRankingsPage } = require('./rankings_page.js');
const {
  computeMapUptime,
  computePveVsPvp,
  bottomFromRoster,
  renderLeaderboardsIndex,
  renderMapUptimePage,
  renderPveVsPvpPage,
  renderTop100Page,
  renderBottom100Page,
} = require('./leaderboards_page.js');
const {
  computeModeStats,
  computeMapStats,
  computeClusterStats,
  computePlatformStats,
  getTopServersByPlayers,
  renderStatsPage,
} = require('./stats_page.js');
const { renderStatusPage } = require('./status_page.js');
const { resolveSlug } = require('./maps.js');
const {
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
} = require('./maps_page.js');

const SESSION_COOKIE = 'ark_session';
const STATE_COOKIE = 'ark_oauth_state';
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days, matches db.js's DEFAULT_SESSION_TTL_MS
const STATE_MAX_AGE_SECONDS = 10 * 60; // 10 minutes — the login round-trip should never take longer

// ---------------------------------------------------------------------
// Cookie helpers (node:http doesn't parse/build these itself)
// ---------------------------------------------------------------------
function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

function buildSetCookie(name, value, { maxAgeSeconds, secure = false, clear = false } = {}) {
  const parts = [`${name}=${clear ? '' : encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  parts.push(`Max-Age=${clear ? 0 : maxAgeSeconds}`);
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

// Reads and parses an application/x-www-form-urlencoded POST body (what
// a plain HTML <form method="POST"> sends with no enctype override).
// Note: unchecked checkboxes are never sent at all by browsers, so
// their absence from the parsed object means "unchecked" — callers
// need to check `'fieldName' in parsed`, not just falsiness.
function readFormBody(req, { maxBytes = 1_000_000 } = {}) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        reject(new Error('form body too large'));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      const params = new URLSearchParams(body);
      resolve(Object.fromEntries(params.entries()));
    });
    req.on('error', reject);
  });
}

function accountView(row) {
  if (!row) return null;
  return { username: row.discord_username, discordId: row.discord_id };
}

function liveFromRoster(roster) {
  if (!roster) return null;
  const total = roster.totalOfficial != null ? roster.totalOfficial : Array.isArray(roster.servers) ? roster.servers.length : null;
  if (total == null && !roster.generatedAt) return null;
  return { totalOfficial: total, generatedAt: roster.generatedAt || null };
}

function liveFromMeta(meta) {
  if (!meta) return null;
  return { totalOfficial: meta.totalOfficial, generatedAt: meta.generatedAt };
}

async function withWipesIfNeeded(servers, filters, fetchJsonSafe, wipesUrl) {
  if (!filters || !filters.wipedWithinDays) return { servers, wipesAvailable: true };
  const days = Number(filters.wipedWithinDays);
  const url = `${wipesUrl}?days=${Number.isFinite(days) && days > 0 ? days : 14}`;
  const data = await fetchJsonSafe(url);
  if (!data || !Array.isArray(data.wipes)) return { servers, wipesAvailable: false };
  return { servers: attachWipes(servers, data.wipes), wipesAvailable: true };
}

function shareOriginFromReq(req, cookieSecure) {
  const host = req.headers.host || 'localhost';
  const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = cookieSecure || forwarded === 'https' ? 'https' : 'http';
  return `${proto}://${host}`;
}

function notFoundShare(res) {
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
}

function redirectWithPresetError(res, query, code) {
  const base = serversLocation(query);
  const location = `${base}${base.includes('?') ? '&' : '?'}presetError=${encodeURIComponent(code)}`;
  res.writeHead(302, { Location: location });
  res.end();
}

// ---------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------
function createAuthServer({
  db,
  clientId,
  clientSecret,
  redirectUri,
  cookieSecure = false,
  successRedirect = '/',
  rosterMetaUrl = 'http://localhost:8792/roster/meta',
  rosterUrl = 'http://localhost:8792/roster',
  unofficialRosterUrl = 'http://localhost:8792/unofficial/roster',
  unofficialMetaUrl = 'http://localhost:8792/unofficial/meta',
  unofficialRosterCache,
  historyUrlBase = 'http://localhost:8792/history',
  uptimeLeaderboardUrl = 'http://localhost:8792/leaderboards/uptime',
  rankingUrl = 'http://localhost:8792/rankings',
  incidentStatusUrl = 'http://localhost:8792/incidents/status',
  discordDeps = { buildAuthorizeUrl, exchangeCodeForToken, fetchDiscordUser, generateState },
  homeDeps = { fetchRosterMetaSafe },
  browserDeps = { fetchJsonSafe },
  detailDeps = { fetchJsonSafe },
  statsDeps = { fetchJsonSafe },
  statusDeps = { fetchJsonSafe },
  randomToken = () => crypto.randomBytes(32).toString('hex'),
}) {
  if (!db) throw new Error('createAuthServer: db is required');
  if (!clientId || !clientSecret) throw new Error('createAuthServer: clientId and clientSecret are required');
  if (!redirectUri) throw new Error('createAuthServer: redirectUri is required');

  const rosterCache = unofficialRosterCache || createTtlCache();

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://internal'); // base is irrelevant, we only use path+query
    const cookies = parseCookies(req.headers.cookie);
    const accountRow = getAccountBySessionToken(db, cookies[SESSION_COOKIE]);
    const account = accountView(accountRow);

    try {
      const shareMatch = req.method === 'GET' && url.pathname.match(/^\/p\/([^/]+)$/);
      if (shareMatch) {
        let token;
        try {
          token = decodeURIComponent(shareMatch[1]);
        } catch {
          notFoundShare(res);
          return;
        }
        const preset = getFilterPresetByShareToken(db, token);
        if (!preset) {
          notFoundShare(res);
          return;
        }
        const location = serversLocation(preset.queryString);
        res.writeHead(302, { Location: location });
        res.end();
        return;
      }

      const badgeMatch = req.method === 'GET' && url.pathname.match(/^\/servers\/([^/]+)\/badge\.svg$/);
      if (badgeMatch) {
        const serverId = decodeURIComponent(badgeMatch[1]);
        const roster = await detailDeps.fetchJsonSafe(rosterUrl);
        const server = roster && Array.isArray(roster.servers) ? roster.servers.find((s) => s.id === serverId) : null;

        const svg = server
          ? renderBadgeSvg({ name: server.name, status: 'online', playersNow: server.playersNow, maxPlayers: server.maxPlayers })
          : renderUnknownBadgeSvg(); // roster unreachable, or this id isn't currently registered — never a broken image

        res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-cache' });
        res.end(svg);
        return;
      }

      if (req.method === 'GET' && /^\/servers\/[^/]+$/.test(url.pathname)) {
        const serverId = decodeURIComponent(url.pathname.slice('/servers/'.length));
        const roster = await detailDeps.fetchJsonSafe(rosterUrl);
        if (!roster || !Array.isArray(roster.servers)) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderRosterUnavailablePage({ account }));
          return;
        }

        const server = roster.servers.find((s) => s.id === serverId);
        if (!server) {
          res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderServerNotFoundPage(serverId, { account, live: liveFromRoster(roster) }));
          return;
        }

        const isFavorited = accountRow ? listFavorites(db, accountRow.id).includes(serverId) : false;
        const alertSettings = accountRow ? getAlertSettings(db, accountRow.id, serverId) : null;

        const historyData = await detailDeps.fetchJsonSafe(`${historyUrlBase}/${encodeURIComponent(serverId)}`);
        const body = renderServerDetailPage({
          server,
          uptime: historyData ? historyData.uptime : null,
          history: historyData ? historyData.history : [],
          changeLog: historyData ? historyData.changeLog : [],
          peakTimes: historyData ? historyData.peakTimes : undefined,
          downtimePatterns: historyData ? historyData.downtimePatterns : undefined,
          loggedIn: Boolean(account),
          isFavorited,
          alertSettings,
          badgeUrl: `/servers/${encodeURIComponent(serverId)}/badge.svg`,
          account,
          live: liveFromRoster(roster),
        });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(body);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/favorites') {
        if (!accountRow) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderFavoritesPage({ loggedIn: false, servers: [], rosterAvailable: true, account }));
          return;
        }

        const roster = await detailDeps.fetchJsonSafe(rosterUrl);
        if (!roster || !Array.isArray(roster.servers)) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderFavoritesPage({ loggedIn: true, servers: [], rosterAvailable: false, account }));
          return;
        }

        const favoriteIds = listFavorites(db, accountRow.id);
        const byId = new Map(roster.servers.map((s) => [s.id, s]));
        const servers = favoriteIds.map((id) => byId.get(id)).filter(Boolean);
        const staleFavoriteIds = favoriteIds.filter((id) => !byId.has(id));

        const body = renderFavoritesPage({ loggedIn: true, servers, rosterAvailable: true, staleFavoriteIds, account, live: liveFromRoster(roster) });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(body);
        return;
      }

      const favoriteAddMatch = req.method === 'POST' && url.pathname.match(/^\/favorites\/([^/]+)$/);
      if (favoriteAddMatch) {
        if (!accountRow) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'must be logged in to favorite a server' }));
          return;
        }
        addFavorite(db, accountRow.id, decodeURIComponent(favoriteAddMatch[1]));
        res.writeHead(302, { Location: `/servers/${favoriteAddMatch[1]}` });
        res.end();
        return;
      }

      const favoriteRemoveMatch = req.method === 'POST' && url.pathname.match(/^\/favorites\/([^/]+)\/remove$/);
      if (favoriteRemoveMatch) {
        if (!accountRow) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'must be logged in to remove a favorite' }));
          return;
        }
        removeFavorite(db, accountRow.id, decodeURIComponent(favoriteRemoveMatch[1]));
        const referer = req.headers.referer;
        res.writeHead(302, { Location: referer && referer.includes('/favorites') ? '/favorites' : `/servers/${favoriteRemoveMatch[1]}` });
        res.end();
        return;
      }

      const alertSaveMatch = req.method === 'POST' && url.pathname.match(/^\/alerts\/([^/]+)$/);
      if (alertSaveMatch) {
        if (!accountRow) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'must be logged in to configure alerts' }));
          return;
        }
        const serverId = decodeURIComponent(alertSaveMatch[1]);
        const form = await readFormBody(req);
        upsertAlertSettings(db, accountRow.id, serverId, {
          notifyDown: 'notifyDown' in form, // checkboxes only appear in the body when checked
          notifyOnline: 'notifyOnline' in form,
          capacityThresholdPct: form.capacityThresholdPct,
          minFreeSlots: form.minFreeSlots,
        });
        res.writeHead(302, { Location: `/servers/${alertSaveMatch[1]}` });
        res.end();
        return;
      }

      if (req.method === 'GET' && url.pathname === '/stats') {
        const roster = await statsDeps.fetchJsonSafe(rosterUrl);
        if (!roster || !Array.isArray(roster.servers)) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderStatsPage({ rosterAvailable: false, account }));
          return;
        }

        const body = renderStatsPage({
          rosterAvailable: true,
          counters: computeLiveCounters(roster.servers),
          modeStats: computeModeStats(roster.servers),
          mapStats: computeMapStats(roster.servers),
          clusterStats: computeClusterStats(roster.servers),
          platformStats: computePlatformStats(roster.servers),
          topByPlayers: getTopServersByPlayers(roster.servers),
          account,
          live: liveFromRoster(roster),
        });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(body);
        return;
      }

      if (req.method === 'GET' && (url.pathname === '/is-ark-down' || url.pathname === '/status')) {
        const [status, rosterMeta] = await Promise.all([
          statusDeps.fetchJsonSafe(incidentStatusUrl),
          homeDeps.fetchRosterMetaSafe(rosterMetaUrl),
        ]);
        const body = renderStatusPage({
          statusAvailable: Boolean(status),
          status,
          account,
          live: liveFromMeta(rosterMeta),
        });
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, max-age=30',
        });
        res.end(body);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/rankings') {
        const roster = await browserDeps.fetchJsonSafe(rosterUrl);
        if (!roster || !Array.isArray(roster.servers)) {
          const body = renderRankingsPage({ rosterAvailable: false, account });
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(body);
          return;
        }

        const ranking = rankingFromRoster(roster.servers);
        const body = renderRankingsPage({ rosterAvailable: true, ranking, account, live: liveFromRoster(roster) });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(body);
        return;
      }

      if (req.method === 'GET' && (url.pathname === '/leaderboards' || url.pathname.startsWith('/leaderboards/'))) {
        const slug = url.pathname === '/leaderboards' ? '' : url.pathname.slice('/leaderboards/'.length);
        const known = new Set(['', 'map-uptime', 'pve-vs-pvp', 'top-100', 'bottom-100']);
        if (slug.includes('/') || !known.has(slug)) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'not found' }));
          return;
        }

        const roster = await browserDeps.fetchJsonSafe(rosterUrl);
        const live = liveFromRoster(roster);
        const rosterAvailable = Boolean(roster && Array.isArray(roster.servers));
        const servers = rosterAvailable ? roster.servers : [];

        let body;
        if (slug === '') {
          body = renderLeaderboardsIndex({ account, live, rosterAvailable });
        } else if (slug === 'map-uptime') {
          body = renderMapUptimePage({
            rosterAvailable,
            maps: rosterAvailable ? computeMapUptime(servers) : [],
            account,
            live,
          });
        } else if (slug === 'pve-vs-pvp') {
          body = renderPveVsPvpPage({
            rosterAvailable,
            comparison: rosterAvailable ? computePveVsPvp(servers) : null,
            account,
            live,
          });
        } else if (slug === 'top-100') {
          body = renderTop100Page({
            rosterAvailable,
            ranking: rosterAvailable ? rankingFromRoster(servers) : { servers: [], totalRanked: 0 },
            account,
            live,
          });
        } else {
          body = renderBottom100Page({
            rosterAvailable,
            ranking: rosterAvailable ? bottomFromRoster(servers) : { servers: [], totalRanked: 0 },
            account,
            live,
          });
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(body);
        return;
      }

      if (req.method === 'GET' && (url.pathname === '/maps' || url.pathname.startsWith('/maps/'))) {
        let slug = url.pathname === '/maps' ? '' : url.pathname.slice('/maps/'.length);
        try {
          slug = decodeURIComponent(slug);
        } catch {
          res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderMapNotFoundPage({ slug: url.pathname.slice('/maps/'.length), account }));
          return;
        }
        if (slug.includes('/')) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'not found' }));
          return;
        }

        const roster = await browserDeps.fetchJsonSafe(rosterUrl);
        const live = liveFromRoster(roster);
        const rosterAvailable = Boolean(roster && Array.isArray(roster.servers));
        const servers = rosterAvailable ? roster.servers : [];

        if (slug === '') {
          const body = renderMapIndexPage({
            rosterAvailable,
            maps: rosterAvailable ? computeMapIndex(servers) : [],
            account,
            live,
          });
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(body);
          return;
        }

        const mapInfo = resolveSlug(slug, rosterAvailable ? getDistinctMaps(servers) : []);
        if (!mapInfo) {
          const body = renderMapNotFoundPage({ slug, account, live });
          res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(body);
          return;
        }

        const mapServers = serversForMap(servers, mapInfo.id);
        const body = renderMapPage({
          rosterAvailable,
          map: mapInfo,
          servers: mapServers,
          telemetry: computeMapTelemetry(mapServers),
          breakdown: computeMapBreakdown(mapServers),
          versions: computeVersionCounts(mapServers),
          leading: leadingServers(mapServers),
          unavailable: unavailableServers(mapServers),
          account,
          live,
        });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(body);
        return;
      }

      const listMatch = req.method === 'GET' && url.pathname.match(/^\/lists\/([^/]+)$/);
      if (listMatch) {
        const def = getListDef(listMatch[1]);
        if (!def) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'not found' }));
          return;
        }

        const roster = await browserDeps.fetchJsonSafe(rosterUrl);
        const live = liveFromRoster(roster);
        if (!roster || !Array.isArray(roster.servers)) {
          const body = renderListPage({
            list: def,
            rosterAvailable: false,
            account,
            live,
            filters: def.filters,
            page: { items: [], page: 1, totalPages: 1, totalCount: 0 },
            sort: def.sort,
            dir: def.dir,
            counters: computeLiveCounters([]),
            mapOptions: [],
            platformOptions: [],
          });
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(body);
          return;
        }

        const queryFilters = filtersFromSearchParams(url.searchParams);
        const wipesUrl = `${historyUrlBase}/wipes`;
        let servers = roster.servers;
        let extraNote;
        if (def.needsWipes || queryFilters.wipedWithinDays) {
          const wipeResult = await withWipesIfNeeded(servers, { wipedWithinDays: def.filters.wipedWithinDays || queryFilters.wipedWithinDays }, browserDeps.fetchJsonSafe, wipesUrl);
          servers = wipeResult.servers;
          if (!wipeResult.wipesAvailable) {
            extraNote = 'Wipe history isn\'t available right now (the discovery history feed may not be running).';
            servers = servers.map((s) => ({ ...s }));
          }
        }

        const view = applyList(servers, def, queryFilters, { page: url.searchParams.get('page') || '1' });
        const body = renderListPage({
          list: def,
          page: view.page,
          filters: view.filters,
          sort: view.sort,
          dir: view.dir,
          counters: computeLiveCounters(roster.servers),
          mapOptions: getDistinctMaps(roster.servers),
          platformOptions: getDistinctPlatforms(roster.servers),
          rosterAvailable: true,
          account,
          live,
          extraNote,
        });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(body);
        return;
      }

      if (req.method === 'GET' && (url.pathname === '/servers' || url.pathname === '/')) {
        const isHome = url.pathname === '/';
        const source = url.searchParams.get('source') === 'unofficial' ? 'unofficial' : 'official';
        const officialRosterPromise = browserDeps.fetchJsonSafe(rosterUrl);
        const rosterPromise = source === 'unofficial'
          ? rosterCache.get(unofficialRosterUrl, (target) => browserDeps.fetchJsonSafe(target, { timeoutMs: 15000 }))
          : officialRosterPromise;
        const [roster, officialRoster, rosterMeta, status, unofficialMeta] = await Promise.all([
          rosterPromise,
          officialRosterPromise,
          homeDeps.fetchRosterMetaSafe(rosterMetaUrl),
          statusDeps.fetchJsonSafe(incidentStatusUrl),
          homeDeps.fetchRosterMetaSafe(unofficialMetaUrl),
        ]);
        const live = liveFromRoster(roster) || liveFromMeta(rosterMeta);
        const officialCounters =
          officialRoster && Array.isArray(officialRoster.servers)
            ? computeLiveCounters(officialRoster.servers)
            : null;

        if (!roster || !Array.isArray(roster.servers)) {
          const fallbackOpts = { account, rosterMeta, unofficialMeta, status, live, rosterAvailable: false, source, officialCounters };
          const body = isHome
            ? renderHomepage(fallbackOpts)
            : renderBrowserPage({ ...fallbackOpts, currentPath: '/servers' });
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(body);
          return;
        }

        const filters = filtersFromSearchParams(url.searchParams);
        const sort = url.searchParams.get('sort') || 'players';
        const dir = url.searchParams.get('dir') || 'desc';
        const pageNum = url.searchParams.get('page') || '1';

        let servers = roster.servers;
        if (source === 'official') {
          const wipeResult = await withWipesIfNeeded(roster.servers, filters, browserDeps.fetchJsonSafe, `${historyUrlBase}/wipes`);
          servers = wipeResult.servers;
        }
        const filtered = filterServers(servers, filters);
        const sorted = sortServers(filtered, sort, dir);
        const page = paginateServers(sorted, pageNum);

        const setCookies = [];
        if (accountRow && cookies[PRESET_COOKIE]) {
          const cookiePresets = parsePresetCookie(cookies[PRESET_COOKIE]);
          if (cookiePresets.length) {
            migrateCookiePresetsToAccount(db, accountRow.id, cookiePresets, { randomToken });
          }
          setCookies.push(buildSetCookie(PRESET_COOKIE, '', { clear: true, secure: cookieSecure }));
        }

        const presets = accountRow ? listFilterPresets(db, accountRow.id) : parsePresetCookie(cookies[PRESET_COOKIE]);
        const currentQuery = sanitizeQueryString(url.search);
        const errorCode = url.searchParams.get('presetError');
        const presetError = messageForPresetError(errorCode) ? errorCode : '';

        const browserOpts = {
          page,
          filters,
          sort,
          dir,
          counters: computeLiveCounters(roster.servers),
          officialCounters,
          mapOptions: getDistinctMaps(roster.servers),
          platformOptions: getDistinctPlatforms(roster.servers),
          rosterAvailable: true,
          presets,
          loggedIn: Boolean(accountRow),
          shareOrigin: shareOriginFromReq(req, cookieSecure),
          currentQuery,
          presetError,
          account,
          live,
          rosterMeta,
          unofficialMeta,
          status,
          source,
          cyclesTotal: typeof roster.cycles_total === 'number' ? roster.cycles_total : undefined,
          currentPath: isHome ? '/' : '/servers',
          showHero: true,
        };
        const body = isHome ? renderHomepage(browserOpts) : renderBrowserPage(browserOpts);
        const headers = { 'Content-Type': 'text/html; charset=utf-8' };
        if (setCookies.length) headers['Set-Cookie'] = setCookies.length === 1 ? setCookies[0] : setCookies;
        res.writeHead(200, headers);
        res.end(body);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/auth/discord/login') {
        const state = discordDeps.generateState();
        const authorizeUrl = discordDeps.buildAuthorizeUrl({ clientId, redirectUri, state });
        res.writeHead(302, {
          Location: authorizeUrl,
          'Set-Cookie': buildSetCookie(STATE_COOKIE, state, { maxAgeSeconds: STATE_MAX_AGE_SECONDS, secure: cookieSecure }),
        });
        res.end();
        return;
      }

      if (req.method === 'GET' && url.pathname === '/auth/discord/callback') {
        const code = url.searchParams.get('code');
        const returnedState = url.searchParams.get('state');
        const oauthError = url.searchParams.get('error');

        if (oauthError) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Discord returned an error: ${oauthError}` }));
          return;
        }

        if (!returnedState || !cookies[STATE_COOKIE] || returnedState !== cookies[STATE_COOKIE]) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid or missing state — possible CSRF attempt, or the login took too long' }));
          return;
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'missing authorization code' }));
          return;
        }

        const token = await discordDeps.exchangeCodeForToken({ code, clientId, clientSecret, redirectUri });
        const discordUser = await discordDeps.fetchDiscordUser({ accessToken: token.accessToken });
        const account = upsertAccount(db, {
          discordId: discordUser.id,
          username: discordUser.username,
          avatar: discordUser.avatar,
        });
        const session = createSession(db, account.id);

        const setCookies = [
          buildSetCookie(STATE_COOKIE, '', { clear: true, secure: cookieSecure }),
          buildSetCookie(SESSION_COOKIE, session.token, { maxAgeSeconds: SESSION_MAX_AGE_SECONDS, secure: cookieSecure }),
        ];
        if (cookies[PRESET_COOKIE]) {
          const cookiePresets = parsePresetCookie(cookies[PRESET_COOKIE]);
          if (cookiePresets.length) {
            migrateCookiePresetsToAccount(db, account.id, cookiePresets, { randomToken });
          }
          setCookies.push(buildSetCookie(PRESET_COOKIE, '', { clear: true, secure: cookieSecure }));
        }

        res.writeHead(302, {
          Location: successRedirect,
          'Set-Cookie': setCookies,
        });
        res.end();
        return;
      }

      if (req.method === 'GET' && url.pathname === '/auth/me') {
        const account = getAccountBySessionToken(db, cookies[SESSION_COOKIE]);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (!account) {
          res.end(JSON.stringify({ loggedIn: false }));
        } else {
          res.end(
            JSON.stringify({
              loggedIn: true,
              account: { id: account.id, discordId: account.discord_id, username: account.discord_username, avatar: account.discord_avatar },
            })
          );
        }
        return;
      }

      if (req.method === 'POST' && url.pathname === '/auth/logout') {
        if (cookies[SESSION_COOKIE]) deleteSession(db, cookies[SESSION_COOKIE]);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Set-Cookie': buildSetCookie(SESSION_COOKIE, '', { clear: true, secure: cookieSecure }),
        });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/presets') {
        const form = await readFormBody(req);
        const query = sanitizeQueryString(form.query);
        const account = getAccountBySessionToken(db, cookies[SESSION_COOKIE]);

        if (account) {
          const result = addFilterPreset(db, account.id, { name: form.name, queryString: query }, { randomToken });
          if (result.error) {
            redirectWithPresetError(res, query, result.error);
            return;
          }
          res.writeHead(302, { Location: serversLocation(query) });
          res.end();
          return;
        }

        const existing = parsePresetCookie(cookies[PRESET_COOKIE]);
        const result = addCookiePreset(existing, { name: form.name, query }, { secure: cookieSecure });
        if (result.error) {
          redirectWithPresetError(res, query, result.error);
          return;
        }
        res.writeHead(302, {
          Location: serversLocation(query),
          'Set-Cookie': buildSetCookie(PRESET_COOKIE, result.serialized, {
            maxAgeSeconds: PRESET_COOKIE_MAX_AGE_SECONDS,
            secure: cookieSecure,
          }),
        });
        res.end();
        return;
      }

      if (req.method === 'POST' && url.pathname === '/presets/delete') {
        const form = await readFormBody(req);
        const account = getAccountBySessionToken(db, cookies[SESSION_COOKIE]);
        const returnLoc = serversLocation(form.returnQuery);

        if (account) {
          const id = Number(form.id);
          if (Number.isInteger(id) && id > 0) deleteFilterPreset(db, account.id, id);
          res.writeHead(302, { Location: returnLoc });
          res.end();
          return;
        }

        const existing = parsePresetCookie(cookies[PRESET_COOKIE]);
        const result = deleteCookiePreset(existing, form.name);
        const cookie = result.presets.length
          ? buildSetCookie(PRESET_COOKIE, result.serialized, { maxAgeSeconds: PRESET_COOKIE_MAX_AGE_SECONDS, secure: cookieSecure })
          : buildSetCookie(PRESET_COOKIE, '', { clear: true, secure: cookieSecure });
        res.writeHead(302, { Location: returnLoc, 'Set-Cookie': cookie });
        res.end();
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found', routes: ['/', '/servers', '/servers/:id', '/servers/:id/badge.svg', '/lists/:slug', '/maps', '/maps/:slug', '/stats', '/rankings', '/is-ark-down', '/status', '/favorites', '/favorites/:id', '/favorites/:id/remove', '/alerts/:id', '/presets', '/presets/delete', '/p/:token', '/auth/discord/login', '/auth/discord/callback', '/auth/me', '/auth/logout'] }));
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `auth flow failed: ${err.message}` }));
    }
  });
}

// ---------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------
async function main() {
  const { openDb } = require('./db.js');
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  const port = Number(process.env.AUTH_PORT || 8793);
  const redirectUri = process.env.DISCORD_REDIRECT_URI || `http://localhost:${port}/auth/discord/callback`;
  const dbPath = process.env.ARK_TOOLS_DB_PATH || 'ark_tools.db';

  if (!clientId || !clientSecret) {
    console.log('[auth] DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET must both be set as environment variables.');
    process.exitCode = 1;
    return;
  }

  const db = openDb(dbPath);
  const server = createAuthServer({ db, clientId, clientSecret, redirectUri });
  server.listen(port, () => {
    console.log(`[auth] listening on :${port}, redirect URI ${redirectUri}, db ${dbPath}`);
    console.log(`[auth] open http://localhost:${port}/ in a browser`);
  });

  const shutdown = () => {
    console.log('[auth] shutting down');
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[auth] fatal:', err.message);
    process.exitCode = 1;
  });
}

module.exports = {
  parseCookies,
  buildSetCookie,
  createAuthServer,
  SESSION_COOKIE,
  STATE_COOKIE,
  PRESET_COOKIE,
};
