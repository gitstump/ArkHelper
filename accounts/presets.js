#!/usr/bin/env node
'use strict';

/**
 * presets.js
 *
 * Named filter/sort snapshots for the server browser. A preset is just
 * a name attached to a query string — filtering itself stays in
 * server_browser.js. Cookie helpers are pure (no HTTP, no DB) so the
 * logged-out path is unit-testable without spinning up a server.
 *
 * Known params are the ones GET /servers actually reads. Anything else
 * is dropped on save and on share-redirect, so a share token can never
 * become an open redirect.
 */

const PRESET_COOKIE = 'ark_presets';
const PRESET_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
const COOKIE_PRESET_CAP = 3;
const ACCOUNT_PRESET_CAP = 15;
const NAME_MAX_CHARS = 40;
const COOKIE_MAX_BYTES = 2048;

const KNOWN_PRESET_PARAMS = [
  'search',
  'map',
  'gameMode',
  'platform',
  'hasPassword',
  'minPlayers',
  'maxPlayers',
  'clusterId',
  'online',
  'hasPing',
  'minFreeSlots',
  'notFull',
  'wipedWithinDays',
  'country',
  'sort',
  'dir',
  'source',
];

const PRESET_ERROR_MESSAGES = {
  empty_name: 'Give this preset a name.',
  name_too_long: 'Preset names can be at most 40 characters.',
  cookie_cap: 'Logged-out presets are limited to 3. Delete one, or log in to save up to 15.',
  account_cap: 'You already have 15 saved presets. Delete one to save another.',
  cookie_size: 'This preset is too large to save in a browser cookie. Try a shorter name, or log in to save more.',
  empty_query: 'Nothing to save \u2014 apply a filter or sort first.',
  duplicate: 'A preset with that name already exists.',
};

function messageForPresetError(code) {
  return PRESET_ERROR_MESSAGES[code] || '';
}

function normalizePresetName(name) {
  const trimmed = String(name == null ? '' : name).trim();
  if (!trimmed) return { error: 'empty_name' };
  if (trimmed.length > NAME_MAX_CHARS) return { error: 'name_too_long' };
  return { name: trimmed };
}

// Pull a raw query string out of a form field / cookie / stored value.
// Full URLs and paths are only accepted when they point at /servers —
// anything else is treated as empty so we never inherit another host's
// path as a redirect target.
function extractRawQuery(input) {
  if (input == null) return '';
  const s = String(input).trim();
  if (!s) return '';

  if (/^[a-zA-Z][a-zA-Z+.-]*:/.test(s) || s.startsWith('//')) {
    try {
      const u = new URL(s.startsWith('//') ? `https:${s}` : s);
      if (u.pathname !== '/servers') return '';
      return u.search.startsWith('?') ? u.search.slice(1) : '';
    } catch {
      return '';
    }
  }

  if (s.startsWith('/servers?')) return s.slice('/servers?'.length);
  if (s === '/servers') return '';
  if (s.startsWith('?')) return s.slice(1);
  if (s.startsWith('/')) return '';
  return s;
}

function sanitizeQueryString(input) {
  const raw = extractRawQuery(input);
  const incoming = new URLSearchParams(raw);
  const out = new URLSearchParams();
  for (const key of KNOWN_PRESET_PARAMS) {
    const value = incoming.get(key);
    if (value) out.set(key, value);
  }
  return out.toString();
}

function serversLocation(queryString) {
  const q = sanitizeQueryString(queryString);
  return q ? `/servers?${q}` : '/servers';
}

function hasActiveFilters(queryString) {
  const params = new URLSearchParams(sanitizeQueryString(queryString));
  for (const [key, value] of params.entries()) {
    if (!value) continue;
    if (key === 'sort' && value === 'players') continue;
    if (key === 'dir' && value === 'desc') continue;
    if (key === 'source' && (value === 'official' || value === 'unofficial')) continue;
    return true;
  }
  return false;
}

function serializePresetCookie(presets) {
  return JSON.stringify(
    (Array.isArray(presets) ? presets : []).map((p) => ({ name: p.name, query: p.query }))
  );
}

function parsePresetCookie(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const normalized = normalizePresetName(item.name);
      if (normalized.error) continue;
      const query = sanitizeQueryString(item.query);
      if (!query) continue;
      if (out.some((p) => p.name === normalized.name)) continue;
      out.push({ name: normalized.name, query });
      if (out.length >= COOKIE_PRESET_CAP) break;
    }
    return out;
  } catch {
    return [];
  }
}

function measurePresetCookieBytes(serialized, { secure = false } = {}) {
  const parts = [
    `${PRESET_COOKIE}=${encodeURIComponent(serialized)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${PRESET_COOKIE_MAX_AGE_SECONDS}`,
  ];
  if (secure) parts.push('Secure');
  return Buffer.byteLength(parts.join('; '), 'utf8');
}

function addCookiePreset(existing, { name, query }, { secure = false } = {}) {
  const normalized = normalizePresetName(name);
  if (normalized.error) return { error: normalized.error };
  const sanitized = sanitizeQueryString(query);
  if (!sanitized) return { error: 'empty_query' };
  const current = Array.isArray(existing) ? existing : [];
  if (current.length >= COOKIE_PRESET_CAP) return { error: 'cookie_cap' };
  if (current.some((p) => p.name === normalized.name)) return { error: 'duplicate' };

  const next = [...current, { name: normalized.name, query: sanitized }];
  const serialized = serializePresetCookie(next);
  if (measurePresetCookieBytes(serialized, { secure }) > COOKIE_MAX_BYTES) {
    return { error: 'cookie_size' };
  }
  return { ok: true, presets: next, serialized };
}

function deleteCookiePreset(existing, name) {
  const current = Array.isArray(existing) ? existing : [];
  const next = current.filter((p) => p.name !== name);
  return { presets: next, changed: next.length !== current.length, serialized: serializePresetCookie(next) };
}

module.exports = {
  PRESET_COOKIE,
  PRESET_COOKIE_MAX_AGE_SECONDS,
  COOKIE_PRESET_CAP,
  ACCOUNT_PRESET_CAP,
  NAME_MAX_CHARS,
  COOKIE_MAX_BYTES,
  KNOWN_PRESET_PARAMS,
  PRESET_ERROR_MESSAGES,
  messageForPresetError,
  normalizePresetName,
  extractRawQuery,
  sanitizeQueryString,
  serversLocation,
  hasActiveFilters,
  serializePresetCookie,
  parsePresetCookie,
  measurePresetCookieBytes,
  addCookiePreset,
  deleteCookiePreset,
};
