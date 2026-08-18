#!/usr/bin/env node
'use strict';

/**
 * curseforge_api.js
 *
 * Batch-resolves CurseForge project IDs via POST /v1/mods. The API key
 * is passed in by the caller — this module never reads env itself and
 * never interpolates the key into errors or log lines.
 *
 * Contract (docs + Architect live-verify):
 *   POST https://api.curseforge.com/v1/mods
 *   body { "modIds": [ ... ] }
 *   headers Content-Type, Accept, x-api-key
 *   response { "data": [ <Mod> ... ] } — every Mod field optional.
 *
 * Kept fields: id, name, summary, authors[0].name, downloadCount,
 * logo.thumbnailUrl, links.websiteUrl. Missing values become null.
 */

const http = require('http');
const https = require('https');

const CURSEFORGE_MODS_URL = 'https://api.curseforge.com/v1/mods';
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

function clientFor(url) {
  return String(url).startsWith('http://') ? http : https;
}

function redact(message, apiKey) {
  const text = String(message || 'request failed');
  if (!apiKey) return text;
  const key = String(apiKey);
  if (!key) return text;
  return text.split(key).join('[redacted]');
}

function safeFail(message, apiKey) {
  return new Error(redact(message, apiKey));
}

function realHttpPost(url, { body = '', headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    const reqHeaders = { ...headers, 'Content-Length': String(Buffer.byteLength(payload)) };
    const req = clientFor(url).request(
      {
        method: 'POST',
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: `${parsed.pathname}${parsed.search}`,
        headers: reqHeaders,
      },
      (res) => {
        const chunks = [];
        let bytes = 0;
        let rejected = false;
        res.on('data', (chunk) => {
          if (rejected) return;
          bytes += chunk.length;
          if (bytes > maxBytes) {
            rejected = true;
            req.destroy();
            reject(new Error(`CurseForge mods response exceeded byte cap (${bytes} > ${maxBytes})`));
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
      }
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('request timeout')));
    req.write(payload);
    req.end();
  });
}

function normalizeMod(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const idNum = typeof r.id === 'number' ? r.id : Number(r.id);
  const id = Number.isInteger(idNum) && idNum > 0 ? idNum : null;
  const authors = Array.isArray(r.authors) ? r.authors : [];
  const firstAuthor = authors[0] && typeof authors[0] === 'object' ? authors[0] : null;
  const logo = r.logo && typeof r.logo === 'object' ? r.logo : null;
  const links = r.links && typeof r.links === 'object' ? r.links : null;
  const download = r.downloadCount;
  return {
    id,
    name: typeof r.name === 'string' ? r.name : null,
    summary: typeof r.summary === 'string' ? r.summary : null,
    author: firstAuthor && typeof firstAuthor.name === 'string' ? firstAuthor.name : null,
    downloadCount: typeof download === 'number' && Number.isFinite(download) ? download : null,
    logoUrl: logo && typeof logo.thumbnailUrl === 'string' ? logo.thumbnailUrl : null,
    websiteUrl: links && typeof links.websiteUrl === 'string' ? links.websiteUrl : null,
  };
}

async function fetchModsBatch({
  apiKey,
  modIds,
  httpPost = realHttpPost,
  url = CURSEFORGE_MODS_URL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBytes = DEFAULT_MAX_BYTES,
} = {}) {
  const ids = Array.isArray(modIds) ? modIds.filter((id) => Number.isInteger(id) && id > 0) : [];
  if (ids.length === 0) return [];
  if (!apiKey) throw safeFail('CurseForge mods request failed: API key missing', apiKey);

  let res;
  try {
    res = await httpPost(url, {
      body: JSON.stringify({ modIds: ids }),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'x-api-key': apiKey,
      },
      timeoutMs,
      maxBytes,
    });
  } catch (err) {
    throw safeFail(`CurseForge mods request failed: ${err && err.message ? err.message : 'network error'}`, apiKey);
  }

  const bytes = Buffer.byteLength(res && res.body != null ? res.body : '', 'utf8');
  if (bytes > maxBytes) {
    throw safeFail(`CurseForge mods request failed: response exceeded byte cap (${bytes} > ${maxBytes})`, apiKey);
  }

  if (!res || res.status !== 200) {
    throw safeFail(`CurseForge mods request failed: HTTP ${res && res.status}`, apiKey);
  }

  let parsed;
  try {
    parsed = JSON.parse(res.body);
  } catch (err) {
    throw safeFail(`CurseForge mods request failed: invalid JSON (${err.message})`, apiKey);
  }

  const data = parsed && Array.isArray(parsed.data) ? parsed.data : [];
  return data.map(normalizeMod);
}

module.exports = {
  CURSEFORGE_MODS_URL,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_BYTES,
  realHttpPost,
  normalizeMod,
  fetchModsBatch,
};
