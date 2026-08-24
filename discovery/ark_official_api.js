#!/usr/bin/env node
'use strict';

/**
 * ark_official_api.js
 *
 * Replaces steam_discovery.js. Root cause of that dead end: ARK: Survival
 * Ascended doesn't use Valve's Steam matchmaking/server-browser system at
 * all, even for Steam players — it registers exclusively through Epic
 * Online Services (EOS). Confirmed via research across multiple
 * independent sources, and confirmed live: querying Steam's server list
 * for ARK:SA's App ID (either the dedicated-server one or the client one)
 * always came back completely empty, while the identical code path
 * against Counter-Strike 2 (a Steam-native game) returned real data —
 * proving the pipeline worked and the problem was specifically ARK:SA's
 * absence from Steam's system, not a bug.
 *
 * The actual fix: Wildcard publishes the official server list directly —
 * this is the literal endpoint the game client itself reads to populate
 * its own server browser. No API key, no subscription, no rate limit
 * concerns (it's a static CDN-served JSON file, not a queried API), and
 * it comes pre-scoped to official servers only, with an explicit
 * IsOfficial flag and an explicit SessionIsPve flag — no name-parsing
 * heuristics needed for either, unlike the Steam/BattleMetrics attempts.
 *
 * Endpoint documented at https://ark.wiki.gg/wiki/Web_API and confirmed
 * live during this build (real data fetched, not just documentation).
 *
 * Sibling endpoint for later (Phase 9 stretch — unofficial servers):
 * https://cdn2.arkdedicated.com/servers/asa/unofficialserverlist.json
 */

const https = require('https');

const OFFICIAL_SERVER_LIST_URL = 'https://cdn2.arkdedicated.com/servers/asa/officialserverlist.json';
const UNOFFICIAL_SERVER_LIST_URL = 'https://cdn2.arkdedicated.com/servers/asa/unofficialserverlist.json';

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
// Parsing
// ---------------------------------------------------------------------
function parseServerListBody(body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    throw new Error(`Failed to parse ARK official server list as JSON: ${err.message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error('Expected the ARK official server list response to be a JSON array at the top level');
  }
  return parsed;
}

// ---------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------
// IsOfficial and SessionIsPve come through as inconsistent types across
// real responses (string "1"/"0" for IsOfficial, numeric 1/0 for
// SessionIsPve in samples seen) — normalize defensively rather than
// assuming one type.
function truthyFlag(value) {
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0' || value === undefined || value === null) return false;
  return Boolean(value);
}

// Transfer flags are known 0/1 numbers on both live lists. Sibling flags on
// the same payloads already flip between number / boolean / digit-string, so
// those three forms are accepted. Anything else — including missing — is
// omitted. Never coerce unknown to false.
function parseTransferFlag(value) {
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  return undefined;
}

function applyTransferFlags(target, raw) {
  const allowCharTransfers = parseTransferFlag(raw && raw.AllowDownloadChars);
  const allowItemTransfers = parseTransferFlag(raw && raw.AllowDownloadItems);
  if (allowCharTransfers !== undefined) target.allowCharTransfers = allowCharTransfers;
  if (allowItemTransfers !== undefined) target.allowItemTransfers = allowItemTransfers;
  return target;
}

function parseVersion(raw) {
  const buildId = raw.BuildId;
  const minorBuildId = raw.MinorBuildId;
  if (buildId !== undefined && minorBuildId !== undefined) {
    return `${buildId}.${minorBuildId}`;
  }
  // Fall back to parsing "(vXX.XX)" out of the session name if BuildId fields are absent
  const match = typeof raw.SessionName === 'string' ? raw.SessionName.match(/\(v([\d.]+)\)/) : null;
  return match ? match[1] : null;
}

function normalizeServer(raw) {
  const r = raw || {};
  const day = Number(r.DayTime);

  return applyTransferFlags({
    // Wildcard regenerates SessionID network-wide on update restarts (~every
    // 2-3 days), so it is NOT a stable identity — see PROJECT_STATUS.md.
    // Address is the identity. Servers without one are dropped by the caller's
    // `if (!s.id) continue` guard rather than falling back to SessionID.
    id: r.IP && r.Port ? `${r.IP}:${r.Port}` : null,
    name: r.Name || null,
    sessionName: r.SessionName || null,
    ip: r.IP || null,
    port: typeof r.Port === 'number' ? r.Port : null,
    map: r.MapName || null,
    version: parseVersion(r),
    day: Number.isFinite(day) ? day : null,
    playersNow: typeof r.NumPlayers === 'number' ? r.NumPlayers : null,
    maxPlayers: typeof r.MaxPlayers === 'number' ? r.MaxPlayers : null,
    clusterId: r.ClusterId || null,
    hasPassword: typeof r.HasPassword === 'boolean' ? r.HasPassword : null,
    battleye: truthyFlag(r.Battleye),
    platformType: r.PlatformType || null,
    // Wildcard's own measured ping from wherever their service pings
    // from — not something we measured ourselves, worth keeping that
    // distinction in mind if this is ever shown next to our own A2S ping.
    wildcardReportedPing: typeof r.ServerPing === 'number' ? r.ServerPing : null,
    modIds: typeof r.ModIDs === 'string' && r.ModIDs.length > 0 ? r.ModIDs.split(',') : [],
    lastUpdated: typeof r.LastUpdated === 'number' ? new Date(r.LastUpdated).toISOString() : null,
    official: truthyFlag(r.IsOfficial),
    gameMode: r.SessionIsPve === undefined || r.SessionIsPve === null ? 'unknown' : truthyFlag(r.SessionIsPve) ? 'pve' : 'pvp',
    rawDetails: r,
    seenAt: new Date().toISOString(),
  }, r);
}

// ---------------------------------------------------------------------
// Retry wrapper (same pattern as the rest of the toolkit)
// ---------------------------------------------------------------------
async function fetchWithRetry(httpGet, url, retry, sleep) {
  let lastErr;
  for (let attempt = 1; attempt <= retry.attempts; attempt += 1) {
    const res = await httpGet(url, {});
    if (res.status === 200) return res;
    if (res.status === 429 || res.status >= 500) {
      lastErr = new Error(`HTTP ${res.status} from ARK official server list`);
      await sleep(retry.baseDelayMs * 2 ** (attempt - 1));
      continue;
    }
    throw new Error(`HTTP ${res.status} from ARK official server list: ${res.body.slice(0, 300)}`);
  }
  throw lastErr || new Error('Unknown fetch failure');
}

// ---------------------------------------------------------------------
// Full roster discovery. Named discoverFullRoster to match the shape
// used by the (now superseded) server_discovery.js / steam_discovery.js
// modules — discovery_service.js only needs its require() line changed.
// ---------------------------------------------------------------------
async function discoverFullRoster({
  httpGet = realHttpGet,
  sleep = realSleep,
  url = OFFICIAL_SERVER_LIST_URL,
  onPage,
  retry = { attempts: 3, baseDelayMs: 1000 },
} = {}) {
  const res = await fetchWithRetry(httpGet, url, retry, sleep);
  const rawServers = parseServerListBody(res.body);
  const servers = rawServers.map(normalizeServer);

  const debug = {
    urlUsed: url,
    httpStatus: res.status,
    rawServerCount: rawServers.length,
    rawBodyPreview: res.body.slice(0, 500),
  };

  if (onPage) onPage({ pageNumber: 1, count: servers.length, raw: rawServers });

  return { servers, pages: 1, debug };
}

// ---------------------------------------------------------------------
// Client-side filtering / diffing — kept even though this source is
// already scoped to official servers, as a correctness backstop (the
// endpoint name is a promise, not a contract) and because gameMode
// splitting is still needed regardless of source.
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
  OFFICIAL_SERVER_LIST_URL,
  UNOFFICIAL_SERVER_LIST_URL,
  parseServerListBody,
  truthyFlag,
  parseTransferFlag,
  applyTransferFlags,
  parseVersion,
  normalizeServer,
  discoverFullRoster,
  filterOfficial,
  splitByGameMode,
  diffRoster,
  realHttpGet,
  realSleep,
};
