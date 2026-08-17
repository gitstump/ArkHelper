#!/usr/bin/env node
'use strict';

/**
 * discovery_service.js
 *
 * Wraps ark_official_api.js into something runnable: a scheduled refresh
 * of the full official ARK:SA roster (PvP + PvE), persisted to disk, and
 * served over a tiny HTTP feed for whatever consumes it next (the
 * accounts service's homepage/browser pages).
 *
 * The discovery source (ark_official_api.js) needs no API key or
 * subscription at all — it's Wildcard's own unauthenticated official
 * server list endpoint. Earlier versions of this file had BattleMetrics
 * and Steam API key handling; that's gone now since neither is needed
 * for this data source. If you're picking this up after using an
 * earlier version, you can stop worrying about STEAM_API_KEY/BM_TOKEN
 * entirely for discovery — they're not used anymore.
 *
 * Optionally enriches each server with a country (via geo_lookup.js /
 * GeoLite2) if a database path is configured — see resolveGeoDbPath.
 * Without it, discovery still works fine; servers just won't have a
 * country field yet.
 *
 * Also (as of Phase 4) records a lightweight snapshot into history.js's
 * SQLite store on every cycle, so uptime % and per-server history become
 * computable — see history.js for what "uptime" actually means given
 * our data source. Exposed to other services via GET /history/:id.
 *
 * CLI:
 *   node discovery_service.js discover-once [--out roster.json] [--debug] [--geo-db path]
 *   node discovery_service.js run [--port 8792] [--interval-minutes 60] [--out roster.json] [--geo-db path] [--history-db path]
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const {
  discoverFullRoster,
  filterOfficial,
  splitByGameMode,
  diffRoster,
} = require('./ark_official_api.js');
const { openCountryDb, enrichServersWithCountry } = require('./geo_lookup.js');
const {
  openHistoryDb,
  recordSnapshotRun,
  computeUptimePercent,
  getServerHistory,
  getChangeLog,
  getRecentWipes,
  computePeakTimes,
  computeDowntimePatterns,
  computeTopUptimeServers,
  computeNetworkRanking,
  applyRankingToServers,
  getRankNeighborhood,
  recordIncidentCycle,
  getIncidentStatus,
} = require('./history.js');
const { RANKING_WINDOW_DAYS } = require('./ranking.js');
const { fetchUnofficialRoster } = require('./unofficial_api.js');
const {
  openUnofficialDb,
  recordUnofficialCycle,
  recordUnofficialFetchFailure,
  getUnofficialMeta,
} = require('./unofficial_store.js');
const { fetchInfoFeeds } = require('./info_feeds.js');
const {
  openInfoDb,
  recordInfoCycle,
  recordInfoFetchFailure,
  getRatesFeed,
  getNewsFeed,
  hasRateData,
  hasNewsData,
} = require('./info_store.js');

const DEFAULT_UNOFFICIAL_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_INFO_INTERVAL_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------
// Persistence (atomic write: write to a temp file, then rename over the
// target, so a reader never sees a half-written roster file)
// ---------------------------------------------------------------------
function persistRosterAtomic(filePath, snapshot, { writeFileSync = fs.writeFileSync, renameSync = fs.renameSync } = {}) {
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmpPath, JSON.stringify(snapshot, null, 2));
  renameSync(tmpPath, filePath);
}

function readRosterIfExists(filePath, { existsSync = fs.existsSync, readFileSync = fs.readFileSync } = {}) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null; // corrupt/partial file — treat as "no previous roster"
  }
}

// ---------------------------------------------------------------------
// Snapshot building
// ---------------------------------------------------------------------
async function buildRosterSnapshot(discoveryOpts = {}, { geoReader } = {}) {
  const startedAt = new Date().toISOString();
  const { servers, debug } = await discoverFullRoster(discoveryOpts);
  let official = filterOfficial(servers);
  if (geoReader) official = enrichServersWithCountry(official, geoReader);
  const byMode = splitByGameMode(official);

  return {
    generatedAt: new Date().toISOString(),
    startedAt,
    totalServersSeen: servers.length,
    totalOfficial: official.length,
    pveCount: byMode.pve.length,
    pvpCount: byMode.pvp.length,
    unknownModeCount: byMode.unknown.length,
    geoEnriched: Boolean(geoReader),
    discoveryDebug: debug,
    servers: official,
  };
}

// ---------------------------------------------------------------------
// One refresh cycle: discover, diff against what's on disk, persist,
// return a small summary (used by both the CLI and the scheduled loop)
// ---------------------------------------------------------------------
async function refreshCycle({
  outPath,
  discoveryOpts = {},
  fsDeps = {},
  geoReader,
  historyDb,
  now = () => new Date().toISOString(),
} = {}) {
  const previous = readRosterIfExists(outPath, fsDeps);
  let snapshot;
  try {
    snapshot = await buildRosterSnapshot(discoveryOpts, { geoReader });
  } catch (err) {
    if (historyDb) {
      try {
        recordIncidentCycle(historyDb, { rosterFetchFailed: true, now });
      } catch {
        // never mask the original fetch failure
      }
    }
    throw err;
  }
  const diff = previous ? diffRoster(previous.servers || [], snapshot.servers) : null;

  if (historyDb) {
    // Record this cycle first so ranking sees the latest snapshot,
    // then stamp scores and 7-day uptime onto the in-memory roster
    // before persisting so /roster already carries rankScore and
    // uptimePercent for the accounts service.
    recordSnapshotRun(historyDb, snapshot.servers, { now });
    applyRankingToServers(snapshot.servers, historyDb);
    recordIncidentCycle(historyDb, {
      rosterFetchFailed: false,
      presentServerIds: snapshot.servers.map((s) => s && s.id).filter(Boolean),
      now,
    });
  }
  persistRosterAtomic(outPath, snapshot, fsDeps);

  return {
    snapshot,
    diff,
    isFirstRun: previous === null,
  };
}

// ---------------------------------------------------------------------
// Scheduled loop (injectable timer functions so this is testable without
// waiting on a real clock)
// ---------------------------------------------------------------------
function startScheduledRefresh({
  outPath,
  intervalMs,
  discoveryOpts = {},
  fsDeps = {},
  geoReader,
  historyDb,
  onCycle = () => {},
  onError = (err) => console.error('[discovery] refresh cycle failed:', err.message),
  setIntervalFn = setInterval,
  runImmediately = true,
}) {
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      const result = await refreshCycle({ outPath, discoveryOpts, fsDeps, geoReader, historyDb });
      onCycle(result);
    } catch (err) {
      onError(err);
    }
  };

  const timer = setIntervalFn(tick, intervalMs);
  if (runImmediately) tick(); // fire once at startup instead of waiting a full interval

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

function createUnofficialState() {
  return { roster: null, lastFetchAt: null, lastFetchStatus: null };
}

async function refreshUnofficialCycle({
  unofficialState,
  unofficialDb,
  fetchUnofficial = fetchUnofficialRoster,
  fetchOpts = {},
  now = () => new Date().toISOString(),
} = {}) {
  if (!unofficialState) throw new Error('refreshUnofficialCycle: unofficialState is required');
  const fetchedAt = now();
  try {
    const result = await fetchUnofficial(fetchOpts);
    const servers = result && Array.isArray(result.servers) ? result.servers : [];
    let cyclesTotal = 0;
    if (unofficialDb) {
      const meta = recordUnofficialCycle(unofficialDb, servers, { now: () => fetchedAt });
      cyclesTotal = meta.cycles_total;
    }
    unofficialState.roster = {
      servers,
      fetchedAt,
      count: servers.length,
      cycles_total: cyclesTotal,
    };
    unofficialState.lastFetchAt = fetchedAt;
    unofficialState.lastFetchStatus = 'ok';
    return unofficialState.roster;
  } catch (err) {
    unofficialState.lastFetchAt = fetchedAt;
    unofficialState.lastFetchStatus = `error: ${err.message}`;
    if (unofficialDb) {
      try {
        recordUnofficialFetchFailure(unofficialDb, { now: () => fetchedAt, error: err.message });
      } catch {
        // never mask the original fetch failure
      }
    }
    throw err;
  }
}

async function refreshInfoCycle({
  infoDb,
  fetchInfo = fetchInfoFeeds,
  fetchOpts = {},
  now = () => new Date().toISOString(),
} = {}) {
  const fetchedAt = now();
  let result;
  try {
    result = await fetchInfo(fetchOpts);
  } catch (err) {
    if (infoDb) {
      try {
        recordInfoFetchFailure(infoDb, { now: () => fetchedAt, error: err.message });
      } catch {
        // never mask the original fetch failure
      }
    }
    throw err;
  }
  const rateCount = result && result.rates ? Object.keys(result.rates).length : 0;
  const newsOk = result && Array.isArray(result.news);
  if (rateCount === 0 && !newsOk) {
    const detail =
      result && result.errors && Object.keys(result.errors).length
        ? Object.values(result.errors).join('; ')
        : 'all info feeds failed';
    if (infoDb) {
      try {
        recordInfoFetchFailure(infoDb, { now: () => fetchedAt, error: detail });
      } catch {
        // never mask the original fetch failure
      }
    }
    throw new Error(detail);
  }
  if (infoDb) {
    recordInfoCycle(infoDb, result, { now: () => fetchedAt });
  }
  return result;
}

function startInfoScheduledRefresh({
  infoDb,
  intervalMs,
  fetchInfo = fetchInfoFeeds,
  fetchOpts = {},
  onCycle = () => {},
  onError = (err) => console.error('[discovery] info-feed refresh failed:', err.message),
  setIntervalFn = setInterval,
  runImmediately = true,
  now = () => new Date().toISOString(),
}) {
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      const result = await refreshInfoCycle({ infoDb, fetchInfo, fetchOpts, now });
      onCycle(result);
    } catch (err) {
      onError(err);
    }
  };

  const timer = setIntervalFn(tick, intervalMs);
  if (runImmediately) tick();

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

function startUnofficialScheduledRefresh({
  unofficialState,
  unofficialDb,
  intervalMs,
  fetchUnofficial = fetchUnofficialRoster,
  fetchOpts = {},
  onCycle = () => {},
  onError = (err) => console.error('[discovery] unofficial refresh failed:', err.message),
  setIntervalFn = setInterval,
  runImmediately = true,
  now = () => new Date().toISOString(),
}) {
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      const result = await refreshUnofficialCycle({
        unofficialState,
        unofficialDb,
        fetchUnofficial,
        fetchOpts,
        now,
      });
      onCycle(result);
    } catch (err) {
      onError(err);
    }
  };

  const timer = setIntervalFn(tick, intervalMs);
  if (runImmediately) tick();

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

// ---------------------------------------------------------------------
// Tiny HTTP feed
// ---------------------------------------------------------------------
function createRosterServer({ outPath, fsDeps = {}, historyDb, unofficialState, unofficialDb, infoDb }) {
  return http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, 'http://internal');

    if (parsedUrl.pathname === '/roster') {
      const roster = readRosterIfExists(outPath, fsDeps);
      if (!roster) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'roster not generated yet' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(roster));
      return;
    }

    if (parsedUrl.pathname === '/roster/meta') {
      const roster = readRosterIfExists(outPath, fsDeps);
      if (!roster) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'roster not generated yet' }));
        return;
      }
      const { servers, ...meta } = roster;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(meta));
      return;
    }

    if (parsedUrl.pathname === '/history/wipes') {
      if (!historyDb) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'history tracking is not enabled on this instance' }));
        return;
      }
      const days = Number(parsedUrl.searchParams.get('days'));
      const windowDays = Number.isFinite(days) && days > 0 ? days : 14;
      const sinceIso = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
      const wipes = getRecentWipes(historyDb, { sinceIso });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sinceIso, wipes }));
      return;
    }

    const historyMatch = parsedUrl.pathname.match(/^\/history\/(.+)$/);
    if (historyMatch) {
      if (!historyDb) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'history tracking is not enabled on this instance' }));
        return;
      }
      const serverId = decodeURIComponent(historyMatch[1]);
      const days = Number(parsedUrl.searchParams.get('days'));
      const sinceIso = Number.isFinite(days) && days > 0 ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString() : undefined;

      const uptime = computeUptimePercent(historyDb, serverId, { sinceIso });
      const history = getServerHistory(historyDb, serverId, { sinceIso });
      const changeLog = getChangeLog(historyDb, serverId);
      const peakTimes = computePeakTimes(historyDb, serverId, { sinceIso });
      const downtimePatterns = computeDowntimePatterns(historyDb, serverId, { sinceIso });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ serverId, uptime, history, changeLog, peakTimes, downtimePatterns }));
      return;
    }

    if (parsedUrl.pathname === '/leaderboards/uptime') {
      if (!historyDb) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'history tracking is not enabled on this instance' }));
        return;
      }
      const days = Number(parsedUrl.searchParams.get('days'));
      const sinceIso = Number.isFinite(days) && days > 0 ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString() : undefined;
      const limit = Number(parsedUrl.searchParams.get('limit')) || 20;
      const minRuns = Number(parsedUrl.searchParams.get('minRuns')) || 5;

      const leaderboard = computeTopUptimeServers(historyDb, { sinceIso, limit, minRuns });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(leaderboard));
      return;
    }

    if (parsedUrl.pathname === '/rankings') {
      if (!historyDb) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'history tracking is not enabled on this instance' }));
        return;
      }
      const days = Number(parsedUrl.searchParams.get('days'));
      const windowDays = Number.isFinite(days) && days > 0 ? days : RANKING_WINDOW_DAYS;
      const sinceIso = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
      const limit = Number(parsedUrl.searchParams.get('limit')) || 100;
      const minRunsRaw = parsedUrl.searchParams.get('minRuns');
      const minRuns = minRunsRaw != null && minRunsRaw !== '' ? Number(minRunsRaw) || 0 : 0;

      const ranking = computeNetworkRanking(historyDb, { sinceIso, limit, minRuns });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(ranking));
      return;
    }

    const rankMatch = parsedUrl.pathname.match(/^\/rankings\/(.+)$/);
    if (rankMatch) {
      if (!historyDb) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'history tracking is not enabled on this instance' }));
        return;
      }
      const serverId = decodeURIComponent(rankMatch[1]);
      const days = Number(parsedUrl.searchParams.get('days'));
      const windowDays = Number.isFinite(days) && days > 0 ? days : RANKING_WINDOW_DAYS;
      const sinceIso = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
      const minRunsRaw = parsedUrl.searchParams.get('minRuns');
      const minRuns = minRunsRaw != null && minRunsRaw !== '' ? Number(minRunsRaw) || 0 : 0;
      const radius = Number(parsedUrl.searchParams.get('radius')) || 5;

      // No limit here — need the FULL ranking to find one server's position in it
      const fullRanking = computeNetworkRanking(historyDb, { sinceIso, minRuns });
      const neighborhood = getRankNeighborhood(fullRanking.servers, serverId, { radius });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ serverId, totalRuns: fullRanking.totalRuns, eligibleServerCount: fullRanking.eligibleServerCount, ranking: neighborhood }));
      return;
    }

    if (parsedUrl.pathname === '/unofficial/roster') {
      const roster = unofficialState && unofficialState.roster;
      if (!roster) {
        const body = JSON.stringify({ error: 'unofficial roster not generated yet' });
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(body);
        return;
      }
      const body = JSON.stringify(roster);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
      return;
    }

    if (parsedUrl.pathname === '/unofficial/meta') {
      const dbMeta = unofficialDb ? getUnofficialMeta(unofficialDb) : null;
      const roster = unofficialState && unofficialState.roster;
      const playersOnline = roster && Array.isArray(roster.servers)
        ? roster.servers.reduce((sum, s) => sum + (s && s.playersNow ? s.playersNow : 0), 0)
        : null;
      const body = JSON.stringify({
        count: roster ? roster.count : 0,
        playersOnline,
        cycles_total: roster && typeof roster.cycles_total === 'number'
          ? roster.cycles_total
          : dbMeta
            ? dbMeta.cycles_total
            : 0,
        lastFetchAt: (unofficialState && unofficialState.lastFetchAt) || (dbMeta && dbMeta.last_fetch_at) || null,
        lastFetchStatus: (unofficialState && unofficialState.lastFetchStatus) || (dbMeta && dbMeta.last_fetch_status) || null,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
      return;
    }

    if (parsedUrl.pathname === '/rates') {
      if (!infoDb || !hasRateData(infoDb)) {
        const body = JSON.stringify({ error: 'rates feed not generated yet' });
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(body);
        return;
      }
      const body = JSON.stringify(getRatesFeed(infoDb));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
      return;
    }

    if (parsedUrl.pathname === '/news') {
      if (!infoDb || !hasNewsData(infoDb)) {
        const body = JSON.stringify({ error: 'news feed not generated yet' });
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(body);
        return;
      }
      const body = JSON.stringify(getNewsFeed(infoDb));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
      return;
    }

    if (parsedUrl.pathname === '/incidents/status') {
      if (!historyDb) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'history tracking is not enabled on this instance' }));
        return;
      }
      const status = getIncidentStatus(historyDb);
      if (!status) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'incident status not computed yet' }));
        return;
      }
      const body = JSON.stringify(status);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' });
      res.end(body);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found', routes: ['/roster', '/roster/meta', '/unofficial/roster', '/unofficial/meta', '/history/wipes', '/history/:id', '/leaderboards/uptime', '/rankings', '/rankings/:id', '/incidents/status', '/rates', '/news'] }));
  });
}

// ---------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i += 1;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

// Resolves a GeoLite2-Country.mmdb path from --geo-db or the
// GEOLITE2_DB_PATH env var. Absence isn't an error — country enrichment
// is optional, not a hard requirement to run discovery.
function resolveGeoDbPath(args, env = process.env) {
  if (args['geo-db'] && typeof args['geo-db'] === 'string') return args['geo-db'];
  if (env.GEOLITE2_DB_PATH) return env.GEOLITE2_DB_PATH;
  return undefined;
}

// Resolves the history database path. Unlike GeoLite2, history recording
// defaults ON (to a local file) rather than being opt-in — every cycle
// that goes unrecorded is uptime data lost permanently, so the default
// should be "record it," not "skip it unless configured." Pass
// --no-history to explicitly turn it off.
function resolveHistoryDbPath(args, env = process.env) {
  if (args['no-history']) return null;
  if (args['history-db'] && typeof args['history-db'] === 'string') return args['history-db'];
  if (env.HISTORY_DB_PATH) return env.HISTORY_DB_PATH;
  return 'ark_history.db';
}

function resolveUnofficialDbPath(args, env = process.env) {
  if (args['unofficial-db'] && typeof args['unofficial-db'] === 'string') return args['unofficial-db'];
  if (env.UNOFFICIAL_DB_PATH) return env.UNOFFICIAL_DB_PATH;
  return 'unofficial.sqlite';
}

function resolveInfoDbPath(args, env = process.env) {
  if (args['info-db'] && typeof args['info-db'] === 'string') return args['info-db'];
  if (env.INFO_DB_PATH) return env.INFO_DB_PATH;
  return 'feeds.sqlite';
}

function resolveInfoIntervalMs(args, env = process.env) {
  if (env.INFO_INTERVAL_MS) {
    const fromEnv = Number(env.INFO_INTERVAL_MS);
    if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  }
  if (args['info-interval'] && args['info-interval'] !== true) {
    const minutes = Number(args['info-interval']);
    if (Number.isFinite(minutes) && minutes > 0) return minutes * 60 * 1000;
  }
  return DEFAULT_INFO_INTERVAL_MS;
}

function resolveUnofficialIntervalMs(args, env = process.env) {
  if (env.UNOFFICIAL_INTERVAL_MS) {
    const fromEnv = Number(env.UNOFFICIAL_INTERVAL_MS);
    if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  }
  if (args['unofficial-interval'] && args['unofficial-interval'] !== true) {
    const minutes = Number(args['unofficial-interval']);
    if (Number.isFinite(minutes) && minutes > 0) return minutes * 60 * 1000;
  }
  return DEFAULT_UNOFFICIAL_INTERVAL_MS;
}

async function openGeoReaderIfConfigured(args) {
  const geoDbPath = resolveGeoDbPath(args);
  if (!geoDbPath) {
    console.log(
      '[discovery] no GeoLite2 database configured (--geo-db or GEOLITE2_DB_PATH) — servers will be discovered without a country field. See geo_lookup.js for setup.'
    );
    return undefined;
  }
  try {
    const reader = await openCountryDb(geoDbPath);
    console.log(`[discovery] GeoLite2 database loaded from ${geoDbPath} — enriching servers with country`);
    return reader;
  } catch (err) {
    console.log(`[discovery] could not open GeoLite2 database at ${geoDbPath} (${err.message}) — continuing without country data`);
    return undefined;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const command = args._[0];
  const outPath = path.resolve(args.out || 'roster.json');
  const geoReader = await openGeoReaderIfConfigured(args);

  if (command === 'discover-once') {
    console.log(`[discovery] starting a single full discovery pass -> ${outPath}`);
    const result = await refreshCycle({ outPath, discoveryOpts: {}, geoReader });
    const s = result.snapshot;
    console.log(
      `[discovery] done. total seen: ${s.totalServersSeen}, official: ${s.totalOfficial} (PvE ${s.pveCount} / PvP ${s.pvpCount} / unknown-mode ${s.unknownModeCount})`
    );
    if (result.diff) {
      console.log(`[discovery] change vs last run: +${result.diff.addedCount} / -${result.diff.removedCount}`);
    }
    if (args.debug) {
      console.log('[discovery] --debug: request details');
      console.log(`  URL used: ${s.discoveryDebug.urlUsed}`);
      console.log(`  HTTP status: ${s.discoveryDebug.httpStatus}`);
      console.log(`  raw servers in response: ${s.discoveryDebug.rawServerCount}`);
      console.log(`  raw body preview: ${s.discoveryDebug.rawBodyPreview}`);
      if (s.servers.length > 0) {
        console.log('  first official server, normalized:');
        const { rawDetails, ...normalized } = s.servers[0];
        console.log(' ', JSON.stringify(normalized, null, 2));
        if (s.geoEnriched) {
          console.log(`  first server country -> ${s.servers[0].country || 'null'} (${s.servers[0].countryName || 'unknown'})`);
        }
      }
    }
    return;
  }

  if (command === 'run') {
    const port = Number(args.port || 8792);
    const intervalMinutes = Number(args['interval-minutes'] || 60);
    const historyDbPath = resolveHistoryDbPath(args);
    const historyDb = historyDbPath ? openHistoryDb(historyDbPath) : undefined;
    if (historyDb) {
      console.log(`[discovery] history tracking on -> ${historyDbPath} (uptime %/history become available as runs accumulate)`);
    } else {
      console.log('[discovery] history tracking disabled (--no-history) — uptime/history endpoints will report unavailable');
    }
    const unofficialDbPath = resolveUnofficialDbPath(args);
    const unofficialDb = unofficialDbPath ? openUnofficialDb(unofficialDbPath) : undefined;
    const unofficialState = createUnofficialState();
    const unofficialIntervalMs = resolveUnofficialIntervalMs(args);
    if (unofficialDb) {
      console.log(`[discovery] unofficial tracking on -> ${unofficialDbPath} (interval ${unofficialIntervalMs}ms)`);
    }

    console.log(
      `[discovery] starting scheduled service — refresh every ${intervalMinutes}m, roster file ${outPath}, HTTP on :${port}`
    );

    const scheduler = startScheduledRefresh({
      outPath,
      intervalMs: intervalMinutes * 60 * 1000,
      historyDb,
      discoveryOpts: {},
      geoReader,
      onCycle: (result) => {
        const s = result.snapshot;
        console.log(
          `[discovery] refreshed: official ${s.totalOfficial} (PvE ${s.pveCount} / PvP ${s.pvpCount})` +
            (result.diff ? ` | +${result.diff.addedCount} / -${result.diff.removedCount}` : ' | first run')
        );
      },
    });

    const unofficialScheduler = startUnofficialScheduledRefresh({
      unofficialState,
      unofficialDb,
      intervalMs: unofficialIntervalMs,
      onCycle: (result) => {
        console.log(`[discovery] unofficial refreshed: ${result.count} servers (cycle ${result.cycles_total})`);
      },
    });

    const infoDbPath = resolveInfoDbPath(args);
    const infoDb = infoDbPath ? openInfoDb(infoDbPath) : undefined;
    const infoIntervalMs = resolveInfoIntervalMs(args);
    if (infoDb) {
      console.log(`[discovery] info feeds on -> ${infoDbPath} (interval ${infoIntervalMs}ms)`);
    }

    const infoScheduler = startInfoScheduledRefresh({
      infoDb,
      intervalMs: infoIntervalMs,
      onCycle: (result) => {
        const variants = result && result.rates ? Object.keys(result.rates).join(',') : 'none';
        const newsCount = result && Array.isArray(result.news) ? result.news.length : 'failed';
        console.log(`[discovery] info feeds refreshed: rates [${variants}] news ${newsCount}`);
      },
    });

    const server = createRosterServer({ outPath, historyDb, unofficialState, unofficialDb, infoDb });
    server.listen(port);

    const shutdown = () => {
      console.log('[discovery] shutting down');
      scheduler.stop();
      unofficialScheduler.stop();
      infoScheduler.stop();
      server.close();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    return;
  }

  console.log('Usage:');
  console.log('  node discovery_service.js discover-once [--out roster.json] [--debug] [--geo-db path]');
  console.log('  node discovery_service.js run [--port 8792] [--interval-minutes 60] [--out roster.json] [--geo-db path] [--history-db path] [--no-history] [--unofficial-interval minutes] [--unofficial-db path] [--info-interval minutes] [--info-db path]');
  process.exitCode = 1;
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[discovery] fatal:', err.message);
    process.exitCode = 1;
  });
}

module.exports = {
  persistRosterAtomic,
  readRosterIfExists,
  buildRosterSnapshot,
  refreshCycle,
  startScheduledRefresh,
  createUnofficialState,
  refreshUnofficialCycle,
  startUnofficialScheduledRefresh,
  refreshInfoCycle,
  startInfoScheduledRefresh,
  createRosterServer,
  parseArgs,
  resolveGeoDbPath,
  resolveHistoryDbPath,
  resolveUnofficialDbPath,
  resolveUnofficialIntervalMs,
  resolveInfoDbPath,
  resolveInfoIntervalMs,
  DEFAULT_UNOFFICIAL_INTERVAL_MS,
  DEFAULT_INFO_INTERVAL_MS,
};
