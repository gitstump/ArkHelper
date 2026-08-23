'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const COLORS_PATH = path.join(__dirname, '..', 'data', 'colors.json');

function loadColors() {
  return JSON.parse(fs.readFileSync(COLORS_PATH, 'utf8'));
}

test('linearToSrgb8 known answers', async () => {
  const { linearToSrgb8 } = await import('./build-colors.mjs');
  assert.equal(linearToSrgb8(0), 0);
  assert.equal(linearToSrgb8(1), 255);
  assert.equal(linearToSrgb8(0.033105), 51);
  assert.equal(linearToSrgb8(0.003), 10);
  assert.equal(linearToSrgb8(0.5), 188);
});

test('data/colors.json pins set, region, color, and dye counts', () => {
  const data = loadColors();
  assert.equal(data.colors.length, 100);
  assert.equal(data.dyes.length, 127);
  assert.equal(data.sets.length, 278);
  let defs = 0;
  for (const set of data.sets) {
    assert.equal(set.regions.length, 6);
    for (let i = 0; i < 6; i++) {
      assert.equal(set.regions[i].index, i);
    }
    defs += set.regions.length;
  }
  assert.equal(defs, 1668);
});

test('unresolved_names length is the verified total', () => {
  const data = loadColors();
  assert.equal(data.unresolved_names.length, 26);
});

test('weight-mismatch region count is the verified total', () => {
  const data = loadColors();
  let mismatches = 0;
  for (const set of data.sets) {
    for (const region of set.regions) {
      if (region.weight_mismatch) mismatches++;
    }
  }
  assert.equal(mismatches, 7);
});

test('slugs are unique and every used_by char is nonempty', () => {
  const data = loadColors();
  const slugs = new Set();
  for (const set of data.sets) {
    assert.ok(set.slug, `set ${set.name} missing slug`);
    assert.equal(slugs.has(set.slug), false, `duplicate slug ${set.slug}`);
    slugs.add(set.slug);
    for (const entry of set.used_by) {
      assert.ok(entry.char, `empty used_by char on ${set.name}`);
    }
  }
  assert.equal(slugs.size, 278);
});

test('Pachy_Character_BP maps to the Raptor set, not a Pachy-named set', () => {
  const data = loadColors();
  const hits = [];
  for (const set of data.sets) {
    for (const entry of set.used_by) {
      if (entry.char === 'Pachy_Character_BP') hits.push(set.name);
    }
  }
  assert.deepEqual(hits, ['DinoColorSet_Raptor']);
  assert.ok(!hits.some((name) => /pachy/i.test(name)));
});
