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
 */

const http = require('http');
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
} = require('./db.js');
const { renderHomepage, fetchRosterMetaSafe } = require('./home_page.js');
const { fetchJsonSafe } = require('./local_fetch.js');
const {
  filterServers,
  sortServers,
  paginateServers,
  computeLiveCounters,
  getDistinctMaps,
  renderBrowserPage,
} = require('./server_browser.js');
const { renderServerDetailPage, renderServerNotFoundPage, renderRosterUnavailablePage } = require('./server_detail.js');
const { renderBadgeSvg, renderUnknownBadgeSvg } = require('./badge.js');
const { renderFavoritesPage } = require('./favorites_page.js');
const {
  computeModeStats,
  computeMapStats,
  computeClusterStats,
  computePlatformStats,
  getTopServersByPlayers,
  renderStatsPage,
} = require('./stats_page.js');

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
  historyUrlBase = 'http://localhost:8792/history',
  uptimeLeaderboardUrl = 'http://localhost:8792/leaderboards/uptime',
  rankingUrl = 'http://localhost:8792/rankings',
  discordDeps = { buildAuthorizeUrl, exchangeCodeForToken, fetchDiscordUser, generateState },
  homeDeps = { fetchRosterMetaSafe },
  browserDeps = { fetchJsonSafe },
  detailDeps = { fetchJsonSafe },
  statsDeps = { fetchJsonSafe },
}) {
  if (!db) throw new Error('createAuthServer: db is required');
  if (!clientId || !clientSecret) throw new Error('createAuthServer: clientId and clientSecret are required');
  if (!redirectUri) throw new Error('createAuthServer: redirectUri is required');

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://internal'); // base is irrelevant, we only use path+query
    const cookies = parseCookies(req.headers.cookie);

    try {
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
          res.end(renderRosterUnavailablePage());
          return;
        }

        const server = roster.servers.find((s) => s.id === serverId);
        if (!server) {
          res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderServerNotFoundPage(serverId));
          return;
        }

        const account = getAccountBySessionToken(db, cookies[SESSION_COOKIE]);
        const isFavorited = account ? listFavorites(db, account.id).includes(serverId) : false;
        const alertSettings = account ? getAlertSettings(db, account.id, serverId) : null;

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
        });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(body);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/favorites') {
        const account = getAccountBySessionToken(db, cookies[SESSION_COOKIE]);
        if (!account) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderFavoritesPage({ loggedIn: false, servers: [], rosterAvailable: true }));
          return;
        }

        const roster = await detailDeps.fetchJsonSafe(rosterUrl);
        if (!roster || !Array.isArray(roster.servers)) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderFavoritesPage({ loggedIn: true, servers: [], rosterAvailable: false }));
          return;
        }

        const favoriteIds = listFavorites(db, account.id);
        const byId = new Map(roster.servers.map((s) => [s.id, s]));
        const servers = favoriteIds.map((id) => byId.get(id)).filter(Boolean);
        const staleFavoriteIds = favoriteIds.filter((id) => !byId.has(id));

        const body = renderFavoritesPage({ loggedIn: true, servers, rosterAvailable: true, staleFavoriteIds });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(body);
        return;
      }

      const favoriteAddMatch = req.method === 'POST' && url.pathname.match(/^\/favorites\/([^/]+)$/);
      if (favoriteAddMatch) {
        const account = getAccountBySessionToken(db, cookies[SESSION_COOKIE]);
        if (!account) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'must be logged in to favorite a server' }));
          return;
        }
        addFavorite(db, account.id, decodeURIComponent(favoriteAddMatch[1]));
        res.writeHead(302, { Location: `/servers/${favoriteAddMatch[1]}` });
        res.end();
        return;
      }

      const favoriteRemoveMatch = req.method === 'POST' && url.pathname.match(/^\/favorites\/([^/]+)\/remove$/);
      if (favoriteRemoveMatch) {
        const account = getAccountBySessionToken(db, cookies[SESSION_COOKIE]);
        if (!account) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'must be logged in to remove a favorite' }));
          return;
        }
        removeFavorite(db, account.id, decodeURIComponent(favoriteRemoveMatch[1]));
        const referer = req.headers.referer;
        res.writeHead(302, { Location: referer && referer.includes('/favorites') ? '/favorites' : `/servers/${favoriteRemoveMatch[1]}` });
        res.end();
        return;
      }

      const alertSaveMatch = req.method === 'POST' && url.pathname.match(/^\/alerts\/([^/]+)$/);
      if (alertSaveMatch) {
        const account = getAccountBySessionToken(db, cookies[SESSION_COOKIE]);
        if (!account) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'must be logged in to configure alerts' }));
          return;
        }
        const serverId = decodeURIComponent(alertSaveMatch[1]);
        const form = await readFormBody(req);
        upsertAlertSettings(db, account.id, serverId, {
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
          res.end(renderStatsPage({ rosterAvailable: false }));
          return;
        }

        const enrichWithRosterNames = (list) =>
          list.map((s) => {
            const match = roster.servers.find((rs) => rs.id === s.serverId);
            return { ...s, name: match ? match.name : null, map: match ? match.map : null };
          });

        const uptimeLeaderboard = await statsDeps.fetchJsonSafe(`${uptimeLeaderboardUrl}?minRuns=3`);
        const enrichedUptimeLeaderboard = uptimeLeaderboard ? { ...uptimeLeaderboard, servers: enrichWithRosterNames(uptimeLeaderboard.servers) } : undefined;

        const ranking = await statsDeps.fetchJsonSafe(`${rankingUrl}?minRuns=3&limit=25`);
        const enrichedRanking = ranking ? { ...ranking, servers: enrichWithRosterNames(ranking.servers) } : undefined;

        // Compute the body BEFORE writeHead — if rendering throws, we want
        // the outer catch block to still be able to send a clean 502
        // response, not fail with ERR_HTTP_HEADERS_SENT because headers
        // were already committed by an earlier writeHead() call.
        const body = renderStatsPage({
          rosterAvailable: true,
          counters: computeLiveCounters(roster.servers),
          modeStats: computeModeStats(roster.servers),
          mapStats: computeMapStats(roster.servers),
          clusterStats: computeClusterStats(roster.servers),
          platformStats: computePlatformStats(roster.servers),
          topByPlayers: getTopServersByPlayers(roster.servers),
          uptimeAvailable: Boolean(uptimeLeaderboard),
          uptimeLeaderboard: enrichedUptimeLeaderboard,
          rankingAvailable: Boolean(ranking),
          ranking: enrichedRanking,
        });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(body);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/servers') {
        const roster = await browserDeps.fetchJsonSafe(rosterUrl);
        if (!roster || !Array.isArray(roster.servers)) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderBrowserPage({ rosterAvailable: false }));
          return;
        }

        const filters = {
          search: url.searchParams.get('search') || '',
          map: url.searchParams.get('map') || '',
          gameMode: url.searchParams.get('gameMode') || '',
          hasPassword: url.searchParams.get('hasPassword') || '',
          minPlayers: url.searchParams.get('minPlayers') || '',
          maxPlayers: url.searchParams.get('maxPlayers') || '',
          clusterId: url.searchParams.get('clusterId') || '',
        };
        const sort = url.searchParams.get('sort') || 'players';
        const dir = url.searchParams.get('dir') || 'desc';
        const pageNum = url.searchParams.get('page') || '1';

        const filtered = filterServers(roster.servers, filters);
        const sorted = sortServers(filtered, sort, dir);
        const page = paginateServers(sorted, pageNum);

        const body = renderBrowserPage({
          page,
          filters,
          sort,
          dir,
          counters: computeLiveCounters(roster.servers),
          mapOptions: getDistinctMaps(roster.servers),
          rosterAvailable: true,
        });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(body);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/') {
        const account = getAccountBySessionToken(db, cookies[SESSION_COOKIE]);
        const rosterMeta = await homeDeps.fetchRosterMetaSafe(rosterMetaUrl);
        const html = renderHomepage({
          account: account ? { username: account.discord_username, discordId: account.discord_id } : null,
          rosterMeta,
        });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
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

        res.writeHead(302, {
          Location: successRedirect,
          // Clear the state cookie (single-use) and set the real session cookie in one response
          'Set-Cookie': [
            buildSetCookie(STATE_COOKIE, '', { clear: true, secure: cookieSecure }),
            buildSetCookie(SESSION_COOKIE, session.token, { maxAgeSeconds: SESSION_MAX_AGE_SECONDS, secure: cookieSecure }),
          ],
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

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found', routes: ['/', '/servers', '/servers/:id', '/servers/:id/badge.svg', '/stats', '/favorites', '/favorites/:id', '/favorites/:id/remove', '/alerts/:id', '/auth/discord/login', '/auth/discord/callback', '/auth/me', '/auth/logout'] }));
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
};
