#!/usr/bin/env node
'use strict';

/**
 * steam_discovery.js
 *
 * Replaces server_discovery.js as the roster source. BattleMetrics now
 * gates its API behind a subscription that (confirmed live, twice) does
 * NOT include Premium — so instead this talks directly to Valve's own
 * Steam Web API, which is free and only needs a Steam API key (no
 * payment): https://steamcommunity.com/dev/apikey
 *
 * Endpoint: IGameServersService/GetServerList
 * Docs: https://partner.steamgames.com/doc/webapi/IGameServersService
 * Filter syntax: https://developer.valvesoftware.com/wiki/Master_Server_Query_Protocol#Filter
 *
 * ARK: Survival Ascended's dedicated server Steam App ID is 2430930
 * (confirmed against SteamDB, the official ARK wiki's dedicated-server
 * setup page, and multiple independent hosting guides).
 *
 * HONEST CAVEATS (read before trusting this against live data):
 * 1. This sandbox can't reach api.steampowered.com, so — same situation
 *    as server_discovery.js before it — this is built to Valve's
 *    documented request/response shape, not independently verified live.
 *    Run `discover-once --debug` first.
 * 2. Steam's server list has no explicit "is this an official Wildcard
 *    server" flag — that's not a concept Steam's matchmaking knows about.
 *    The heuristic here is: official ARK:SA servers have the literal word
 *    "Official" in their server name (directly observed in real
 *    arkstatus.com listings while researching this). A server-side
 *    name_match filter narrows the request to that pattern, and
 *    normalizeServer re-checks it client-side too as a backstop. If a
 *    live run turns up official servers that DON'T match this pattern,
 *    or unofficial ones that accidentally DO, that's the thing to
 *    recalibrate — flagged clearly rather than assumed correct.
 * 3. There's no documented pagination cursor for this endpoint (unlike
 *    BattleMetrics' JSON:API) — just a `limit`. Requesting only
 *    name-matched "Official" servers keeps the result set small (low
 *    thousands, per arkstatus.com's own live counters), well under any
 *    limit ceiling, but discoverFullRoster still warns if a response
 *    comes back exactly at the limit, since that's the signature of
 *    silent truncation.
 */

const https = require('https');

const STEAM_API_BASE = 'https://api.steampowered.com';
const ARK_SA_DEDICATED_SERVER_APPID = 2430930;
const DEFAULT_NAME_FILTER = '*Official*';

// ---------------------------------------------------------------------
// HTTP client (real implementation). Tests inject a fake one instead.
// ---------------------------------------------------------------------
function realHttpGet(url, { timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { Accept: 'application/json' } }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('request timeout')));
  });
}

function realSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------
// Filter string + URL building
// ---------------------------------------------------------------------
// Builds a Master Server Query Protocol filter string, e.g.
// "\appid\2430930\name_match\*Official*"
function buildFilterString({ appid = ARK_SA_DEDICATED_SERVER_APPID, nameMatch = DEFAULT_NAME_FILTER } = {}) {
  let filter = `\\appid\\${appid}`;
  if (nameMatch) filter += `\\name_match\\${nameMatch}`;
  return filter;
}

function buildServerListUrl({ key, filter, limit = 10000 } = {}) {
  const params = new URLSearchParams();
  if (key) params.set('key', key);
  params.set('filter', filter || buildFilterString());
  params.set('limit', String(limit));
  return `${STEAM_API_BASE}/IGameServersService/GetServerList/v1/?${params.toString()}`;
}

// ---------------------------------------------------------------------
// Parsing / normalization
// ---------------------------------------------------------------------
function parseServerListResponse(body) {
  let doc;
  try {
    doc = JSON.parse(body);
  } catch (err) {
    throw new Error(`Failed to parse Steam response as JSON: ${err.message}`);
  }
  const servers = (doc && doc.response && Array.isArray(doc.response.servers)) ? doc.response.servers : [];
  return { servers };
}

function looksOfficial(name) {
  if (typeof name !== 'string') return false;
  return /official/i.test(name) && !/unofficial/i.test(name);
}

function detectGameMode({ name, gametype }) {
  const haystack = `${name || ''} ${gametype || ''}`;
  if (/\bpve\b/i.test(haystack)) return 'pve';
  if (/\bpvp\b/i.test(haystack)) return 'pvp';
  return 'unknown';
}

function normalizeServer(raw) {
  const r = raw || {};
  const [ip, portFromAddr] = typeof r.addr === 'string' ? r.addr.split(':') : [null, null];
  const port = typeof r.gameport === 'number' ? r.gameport : (portFromAddr ? Number(portFromAddr) : null);

  return {
    id: r.addr || (ip && port ? `${ip}:${port}` : null),
    steamid: r.steamid || null,
    name: r.name || null,
    ip: ip || null,
    port: Number.isFinite(port) ? port : null,
    map: r.map || null,
    version: r.version || null,
    playersNow: typeof r.players === 'number' ? r.players : null,
    maxPlayers: typeof r.max_players === 'number' ? r.max_players : null,
    bots: typeof r.bots === 'number' ? r.bots : null,
    region: typeof r.region === 'number' ? r.region : null,
    dedicated: typeof r.dedicated === 'boolean' ? r.dedicated : null,
    secure: typeof r.secure === 'boolean' ? r.secure : null,
    gamedir: r.gamedir || null,
    gametype: r.gametype || null,
    official: looksOfficial(r.name),
    gameMode: detectGameMode({ name: r.name, gametype: r.gametype }),
    rawDetails: r,
    seenAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------
// Retry wrapper (mirrors server_discovery.js's, kept local so this file
// has no dependency on the module it's replacing)
// ---------------------------------------------------------------------
async function fetchWithRetry(httpGet, url, retry, sleep) {
  let lastErr;
  for (let attempt = 1; attempt <= retry.attempts; attempt += 1) {
    const res = await httpGet(url, {});
    if (res.status === 200) return res;
    if (res.status === 429 || res.status >= 500) {
      lastErr = new Error(`HTTP ${res.status} from Steam`);
      await sleep(retry.baseDelayMs * 2 ** (attempt - 1));
      continue;
    }
    throw new Error(`HTTP ${res.status} from Steam: ${res.body.slice(0, 300)}`);
  }
  throw lastErr || new Error('Unknown fetch failure');
}

// ---------------------------------------------------------------------
// Full roster discovery. Named discoverFullRoster to match
// server_discovery.js's exported shape — discovery_service.js doesn't
// need to change beyond its require() line.
// ---------------------------------------------------------------------
async function discoverFullRoster({
  httpGet = realHttpGet,
  sleep = realSleep,
  token, // Steam API key — kept as `token` for drop-in compatibility with discovery_service.js's resolveToken() wiring
  filter,
  limit = 10000,
  onPage,
  retry = { attempts: 3, baseDelayMs: 1000 },
} = {}) {
  const resolvedFilter = filter || buildFilterString();
  const url = buildServerListUrl({ key: token, filter: resolvedFilter, limit });
  const res = await fetchWithRetry(httpGet, url, retry, sleep);
  const { servers: rawServers } = parseServerListResponse(res.body);

  if (rawServers.length === limit) {
    console.warn(
      `[steam-discovery] response came back with exactly the requested limit (${limit}) — this may mean results were truncated. Consider raising --limit.`
    );
  }

  const debug = {
    urlUsed: url.replace(/key=[^&]+/, 'key=REDACTED'),
    filterUsed: resolvedFilter,
    httpStatus: res.status,
    rawServerCount: rawServers.length,
    rawBodyPreview: res.body.slice(0, 500),
  };

  const servers = rawServers.map(normalizeServer);
  if (onPage) onPage({ pageNumber: 1, count: servers.length, raw: rawServers });

  return { servers, pages: 1, debug };
}

// ---------------------------------------------------------------------
// Client-side filtering / diffing (same shape as server_discovery.js,
// keyed on `id` instead of `battlemetricsId`)
// ---------------------------------------------------------------------
function filterOfficial(servers) {
  return servers.filter((s) => s.official === true);
}

function splitByGameMode(servers) {
  return {
    pve: servers.filter((s) => s.gameMode === 'pve'),
    pvp: servers.filter((s) => s.gameMode === 'pvp'),
    unknown: servers.filter((s) => s.gameMode === 'unknown'),
  };
}

function diffRoster(prevServers, nextServers) {
  const prevIds = new Set(prevServers.map((s) => s.id));
  const nextIds = new Set(nextServers.map((s) => s.id));
  const added = nextServers.filter((s) => !prevIds.has(s.id));
  const removed = prevServers.filter((s) => !nextIds.has(s.id));
  return { added, removed, addedCount: added.length, removedCount: removed.length };
}

module.exports = {
  ARK_SA_DEDICATED_SERVER_APPID,
  DEFAULT_NAME_FILTER,
  buildFilterString,
  buildServerListUrl,
  parseServerListResponse,
  looksOfficial,
  detectGameMode,
  normalizeServer,
  discoverFullRoster,
  filterOfficial,
  splitByGameMode,
  diffRoster,
  realHttpGet,
  realSleep,
};
