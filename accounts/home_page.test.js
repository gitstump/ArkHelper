'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { escapeHtml, renderHomepage, fetchRosterMetaSafe } = require('./home_page.js');

// ---------------------------------------------------------------------
// escapeHtml
// ---------------------------------------------------------------------
test('escapeHtml escapes the standard dangerous characters', () => {
  assert.equal(escapeHtml(`<script>alert('x')</script>`), '&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;');
  assert.equal(escapeHtml('a & b'), 'a &amp; b');
  assert.equal(escapeHtml('"quoted"'), '&quot;quoted&quot;');
});

test('escapeHtml handles non-string input without throwing', () => {
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(42), '');
});

// ---------------------------------------------------------------------
// renderHomepage
// ---------------------------------------------------------------------
test('renderHomepage shows a login link when logged out', () => {
  const html = renderHomepage({ account: null, rosterMeta: null });
  assert.match(html, /Login with Discord/);
  assert.match(html, /href="\/auth\/discord\/login"/);
  assert.doesNotMatch(html, /Log out/);
});

test('renderHomepage shows the username and a logout form when logged in', () => {
  const html = renderHomepage({ account: { username: 'brian', discordId: '42' }, rosterMeta: null });
  assert.match(html, /title="Logged in via Discord"/);
  assert.match(html, />brian</);
  assert.match(html, /action="\/auth\/logout"/);
  assert.match(html, /method="POST"/);
  assert.doesNotMatch(html, /Logged in as/);
  assert.doesNotMatch(html, /Discord ID/);
  assert.doesNotMatch(html, /42/);
});

test('renderHomepage escapes a hostile username instead of injecting it raw (XSS check)', () => {
  const html = renderHomepage({ account: { username: '<script>evil()</script>', discordId: '1' }, rosterMeta: null });
  assert.doesNotMatch(html, /<script>evil\(\)<\/script>/);
  assert.match(html, /&lt;script&gt;evil\(\)&lt;\/script&gt;/);
});

test('renderHomepage shows roster stats when meta is available', () => {
  const html = renderHomepage({
    account: null,
    rosterMeta: { totalOfficial: 3179, pveCount: 1420, pvpCount: 1759, generatedAt: '2026-08-15T16:52:24.124Z' },
  });
  assert.match(html, /3,179/);
  assert.match(html, /1,420/);
  assert.match(html, /1,759/);
  assert.match(html, /2026-08-15T16:52:24\.124Z/);
});

test('renderHomepage adds unofficial count to the tracking line when meta is present', () => {
  const html = renderHomepage({
    account: null,
    rosterMeta: { totalOfficial: 3179, pveCount: 1420, pvpCount: 1759, generatedAt: '2026-08-15T16:52:24.124Z' },
    unofficialMeta: { count: 56198 },
  });
  assert.match(html, /3,179/);
  assert.match(html, /56,198/);
  assert.match(html, /official \(1,420 PvE \/ 1,759 PvP\) and .* unofficial servers/);
});

test('renderHomepage tracking line omits unofficial count when meta is absent', () => {
  const html = renderHomepage({
    account: null,
    rosterMeta: { totalOfficial: 3179, pveCount: 1420, pvpCount: 1759, generatedAt: '2026-08-15T16:52:24.124Z' },
  });
  assert.match(html, /Tracking <strong class="num">3,179<\/strong> official \(1,420 PvE \/ 1,759 PvP\) servers/);
  assert.doesNotMatch(html, /official and /);
});

test('renderHomepage shows a fallback message when roster meta is unavailable', () => {
  const html = renderHomepage({ account: null, rosterMeta: null });
  assert.match(html, /roster data isn't available/);
});

test('renderHomepage produces valid-looking basic HTML structure', () => {
  const html = renderHomepage({ account: null, rosterMeta: null });
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<title>ArkHelper<\/title>/);
  assert.match(html, /<\/html>$/);
});

// ---------------------------------------------------------------------
// fetchRosterMetaSafe
// ---------------------------------------------------------------------
test('fetchRosterMetaSafe returns the parsed JSON on a 200', async () => {
  const fakeGet = async () => ({ status: 200, body: JSON.stringify({ totalOfficial: 3179 }) });
  const result = await fetchRosterMetaSafe('http://x', { httpGet: fakeGet });
  assert.equal(result.totalOfficial, 3179);
});

test('fetchRosterMetaSafe returns null (not a throw) on a non-200 status', async () => {
  const fakeGet = async () => ({ status: 503, body: '' });
  const result = await fetchRosterMetaSafe('http://x', { httpGet: fakeGet });
  assert.equal(result, null);
});

test('fetchRosterMetaSafe returns null (not a throw) when the request itself fails', async () => {
  const fakeGet = async () => {
    throw new Error('ECONNREFUSED');
  };
  const result = await fetchRosterMetaSafe('http://x', { httpGet: fakeGet });
  assert.equal(result, null);
});

test('fetchRosterMetaSafe returns null on malformed JSON rather than throwing', async () => {
  const fakeGet = async () => ({ status: 200, body: 'not json' });
  const result = await fetchRosterMetaSafe('http://x', { httpGet: fakeGet });
  assert.equal(result, null);
});
