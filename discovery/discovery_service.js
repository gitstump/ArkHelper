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
  computePeakTimes,
  computeDowntimePatterns,
  computeTopUptimeServers,
  computeNetworkRanking,
  getRankNeighborhood,
} = require('./history.js');

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
} = {}) {
  const previous = readRosterIfExists(outPath, fsDeps);
  const snapshot = await buildRosterSnapshot(discoveryOpts, { geoReader });
  const diff = previous ? diffRoster(previous.servers || [], snapshot.servers) : null;

  persistRosterAtomic(outPath, snapshot, fsDeps);
  if (historyDb) recordSnapshotRun(historyDb, snapshot.servers);

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

// ---------------------------------------------------------------------
// Tiny HTTP feed
// ---------------------------------------------------------------------
function createRosterServer({ outPath, fsDeps = {}, historyDb }) {
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
      const sinceIso = Number.isFinite(days) && days > 0 ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString() : undefined;
      const limit = Number(parsedUrl.searchParams.get('limit')) || 100;
      const minRuns = Number(parsedUrl.searchParams.get('minRuns')) || 5;

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
      const sinceIso = Number.isFinite(days) && days > 0 ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString() : undefined;
      const minRuns = Number(parsedUrl.searchParams.get('minRuns')) || 5;
      const radius = Number(parsedUrl.searchParams.get('radius')) || 5;

      // No limit here — need the FULL ranking to find one server's position in it
      const fullRanking = computeNetworkRanking(historyDb, { sinceIso, minRuns });
      const neighborhood = getRankNeighborhood(fullRanking.servers, serverId, { radius });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ serverId, totalRuns: fullRanking.totalRuns, eligibleServerCount: fullRanking.eligibleServerCount, ranking: neighborhood }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found', routes: ['/roster', '/roster/meta', '/history/:id', '/leaderboards/uptime', '/rankings', '/rankings/:id'] }));
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

    const server = createRosterServer({ outPath, historyDb });
    server.listen(port);

    const shutdown = () => {
      console.log('[discovery] shutting down');
      scheduler.stop();
      server.close();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    return;
  }

  console.log('Usage:');
  console.log('  node discovery_service.js discover-once [--out roster.json] [--debug] [--geo-db path]');
  console.log('  node discovery_service.js run [--port 8792] [--interval-minutes 60] [--out roster.json] [--geo-db path] [--history-db path] [--no-history]');
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
  createRosterServer,
  parseArgs,
  resolveGeoDbPath,
  resolveHistoryDbPath,
};
