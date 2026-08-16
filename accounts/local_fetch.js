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

async function fetchJsonSafe(url, { httpGet = realHttpGetLocal } = {}) {
  try {
    const res = await httpGet(url, {});
    if (res.status !== 200) return null;
    return JSON.parse(res.body);
  } catch {
    return null;
  }
}

module.exports = { realHttpGetLocal, fetchJsonSafe };
