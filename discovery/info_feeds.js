#!/usr/bin/env node
'use strict';

/**
 * info_feeds.js
 *
 * Fetches and parses Wildcard's CDN info feeds: per-network
 * dynamicconfig.ini rate files and the news.ini launcher feed.
 *
 * Endpoints (live-verified 2026-08-16):
 *   https://cdn2.arkdedicated.com/asa/dynamicconfig.ini
 *   https://cdn2.arkdedicated.com/asa/arkpocalypse_dynamicconfig.ini
 *   https://cdn2.arkdedicated.com/asa/smalltribes_dynamicconfig.ini
 *   https://cdn2.arkdedicated.com/asa/conquest_dynamicconfig.ini
 *   https://cdn2.arkdedicated.com/asa/info/news.ini
 *
 * Rates are key=value lines. News is one line:
 *   news=((Key="val",...),(Key="val",...))
 * Observed live: OnClickedAction is "Link::<url>" or "DLC::<name>";
 * NEWS-type entries carry EntryData="title=...|body=..."; most entries
 * are image-only CTAs. Parser tolerates unknown keys, unknown action
 * types, and entries missing any field.
 */

const http = require('http');
const https = require('https');

const RATE_FEED_URLS = {
  official: 'https://cdn2.arkdedicated.com/asa/dynamicconfig.ini',
  arkpocalypse: 'https://cdn2.arkdedicated.com/asa/arkpocalypse_dynamicconfig.ini',
  smalltribes: 'https://cdn2.arkdedicated.com/asa/smalltribes_dynamicconfig.ini',
  conquest: 'https://cdn2.arkdedicated.com/asa/conquest_dynamicconfig.ini',
};

const NEWS_FEED_URL = 'https://cdn2.arkdedicated.com/asa/info/news.ini';
const RATE_VARIANTS = Object.keys(RATE_FEED_URLS);
const DEFAULT_TIMEOUT_MS = 20000;

function realSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clientFor(url) {
  return String(url).startsWith('http://') ? http : https;
}

function realHttpGet(url, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const req = clientFor(url).get(url, { headers: { Accept: 'text/plain' } }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('request timeout')));
  });
}

function parseNumericIfPossible(raw) {
  const text = String(raw).trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) return raw;
  const n = Number(text);
  return Number.isFinite(n) ? n : raw;
}

function parseRatesIni(body) {
  const rates = {};
  if (body == null) return rates;
  const text = String(body).replace(/^\uFEFF/, '');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!key) continue;
    rates[key] = parseNumericIfPossible(value);
  }
  return rates;
}

function parseEntryData(raw) {
  let title = null;
  let body = null;
  if (raw == null || raw === '') return { title, body };
  for (const part of String(raw).split('|')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1);
    if (key === 'title') title = value;
    else if (key === 'body') body = value;
  }
  return { title, body };
}

function parseOnClickedAction(raw) {
  if (raw == null || raw === '') return { action: null, url: null };
  const text = String(raw);
  if (text.startsWith('Link::')) {
    return { action: text, url: text.slice('Link::'.length) || null };
  }
  return { action: text, url: null };
}

function parseQuotedPairs(inner) {
  const out = {};
  const re = /([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"((?:[^"]|"")*)"/g;
  let match;
  while ((match = re.exec(inner))) {
    out[match[1]] = match[2].replace(/""/g, '"');
  }
  return out;
}

function extractEntryInners(text) {
  const inners = [];
  let i = 0;
  while (i < text.length) {
    const next = text[i + 1];
    if (text[i] === '(' && next && /[A-Za-z_]/.test(next)) {
      let depth = 0;
      let inQuote = false;
      const start = i;
      for (; i < text.length; i += 1) {
        const c = text[i];
        if (c === '"') inQuote = !inQuote;
        if (inQuote) continue;
        if (c === '(') depth += 1;
        else if (c === ')') {
          depth -= 1;
          if (depth === 0) {
            inners.push(text.slice(start + 1, i));
            i += 1;
            break;
          }
        }
      }
      continue;
    }
    i += 1;
  }
  return inners;
}

function pairsToNewsEntry(pairs) {
  const { title, body } = parseEntryData(pairs.EntryData);
  const clicked = parseOnClickedAction(pairs.OnClickedAction);
  return {
    type: pairs.EntryWidgetTemplate || null,
    imagePath: pairs.ImagePath || null,
    title,
    body,
    action: clicked.action,
    url: clicked.url,
  };
}

function parseNewsIni(body) {
  if (body == null) return [];
  const text = String(body).replace(/^\uFEFF/, '').trim();
  if (!text) return [];
  const payload = text.startsWith('news=') ? text.slice('news='.length) : text;
  const entries = [];
  for (const inner of extractEntryInners(payload)) {
    const pairs = parseQuotedPairs(inner);
    if (Object.keys(pairs).length === 0) continue;
    entries.push(pairsToNewsEntry(pairs));
  }
  return entries;
}

async function fetchWithRetry(httpGet, url, retry, sleep) {
  let lastErr;
  for (let attempt = 1; attempt <= retry.attempts; attempt += 1) {
    const res = await httpGet(url);
    if (res.status === 200) return res.body;
    if (res.status === 429 || res.status >= 500) {
      lastErr = new Error(`HTTP ${res.status} from ${url}`);
      await sleep(retry.baseDelayMs * 2 ** (attempt - 1));
      continue;
    }
    throw new Error(`HTTP ${res.status} from ${url}: ${String(res.body || '').slice(0, 300)}`);
  }
  throw lastErr || new Error(`Unknown fetch failure for ${url}`);
}

async function fetchOne(httpGet, url, retry, sleep, errors, key) {
  try {
    const body = await fetchWithRetry(httpGet, url, retry, sleep);
    return body;
  } catch (err) {
    errors[key] = err.message;
    return null;
  }
}

async function fetchInfoFeeds({
  httpGet = realHttpGet,
  sleep = realSleep,
  urls = RATE_FEED_URLS,
  newsUrl = NEWS_FEED_URL,
  retry = { attempts: 3, baseDelayMs: 1000 },
} = {}) {
  const errors = {};
  const rates = {};
  for (const [variant, url] of Object.entries(urls)) {
    const body = await fetchOne(httpGet, url, retry, sleep, errors, variant);
    if (body != null) rates[variant] = parseRatesIni(body);
  }
  const newsBody = await fetchOne(httpGet, newsUrl, retry, sleep, errors, 'news');
  const news = newsBody != null ? parseNewsIni(newsBody) : null;
  return { rates, news, errors };
}

module.exports = {
  RATE_FEED_URLS,
  NEWS_FEED_URL,
  RATE_VARIANTS,
  parseRatesIni,
  parseNewsIni,
  parseEntryData,
  parseOnClickedAction,
  fetchInfoFeeds,
  realHttpGet,
  realSleep,
};
