#!/usr/bin/env node
'use strict';

/**
 * unofficial_api.js
 *
 * Fetches Wildcard's unofficial ASA server list and immediately maps
 * each raw record to a trimmed shape. The unofficial payload is large
 * (~50MB / ~56k servers as of the Phase A live fetch) so this module
 * never keeps the raw parse and the trimmed list at the same time
 * longer than one pass, and it refuses bodies over a configurable
 * byte cap instead of trying to parse them.
 *
 * Endpoint (live-verified):
 *   https://cdn2.arkdedicated.com/servers/asa/unofficialserverlist.json
 *
 * Field names match officialserverlist.json. Differences seen live:
 *   IsOfficial is "0"; ClusterId is an opaque hash or empty; ModIDs
 *   and ModFileIDs are common. Trimmed shape uses official-compatible
 *   names (gameMode, platformType, wildcardReportedPing) so the
 *   existing browser filter/sort/paginate pipeline can reuse them.
 */

const http = require('http');
const https = require('https');
const { truthyFlag, parseVersion } = require('./ark_official_api.js');

const UNOFFICIAL_SERVER_LIST_URL = 'https://cdn2.arkdedicated.com/servers/asa/unofficialserverlist.json';
const DEFAULT_MAX_BYTES = 96 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120000;

function realSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bodyByteLength(body) {
  if (Buffer.isBuffer(body)) return body.length;
  if (typeof body === 'string') return Buffer.byteLength(body, 'utf8');
  return 0;
}

function assertWithinByteCap(body, maxBytes) {
  const bytes = bodyByteLength(body);
  if (bytes > maxBytes) {
    throw new Error(`Unofficial server list exceeded byte cap (${bytes} > ${maxBytes})`);
  }
  return bytes;
}

function clientFor(url) {
  return String(url).startsWith('http://') ? http : https;
}

function realHttpGetCapped(url, { timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    const req = clientFor(url).get(url, { headers: { Accept: 'application/json' } }, (res) => {
      const chunks = [];
      let bytes = 0;
      let rejected = false;
      res.on('data', (chunk) => {
        if (rejected) return;
        bytes += chunk.length;
        if (bytes > maxBytes) {
          rejected = true;
          req.destroy();
          reject(new Error(`Unofficial server list exceeded byte cap (${bytes} > ${maxBytes})`));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        if (rejected) return;
        const buf = Buffer.concat(chunks, bytes);
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: buf.toString('utf8'),
          byteLength: bytes,
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('request timeout')));
  });
}

function trimUnofficialServer(raw) {
  const r = raw || {};
  const id = r.SessionID || (r.IP && r.Port ? `${r.IP}:${r.Port}` : null);
  const ping = typeof r.ServerPing === 'number' ? r.ServerPing : null;
  return {
    id,
    name: r.Name || null,
    map: r.MapName || null,
    gameMode: r.SessionIsPve === undefined || r.SessionIsPve === null ? 'unknown' : truthyFlag(r.SessionIsPve) ? 'pve' : 'pvp',
    playersNow: typeof r.NumPlayers === 'number' ? r.NumPlayers : null,
    maxPlayers: typeof r.MaxPlayers === 'number' ? r.MaxPlayers : null,
    version: parseVersion(r),
    platformType: r.PlatformType || null,
    ping,
    wildcardReportedPing: ping,
    hasPassword: typeof r.HasPassword === 'boolean' ? r.HasPassword : null,
  };
}

function trimUnofficialList(rawServers) {
  if (!Array.isArray(rawServers)) {
    throw new Error('Expected the unofficial server list response to be a JSON array at the top level');
  }
  const trimmed = new Array(rawServers.length);
  for (let i = 0; i < rawServers.length; i += 1) {
    trimmed[i] = trimUnofficialServer(rawServers[i]);
    rawServers[i] = null;
  }
  rawServers.length = 0;
  return trimmed;
}

async function fetchWithRetry(httpGet, url, retry, sleep, getOpts) {
  let lastErr;
  for (let attempt = 1; attempt <= retry.attempts; attempt += 1) {
    const res = await httpGet(url, getOpts);
    if (res.status === 200) return res;
    if (res.status === 429 || res.status >= 500) {
      lastErr = new Error(`HTTP ${res.status} from unofficial server list`);
      await sleep(retry.baseDelayMs * 2 ** (attempt - 1));
      continue;
    }
    throw new Error(`HTTP ${res.status} from unofficial server list: ${String(res.body || '').slice(0, 300)}`);
  }
  throw lastErr || new Error('Unknown unofficial fetch failure');
}

async function fetchUnofficialRoster({
  httpGet = realHttpGetCapped,
  sleep = realSleep,
  url = UNOFFICIAL_SERVER_LIST_URL,
  maxBytes = DEFAULT_MAX_BYTES,
  retry = { attempts: 3, baseDelayMs: 1000 },
} = {}) {
  const res = await fetchWithRetry(httpGet, url, retry, sleep, { maxBytes });
  assertWithinByteCap(res.body, maxBytes);

  let raw;
  try {
    raw = JSON.parse(res.body);
  } catch (err) {
    throw new Error(`Failed to parse unofficial server list as JSON: ${err.message}`);
  }

  const servers = trimUnofficialList(raw);
  return { servers, count: servers.length };
}

module.exports = {
  UNOFFICIAL_SERVER_LIST_URL,
  DEFAULT_MAX_BYTES,
  trimUnofficialServer,
  trimUnofficialList,
  fetchUnofficialRoster,
  assertWithinByteCap,
  realHttpGetCapped,
  realSleep,
};
