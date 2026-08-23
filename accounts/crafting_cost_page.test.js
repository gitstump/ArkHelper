'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { escapeHtml } = require('./theme.js');
const {
  PAGE_TITLE,
  INTRO,
  CHEM_NOTE,
  OVERFLOW_NOTE,
  SCOPE_NOTE,
  renderCraftingCostPage,
} = require('./crafting_cost_page.js');

const html = renderCraftingCostPage();

function literal(value) {
  return new RegExp(escapeHtml(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

test('page title and h1 are the verbatim calculator name', () => {
  assert.equal(PAGE_TITLE, 'Crafting Cost Calculator');
  assert.match(html, /<title>Crafting Cost Calculator \u2014 ArkHelper<\/title>/);
  assert.match(html, /<h1>Crafting Cost Calculator<\/h1>/);
});

test('verbatim intro, scope, overflow, and chemistry prose are unaltered', () => {
  assert.match(html, literal(INTRO));
  assert.match(html, literal(SCOPE_NOTE));
  assert.match(html, literal(OVERFLOW_NOTE));
  assert.match(html, literal(CHEM_NOTE));
  assert.equal(
    INTRO,
    "Work out exactly what a batch costs before you start farming. Pick what you're making, set how many you need, and this lists the materials the way the game does — the direct ingredients, not a full breakdown down to stone and flint. Add as many items as you like and the totals stack up across all of them."
  );
  assert.equal(
    CHEM_NOTE,
    "The Chemistry Bench is the only station in ARK that changes what a craft costs. It takes four times the materials and gives back six, which works out to one and a half times more product for the same resources. Everything else — industrial forges, cookers, the steam forge — only changes how fast the job runs, not what it takes. If you're making Cementing Paste in bulk, the bench is worth building."
  );
  assert.equal(
    OVERFLOW_NOTE,
    "Some recipes make more than one at a time, so you'll sometimes end up with a few spare. Sparkpowder comes two per craft, so asking for five means running three crafts and finishing with six. The extras are shown so the count isn't a surprise."
  );
  assert.equal(
    SCOPE_NOTE,
    "This lists direct ingredients only, matching what the game shows you in a crafting menu. Making bullets tells you that you need gunpowder and an ingot; it doesn't walk you back through what gunpowder is made from."
  );
});

test('empty state hides the results table and keeps the intro', () => {
  assert.match(html, /id="craft-results" class="craft-results" hidden/);
  assert.match(html, /id="craft-totals"/);
  assert.match(html, literal(INTRO));
  assert.doesNotMatch(html, /<tbody id="craft-totals"><tr>/);
});

test('chemistry bench note is present for the comparison', () => {
  assert.match(html, /id="chem-note"/);
  assert.match(html, literal(CHEM_NOTE));
});

test('page fetches the static JSON asset', () => {
  assert.match(html, /\/data\/crafting-costs\.json/);
});

test('page is linked from the Tools nav', () => {
  assert.match(html, /<summary class="active">Tools<\/summary>/);
  assert.match(html, /href="\/tools\/crafting-cost"/);
});
