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
 */

const http = require('http');

function realHttpGetLocal(url, { timeoutMs = 2000 } = {}) {
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

async function fetchJsonSafe(url, { httpGet = realHttpGetLocal, timeoutMs } = {}) {
  try {
    const res = await httpGet(url, timeoutMs != null ? { timeoutMs } : {});
    if (res.status !== 200) return null;
    return JSON.parse(res.body);
  } catch {
    return null;
  }
}

const UNOFFICIAL_ROSTER_CACHE_TTL_MS = 5 * 60 * 1000;

function createTtlCache({ ttlMs = UNOFFICIAL_ROSTER_CACHE_TTL_MS, now = Date.now } = {}) {
  let cached = null;
  return {
    async get(url, fetchFn) {
      const t = now();
      if (cached && cached.url === url && t - cached.at < ttlMs) return cached.value;
      const value = await fetchFn(url);
      if (value != null) cached = { url, at: t, value };
      return value;
    },
    clear() {
      cached = null;
    },
  };
}

module.exports = { realHttpGetLocal, fetchJsonSafe, createTtlCache, UNOFFICIAL_ROSTER_CACHE_TTL_MS };
