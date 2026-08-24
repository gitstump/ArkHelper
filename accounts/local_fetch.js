#!/usr/bin/env node
'use strict';

/**
 * local_fetch.js
 *
 * Small shared helper for fetching JSON from another local service (the
 * discovery service's roster feed, currently) without ever throwing —
 * a slow/down service degrades whatever's asking to "no data", not a
 * crash. Extracted out of home_page.js once the server browser page
 * needed the same behavior for a different endpoint.
 *
 * Timeouts are ceilings, not delays: a healthy response is never
 * slowed by a higher budget. Failures and slow successes log a
 * rate-limited reason line so a silent timeout cannot hide for a day.
 */

const http = require('http');

const LOCAL_FETCH_TIMEOUT_FAST_MS = 3000;
const LOCAL_FETCH_TIMEOUT_HEAVY_MS = 8000;
const LOCAL_FETCH_TIMEOUT_BACKGROUND_MS = 15000;
const LOCAL_FETCH_LOG_INTERVAL_MS = 60 * 1000;

const lastLoggedAt = new Map();

function realHttpGetLocal(url, { timeoutMs = LOCAL_FETCH_TIMEOUT_FAST_MS } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout fetching ${url}`)));
  });
}

function classifyFetchError(err) {
  const msg = err && err.message != null ? String(err.message) : String(err || '');
  const code = err && err.code;
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || /timeout/i.test(msg)) {
    return 'timeout';
  }
  if (code) return `network_${code}`;
  return 'network_error';
}

function emitLog(log, message) {
  if (log && typeof log.warn === 'function') log.warn(message);
  else if (log && typeof log.error === 'function') log.error(message);
  else if (log && typeof log.log === 'function') log.log(message);
}

function logOnce(log, now, key, message) {
  const t = now();
  const prev = lastLoggedAt.get(key);
  if (prev != null && t - prev < LOCAL_FETCH_LOG_INTERVAL_MS) return;
  lastLoggedAt.set(key, t);
  emitLog(log, message);
}

async function fetchJsonWithReason(url, {
  httpGet = realHttpGetLocal,
  timeoutMs,
  log = console,
  now = Date.now,
} = {}) {
  const budget = timeoutMs != null ? timeoutMs : LOCAL_FETCH_TIMEOUT_FAST_MS;
  const started = now();
  try {
    const res = await httpGet(url, { timeoutMs: budget });
    const ms = Math.max(0, now() - started);
    if (!res || res.status !== 200) {
      const status = res && res.status;
      const reason = `http_${status}`;
      logOnce(log, now, `${reason}\0${url}`, `[local-fetch] ${reason} ${url} after ${ms}ms`);
      return { data: null, reason };
    }
    let data;
    try {
      data = JSON.parse(res.body);
    } catch {
      const reason = 'parse_error';
      logOnce(log, now, `${reason}\0${url}`, `[local-fetch] ${reason} ${url} after ${ms}ms`);
      return { data: null, reason };
    }
    if (ms > budget / 2) {
      logOnce(
        log,
        now,
        `slow\0${url}`,
        `[local-fetch] slow ${url} ${ms}ms (budget ${budget}ms)`
      );
    }
    return { data, reason: null };
  } catch (err) {
    const ms = Math.max(0, now() - started);
    const reason = classifyFetchError(err);
    logOnce(log, now, `${reason}\0${url}`, `[local-fetch] ${reason} ${url} after ${ms}ms`);
    return { data: null, reason };
  }
}

async function fetchJsonSafe(url, opts) {
  const { data } = await fetchJsonWithReason(url, opts);
  return data;
}

const UNOFFICIAL_ROSTER_CACHE_TTL_MS = 5 * 60 * 1000;
const OFFICIAL_ROSTER_CACHE_TTL_MS = 5 * 60 * 1000;

function createTtlCache({ ttlMs = UNOFFICIAL_ROSTER_CACHE_TTL_MS, now = Date.now } = {}) {
  let cached = null;
  return {
    async get(url, fetchFn) {
      const t = now();
      if (cached && cached.url === url && t - cached.at < ttlMs) return cached.value;
      const value = await fetchFn(url);
      if (value != null) {
        cached = { url, at: t, value };
        return value;
      }
      if (cached && cached.url === url) return cached.value;
      return value;
    },
    peek() {
      if (!cached) return null;
      const t = now();
      return {
        url: cached.url,
        at: cached.at,
        value: cached.value,
        ageMs: t - cached.at,
        stale: t - cached.at >= ttlMs,
      };
    },
    clear() {
      cached = null;
    },
  };
}

function formatStaleRosterNote(ageMs) {
  const n = Number(ageMs);
  if (!Number.isFinite(n) || n < 0) return '';
  const minutes = Math.max(1, Math.round(n / 60_000));
  return minutes === 1 ? 'Data as of 1 minute ago' : `Data as of ${minutes} minutes ago`;
}

module.exports = {
  realHttpGetLocal,
  fetchJsonSafe,
  fetchJsonWithReason,
  createTtlCache,
  formatStaleRosterNote,
  UNOFFICIAL_ROSTER_CACHE_TTL_MS,
  OFFICIAL_ROSTER_CACHE_TTL_MS,
  LOCAL_FETCH_TIMEOUT_FAST_MS,
  LOCAL_FETCH_TIMEOUT_HEAVY_MS,
  LOCAL_FETCH_TIMEOUT_BACKGROUND_MS,
};
