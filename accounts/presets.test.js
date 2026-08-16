'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PRESET_COOKIE,
  COOKIE_PRESET_CAP,
  COOKIE_MAX_BYTES,
  NAME_MAX_CHARS,
  KNOWN_PRESET_PARAMS,
  messageForPresetError,
  normalizePresetName,
  sanitizeQueryString,
  serversLocation,
  hasActiveFilters,
  serializePresetCookie,
  parsePresetCookie,
  measurePresetCookieBytes,
  addCookiePreset,
  deleteCookiePreset,
} = require('./presets.js');

// ---------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------
test('normalizePresetName trims and accepts a normal name', () => {
  assert.deepEqual(normalizePresetName('  PvE only  '), { name: 'PvE only' });
});

test('normalizePresetName rejects empty / whitespace-only names', () => {
  assert.equal(normalizePresetName('').error, 'empty_name');
  assert.equal(normalizePresetName('   ').error, 'empty_name');
  assert.equal(normalizePresetName(null).error, 'empty_name');
});

test('normalizePresetName rejects names over 40 characters', () => {
  assert.equal(normalizePresetName('x'.repeat(NAME_MAX_CHARS + 1)).error, 'name_too_long');
  assert.equal(normalizePresetName('x'.repeat(NAME_MAX_CHARS)).name, 'x'.repeat(NAME_MAX_CHARS));
});

test('messageForPresetError maps known codes and ignores unknown ones', () => {
  assert.match(messageForPresetError('cookie_size'), /too large/);
  assert.equal(messageForPresetError('not-a-real-code'), '');
});

// ---------------------------------------------------------------------
// Query-string sanitization
// ---------------------------------------------------------------------
test('sanitizeQueryString keeps known filter/sort params and drops unknown ones', () => {
  const q = sanitizeQueryString('gameMode=pve&sort=rank&evil=1&redirect=https://evil.example/');
  const params = new URLSearchParams(q);
  assert.equal(params.get('gameMode'), 'pve');
  assert.equal(params.get('sort'), 'rank');
  assert.equal(params.get('evil'), null);
  assert.equal(params.get('redirect'), null);
  for (const key of params.keys()) {
    assert.ok(KNOWN_PRESET_PARAMS.includes(key), `unexpected param ${key}`);
  }
});

test('sanitizeQueryString drops empty values', () => {
  assert.equal(sanitizeQueryString('search=&map=&gameMode=pvp'), 'gameMode=pvp');
});

test('sanitizeQueryString extracts the query from a /servers path or URL', () => {
  assert.equal(sanitizeQueryString('/servers?gameMode=pve'), 'gameMode=pve');
  assert.equal(sanitizeQueryString('https://arkhelper.example/servers?map=TheIsland_WP'), 'map=TheIsland_WP');
  assert.equal(sanitizeQueryString('?dir=asc'), 'dir=asc');
});

test('sanitizeQueryString ignores URLs and paths that are not /servers (open-redirect guard)', () => {
  assert.equal(sanitizeQueryString('https://evil.example/phish?gameMode=pve'), '');
  assert.equal(sanitizeQueryString('https://evil.example/servers/other?gameMode=pve'), '');
  assert.equal(sanitizeQueryString('/login?gameMode=pve'), '');
  assert.equal(sanitizeQueryString('javascript:alert(1)'), '');
  // Protocol-relative /servers URLs contribute only their query — the host is discarded.
  assert.equal(sanitizeQueryString('//evil.example/servers?gameMode=pve'), 'gameMode=pve');
});

test('serversLocation always returns /servers or /servers?<sanitized>', () => {
  assert.equal(serversLocation('gameMode=pve&evil=1'), '/servers?gameMode=pve');
  assert.equal(serversLocation('https://evil.example/'), '/servers');
  assert.equal(serversLocation('/elsewhere?x=1'), '/servers');
  assert.equal(serversLocation(''), '/servers');
  assert.ok(serversLocation('search=x&redirect=https://evil.example').startsWith('/servers?'));
  assert.doesNotMatch(serversLocation('redirect=https://evil.example/servers?gameMode=pve'), /^https?:/);
});

test('hasActiveFilters is false for empty / default sort and true for real filters', () => {
  assert.equal(hasActiveFilters(''), false);
  assert.equal(hasActiveFilters('sort=players&dir=desc'), false);
  assert.equal(hasActiveFilters('page=2'), false); // page is not a filter/sort param
  assert.equal(hasActiveFilters('gameMode=pve'), true);
  assert.equal(hasActiveFilters('sort=rank'), true);
  assert.equal(hasActiveFilters('dir=asc'), true);
});

// ---------------------------------------------------------------------
// Cookie parse/serialize
// ---------------------------------------------------------------------
test('serializePresetCookie / parsePresetCookie round-trip', () => {
  const presets = [
    { name: 'PvE', query: 'gameMode=pve' },
    { name: 'Ranked', query: 'sort=rank' },
  ];
  const parsed = parsePresetCookie(serializePresetCookie(presets));
  assert.deepEqual(parsed, presets);
});

test('parsePresetCookie returns [] for missing, malformed, or non-array values', () => {
  assert.deepEqual(parsePresetCookie(undefined), []);
  assert.deepEqual(parsePresetCookie(''), []);
  assert.deepEqual(parsePresetCookie('not-json'), []);
  assert.deepEqual(parsePresetCookie('{"name":"x"}'), []);
});

test('parsePresetCookie drops unknown params, empty names, and extra entries past the cap', () => {
  const raw = JSON.stringify([
    { name: 'Good', query: 'gameMode=pve&hack=1' },
    { name: '', query: 'sort=rank' },
    { name: 'Also', query: '/login?next=https://evil.example' },
    { name: 'A', query: 'map=A' },
    { name: 'B', query: 'map=B' },
    { name: 'C', query: 'map=C' },
    { name: 'D', query: 'map=D' },
  ]);
  const parsed = parsePresetCookie(raw);
  assert.deepEqual(parsed, [
    { name: 'Good', query: 'gameMode=pve' },
    { name: 'A', query: 'map=A' },
    { name: 'B', query: 'map=B' },
  ]);
  assert.equal(parsed.length, COOKIE_PRESET_CAP);
});

// ---------------------------------------------------------------------
// Cookie save / delete / cap / size
// ---------------------------------------------------------------------
test('addCookiePreset save/apply/delete round-trip', () => {
  const saved = addCookiePreset([], { name: 'PvE', query: 'gameMode=pve&unknown=drop-me' });
  assert.equal(saved.ok, true);
  assert.deepEqual(saved.presets, [{ name: 'PvE', query: 'gameMode=pve' }]);
  assert.equal(serversLocation(saved.presets[0].query), '/servers?gameMode=pve');

  const parsed = parsePresetCookie(saved.serialized);
  assert.deepEqual(parsed, saved.presets);

  const deleted = deleteCookiePreset(parsed, 'PvE');
  assert.equal(deleted.changed, true);
  assert.deepEqual(deleted.presets, []);
});

test('addCookiePreset enforces the logged-out cap of 3', () => {
  let presets = [];
  for (let i = 0; i < COOKIE_PRESET_CAP; i += 1) {
    const result = addCookiePreset(presets, { name: `P${i}`, query: `map=M${i}` });
    assert.equal(result.ok, true);
    presets = result.presets;
  }
  const rejected = addCookiePreset(presets, { name: 'one-more', query: 'map=Nope' });
  assert.equal(rejected.error, 'cookie_cap');
  assert.equal(presets.length, COOKIE_PRESET_CAP);
});

test('addCookiePreset rejects a duplicate name', () => {
  const first = addCookiePreset([], { name: 'PvE', query: 'gameMode=pve' });
  const dup = addCookiePreset(first.presets, { name: 'PvE', query: 'gameMode=pvp' });
  assert.equal(dup.error, 'duplicate');
});

test('addCookiePreset rejects saves that would exceed the ~2KB cookie size guard', () => {
  const hugeSearch = 'x'.repeat(4000);
  const result = addCookiePreset([], { name: 'Huge', query: `search=${hugeSearch}` });
  assert.equal(result.error, 'cookie_size');
  assert.ok(measurePresetCookieBytes(serializePresetCookie([{ name: 'Huge', query: `search=${hugeSearch}` }])) > COOKIE_MAX_BYTES);
});

test('a small legitimate preset fits under the cookie size guard', () => {
  const result = addCookiePreset([], { name: 'PvE', query: 'gameMode=pve&sort=rank' });
  assert.equal(result.ok, true);
  assert.ok(measurePresetCookieBytes(result.serialized) < COOKIE_MAX_BYTES);
  assert.ok(result.serialized.includes('gameMode=pve'));
});

test('addCookiePreset rejects empty names and empty queries', () => {
  assert.equal(addCookiePreset([], { name: '  ', query: 'gameMode=pve' }).error, 'empty_name');
  assert.equal(addCookiePreset([], { name: 'PvE', query: 'evil=1' }).error, 'empty_query');
});

test('deleteCookiePreset is a no-op for an unknown name', () => {
  const existing = [{ name: 'PvE', query: 'gameMode=pve' }];
  const result = deleteCookiePreset(existing, 'nope');
  assert.equal(result.changed, false);
  assert.deepEqual(result.presets, existing);
});

test('preset cookie name is ark_presets (used as HttpOnly SameSite=Lax Path=/ by the server)', () => {
  assert.equal(PRESET_COOKIE, 'ark_presets');
});
