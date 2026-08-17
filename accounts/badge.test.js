'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderBadgeSvg, renderUnknownBadgeSvg, buildEmbedSnippets, truncateName, COLORS } = require('./badge.js');

// ---------------------------------------------------------------------
// truncateName
// ---------------------------------------------------------------------
test('truncateName leaves short names alone', () => {
  assert.equal(truncateName('Short Name'), 'Short Name');
});

test('truncateName truncates long names with an ellipsis', () => {
  const long = 'A'.repeat(50);
  const result = truncateName(long, 10);
  assert.equal(result.length, 10);
  assert.ok(result.endsWith('\u2026'));
});

test('truncateName handles a missing name', () => {
  assert.equal(truncateName(null), 'Unknown server');
  assert.equal(truncateName(undefined), 'Unknown server');
});

// ---------------------------------------------------------------------
// renderBadgeSvg
// ---------------------------------------------------------------------
test('renderBadgeSvg produces valid SVG for an online server', () => {
  const svg = renderBadgeSvg({ name: 'NA-PVE-TheIsland5313', status: 'online', playersNow: 5, maxPlayers: 70 });
  assert.match(svg, /^<svg/);
  assert.match(svg, /<\/svg>$/);
  assert.match(svg, /5\/70/);
  assert.match(svg, new RegExp(COLORS.online));
});

test('renderBadgeSvg shows "online" text when player counts are unavailable', () => {
  const svg = renderBadgeSvg({ name: 'A Server', status: 'online' });
  assert.match(svg, />online</);
});

test('renderBadgeSvg shows "offline" in the offline color for a down server', () => {
  const svg = renderBadgeSvg({ name: 'A Server', status: 'offline' });
  assert.match(svg, />offline</);
  assert.match(svg, new RegExp(COLORS.offline));
});

test('renderBadgeSvg falls back to the unknown color for an unrecognized status', () => {
  const svg = renderBadgeSvg({ name: 'A Server', status: 'something-weird' });
  assert.match(svg, new RegExp(COLORS.unknown));
});

test('renderBadgeSvg escapes a hostile server name (XSS check)', () => {
  const svg = renderBadgeSvg({ name: '<script>evil()</script>', status: 'online' });
  assert.doesNotMatch(svg, /<script>evil\(\)<\/script>/);
});

test('badge SVGs contain no client-side script (nav close lives only in the HTML shell)', () => {
  const known = renderBadgeSvg({ name: 'A Server', status: 'online', playersNow: 1, maxPlayers: 10 });
  const unknown = renderUnknownBadgeSvg();
  assert.doesNotMatch(known, /<script/);
  assert.doesNotMatch(unknown, /<script/);
  assert.doesNotMatch(known, /name="mainnav"/);
  assert.doesNotMatch(unknown, /name="mainnav"/);
});

test('renderBadgeSvg widens to fit longer labels rather than clipping oddly', () => {
  const short = renderBadgeSvg({ name: 'A', status: 'online' });
  const long = renderBadgeSvg({ name: 'A Much Longer Server Name Here', status: 'online' });
  const widthOf = (svg) => Number(svg.match(/width="(\d+)"/)[1]);
  assert.ok(widthOf(long) > widthOf(short));
});

// ---------------------------------------------------------------------
// renderUnknownBadgeSvg
// ---------------------------------------------------------------------
test('renderUnknownBadgeSvg renders a gray "unknown" badge, never a crash', () => {
  const svg = renderUnknownBadgeSvg();
  assert.match(svg, new RegExp(COLORS.unknown));
  assert.match(svg, />unknown</);
});

// ---------------------------------------------------------------------
// buildEmbedSnippets
// ---------------------------------------------------------------------
test('buildEmbedSnippets produces working markdown and HTML embed code', () => {
  const snippets = buildEmbedSnippets('https://example.com/badge.svg', 'https://example.com/servers/abc');
  assert.match(snippets.markdown, /!\[ArkHelper status\]\(https:\/\/example\.com\/badge\.svg\)/);
  assert.match(snippets.markdown, /\(https:\/\/example\.com\/servers\/abc\)/);
  assert.match(snippets.html, /<img src="https:\/\/example\.com\/badge\.svg"/);
  assert.match(snippets.html, /href="https:\/\/example\.com\/servers\/abc"/);
});
