'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  loadColorsData,
  resolveColorSet,
  renderColorsIndexPage,
  renderColorSetPage,
  renderColorSetNotFoundPage,
} = require('./colors_page.js');

const store = loadColorsData();
const DYE_ID_RE = /Color ID:\s*1\d{2}/;

test('loadColorsData boots the committed colors file once', () => {
  assert.equal(store.data.colors.length, 100);
  assert.equal(store.data.dyes.length, 127);
  assert.equal(store.data.sets.length, 278);
  assert.equal(store.bySlug.size, 278);
  assert.equal(store.creatures.size, 888);
});

test('loadColorsData throws when the file is missing', () => {
  assert.throws(
    () => loadColorsData(path.join(__dirname, 'no-such-colors.json')),
    /colors data missing/
  );
});

test('renderColorsIndexPage includes the palette, Burn dye, and creature lookup', () => {
  const html = renderColorsIndexPage({ store });
  assert.match(html, /<h1>Creature Colors<\/h1>/);
  assert.match(html, /<h2>Base color palette<\/h2>/);
  assert.match(html, /<h2>Dyes<\/h2>/);
  assert.match(html, /<h2>Creature lookup<\/h2>/);
  assert.match(html, /Burn/);
  assert.match(html, /Pachy_Character_BP/);
  assert.match(html, /href="\/colors\/sets\/dinocolorset-raptor"/);
  assert.match(html, /region number \(0–5\) is the stable key/);
  assert.doesNotMatch(html, DYE_ID_RE);
  assert.doesNotMatch(html, /Color ID:/);
});

test('index creature row for Pachy links the Raptor set only', () => {
  const html = renderColorsIndexPage({ store });
  const row = html.match(/<tr data-search="[^"]*pachy_character_bp[^"]*">[\s\S]*?<\/tr>/i);
  assert.ok(row, 'expected a Pachy_Character_BP row');
  assert.match(row[0], /dinocolorset-raptor/);
  assert.doesNotMatch(row[0], /dinocolorset-pachy[^-]/);
});

test('renderColorSetPage for Spino lists regions and used-by creatures', () => {
  const set = resolveColorSet(store, 'dinocolorset-spino');
  assert.ok(set);
  const html = renderColorSetPage({ set });
  assert.match(html, /Region/);
  assert.match(html, /Region 0/);
  assert.match(html, /DinoColorSet_Spino/);
  assert.match(html, /Region numbers 0–5 are the stable key/);
  assert.doesNotMatch(html, /spawn percent/i);
});

test('every color set renders a page that includes Region', () => {
  for (const set of store.data.sets) {
    const html = renderColorSetPage({ set });
    assert.match(html, /Region/, `set ${set.slug} rendered no Region`);
    assert.match(html, new RegExp(set.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('weight-mismatch regions show the inconsistency caveat and no percentages', () => {
  const set = resolveColorSet(store, 'dinocolorset-rockdrake');
  const html = renderColorSetPage({ set });
  assert.match(html, /weight data is inconsistent/);
  assert.doesNotMatch(html, /spawn percent/i);
});

test('unresolved color names render a badge and no swatch', () => {
  let sample = null;
  for (const set of store.data.sets) {
    for (const region of set.regions) {
      const hit = region.colors.find((c) => c.resolved === false);
      if (hit) {
        sample = { set, name: hit.name };
        break;
      }
    }
    if (sample) break;
  }
  assert.ok(sample, 'expected at least one unresolved color name');
  const html = renderColorSetPage({ set: sample.set });
  assert.match(html, /unresolved reference/);
  assert.match(html, new RegExp(sample.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('renderColorSetNotFoundPage names the missing slug', () => {
  const html = renderColorSetNotFoundPage({ slug: 'nope-set' });
  assert.match(html, /Color set not found/);
  assert.match(html, /nope-set/);
  assert.match(html, /href="\/colors"/);
});
