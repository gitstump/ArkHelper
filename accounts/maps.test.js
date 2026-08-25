'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MAP_REGISTRY, slugifyMapId, resolveMap, resolveSlug, registryMapIds } = require('./maps.js');

// Distinct MapName values observed on the live official roster
// (cdn2.arkdedicated.com/servers/asa/officialserverlist.json, 2026-08-16).
const LIVE_ROSTER_MAP_IDS = [
  'TheIsland_WP',
  'LostColony_WP',
  'Genesis_WP',
  'Ragnarok_WP',
  'Astraeos_WP',
  'TheCenter_WP',
  'Extinction_WP',
  'Aberration_WP',
  'ScorchedEarth_WP',
  'Valguero_WP',
  'BobsMissions_WP',
  'SurvivalOfTheFittest_TheIsland_WP',
  'Nyrandil',
  'Atlantis_WP',
  'PROTOCOL_WP',
  'Svartalfheim_WP',
  'Forglar_WP',
  'TheVolcano_WP',
  'LostCity_WP',
  'THARAT_WP',
  'LVL_Enclave',
  'Appalachia_Official_WP',
  'ALTHEMIA',
  'Reverence_WP',
  'EdenPremium_WP',
  'ASurviveTheNight',
];

test('registry covers every map ID observed on the live official roster', () => {
  const ids = new Set(registryMapIds());
  for (const id of LIVE_ROSTER_MAP_IDS) {
    assert.ok(ids.has(id), `missing registry entry for ${id}`);
  }
});

test('every registry entry has a valid tier and the three tiers count 10 / 2 / 14', () => {
  const counts = { core: 0, mode: 0, community: 0 };
  for (const m of MAP_REGISTRY) {
    assert.ok(counts[m.tier] != null, `${m.id} has invalid tier ${m.tier}`);
    counts[m.tier] += 1;
  }
  assert.equal(counts.core, 10);
  assert.equal(counts.mode, 2);
  assert.equal(counts.community, 14);
});

test('registry slugs and ids are unique, and every entry has a display name', () => {
  const slugs = MAP_REGISTRY.map((m) => m.slug);
  const ids = MAP_REGISTRY.map((m) => m.id);
  assert.equal(new Set(slugs).size, slugs.length);
  assert.equal(new Set(ids).size, ids.length);
  for (const m of MAP_REGISTRY) {
    assert.ok(m.displayName);
    assert.ok(m.slug);
    assert.ok(m.blurb);
    assert.match(m.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  }
});

test('resolveMap returns display name and slug for a known id', () => {
  const island = resolveMap('TheIsland_WP');
  assert.equal(island.displayName, 'The Island');
  assert.equal(island.slug, 'the-island');
  assert.equal(island.known, true);
  assert.equal(resolveMap('BobsMissions_WP').displayName, 'Club ARK');
  assert.equal(resolveMap('BobsMissions_WP').slug, 'club-ark');
});

test('resolveMap falls back to a generated slug and raw name for an unrecognized id', () => {
  const unknown = resolveMap('BrandNewMap_WP');
  assert.equal(unknown.known, false);
  assert.equal(unknown.displayName, 'BrandNewMap_WP');
  assert.equal(unknown.slug, 'brand-new-map');
  assert.equal(unknown.id, 'BrandNewMap_WP');
  assert.equal(unknown.blurb, '');
});

test('slugifyMapId strips _WP and kebab-cases CamelCase and underscores', () => {
  assert.equal(slugifyMapId('TheIsland_WP'), 'the-island');
  assert.equal(slugifyMapId('SurvivalOfTheFittest_TheIsland_WP'), 'survival-of-the-fittest-the-island');
  assert.equal(slugifyMapId('LVL_Enclave'), 'lvl-enclave');
  assert.equal(slugifyMapId('ASurviveTheNight'), 'a-survive-the-night');
});

test('resolveSlug finds registry maps and unknown roster maps, and misses junk', () => {
  assert.equal(resolveSlug('the-island').id, 'TheIsland_WP');
  assert.equal(resolveSlug('genesis').id, 'Genesis_WP');
  assert.equal(resolveSlug('club-ark').id, 'BobsMissions_WP');
  const unknown = resolveSlug('brand-new-map', ['BrandNewMap_WP', 'TheIsland_WP']);
  assert.equal(unknown.id, 'BrandNewMap_WP');
  assert.equal(unknown.known, false);
  assert.equal(resolveSlug('not-a-real-map', ['TheIsland_WP']), null);
  assert.equal(resolveSlug(''), null);
  assert.equal(resolveSlug(null), null);
});

test('resolveSlug prefers the registry when a generated slug would collide', () => {
  const hit = resolveSlug('the-island', ['FutureTheIsland_WP']);
  assert.equal(hit.id, 'TheIsland_WP');
  assert.equal(hit.known, true);
});
