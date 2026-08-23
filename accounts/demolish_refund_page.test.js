'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveDataUrl } = require('./static_data.js');
const {
  PAGE_TITLE,
  INTRO,
  OFFICIAL_NOTICE,
  ELEMENT_NOTE,
  ROUNDING_NOTE,
  SCOPE_NOTE,
  renderDemolishRefundPage,
} = require('./demolish_refund_page.js');

const html = renderDemolishRefundPage();

test('page title and h1 are the verbatim calculator name', () => {
  assert.equal(PAGE_TITLE, 'Demolish Refund Calculator');
  assert.match(html, /<title>Demolish Refund Calculator \u2014 ArkHelper<\/title>/);
  assert.match(html, /<h1>Demolish Refund Calculator<\/h1>/);
});

test('verbatim intro, scope, official, rounding, and element prose are unaltered', () => {
  assert.match(html, new RegExp(INTRO.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(html, new RegExp(SCOPE_NOTE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(html, new RegExp(OFFICIAL_NOTICE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(html, new RegExp(ROUNDING_NOTE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(html, new RegExp(ELEMENT_NOTE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(
    INTRO,
    'Demolishing a structure returns half of what it cost to build, rounded down. That rounding happens on each structure individually, so the loss compounds: a Thatch Wall costs 7 Fibers and returns 3, and a thousand of them return 3,000 rather than 3,500. Pick your structures below to see exactly what a teardown puts back in your inventory.'
  );
  assert.equal(
    OFFICIAL_NOTICE,
    'These numbers are for official servers. Unofficial and dedicated servers can change how refunds are calculated, so treat this as a baseline rather than a guarantee if you play anywhere else.'
  );
  assert.equal(
    ELEMENT_NOTE,
    'Element and everything in its family — shards, dust, refined forms — never comes back from a demolish. The game marks these resources as non-refundable, so a Tek teardown returns the metal, polymer and crystal but none of the Element you spent. Those rows are shown as zero rather than hidden, because the gap is worth planning around.'
  );
  assert.equal(
    ROUNDING_NOTE,
    'Anything a structure only needs one of will refund nothing at all, since half of one rounds down to zero. A Campfire gives back its Thatch, Stone and Wood, but not its Flint.'
  );
  assert.equal(
    SCOPE_NOTE,
    'This calculator covers demolishing, which is one of two ways to take a structure down. The other is picking it up, and the two are exclusive: pickup hands you the structure back whole and ready to place again, but returns no materials whatsoever. Demolishing is the opposite trade — the structure is gone and you get a share of what it cost. Pickup is only available for a window after placement. On PvP, once that window closes, demolishing is the only way to recover anything, so these numbers are what a teardown actually gets you. PvE keeps pickup available past that point, which is usually the better deal if you intend to rebuild — a structure returned whole beats half its materials.'
  );
});

test('official-servers notice sits above the results, not in the footer', () => {
  const officialAt = html.indexOf(OFFICIAL_NOTICE);
  const resultsAt = html.indexOf('id="demo-results"');
  const footerAt = html.indexOf('<footer');
  assert.ok(officialAt !== -1 && resultsAt !== -1 && footerAt !== -1);
  assert.ok(officialAt < resultsAt);
  assert.ok(resultsAt < footerAt);
});

test('scope note sits near the intro, not in the footer', () => {
  const introAt = html.indexOf(INTRO);
  const scopeAt = html.indexOf(SCOPE_NOTE);
  const footerAt = html.indexOf('<footer');
  assert.ok(introAt !== -1 && scopeAt !== -1);
  assert.ok(scopeAt > introAt);
  assert.ok(scopeAt < footerAt);
  assert.ok(scopeAt - introAt < 2000);
});

test('empty state hides the results table', () => {
  assert.match(html, /id="demo-results" class="demo-results" hidden/);
  assert.match(html, /id="demo-totals"/);
});

test('page fetches the static JSON asset and marks Element rows via a footnote, not a hover-only tooltip', () => {
  const dataUrl = resolveDataUrl('demolish-refunds');
  assert.match(dataUrl, /\/data\/demolish-refunds\.[a-f0-9]{12}\.json/);
  assert.match(html, new RegExp(dataUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(html, /href="#element-note"/);
  assert.match(html, /id="element-note"/);
  assert.doesNotMatch(html, /title="Element/);
});

test('page is linked from the Tools nav', () => {
  assert.match(html, /<summary class="active">Tools<\/summary>/);
  assert.match(html, /href="\/tools\/demolish-refund"/);
});
