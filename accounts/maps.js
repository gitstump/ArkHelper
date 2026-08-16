#!/usr/bin/env node
'use strict';

/**
 * maps.js
 *
 * Static registry of official-roster map IDs -> display name, URL slug,
 * and a one-line description. Unknown / future IDs never throw: they
 * fall back to a generated slug and the raw map id as the name.
 */

const MAP_REGISTRY = [
  {
    id: 'TheIsland_WP',
    displayName: 'The Island',
    slug: 'the-island',
    blurb: 'The starter landmass: beaches, forests, mountains, and caves on one island.',
  },
  {
    id: 'TheCenter_WP',
    displayName: 'The Center',
    slug: 'the-center',
    blurb: 'A tropical island cluster with a floating landmass and a deep underground.',
  },
  {
    id: 'ScorchedEarth_WP',
    displayName: 'Scorched Earth',
    slug: 'scorched-earth',
    blurb: 'An arid desert map built around heat, drought, and open dunes.',
  },
  {
    id: 'Aberration_WP',
    displayName: 'Aberration',
    slug: 'aberration',
    blurb: 'A radiation-scarred underground map of caverns, glow, and vertical drops.',
  },
  {
    id: 'Extinction_WP',
    displayName: 'Extinction',
    slug: 'extinction',
    blurb: 'A ruined Earth surface map with city wreckage and orbital-drop zones.',
  },
  {
    id: 'Genesis_WP',
    displayName: 'Genesis',
    slug: 'genesis',
    blurb: 'A simulated multi-biome map cycling ocean, bog, arctic, volcanic, and lunar sectors.',
  },
  {
    id: 'Ragnarok_WP',
    displayName: 'Ragnarok',
    slug: 'ragnarok',
    blurb: 'A large Norse-themed island mixing highlands, desert, snow, and coast.',
  },
  {
    id: 'Valguero_WP',
    displayName: 'Valguero',
    slug: 'valguero',
    blurb: 'A highland map with wide plains and a deep underground trench.',
  },
  {
    id: 'LostColony_WP',
    displayName: 'Lost Colony',
    slug: 'lost-colony',
    blurb: 'A later official map centered on a colony settlement and the wilds around it.',
  },
  {
    id: 'Astraeos_WP',
    displayName: 'Astraeos',
    slug: 'astraeos',
    blurb: 'A Greek-themed island chain with bright coasts and inland highlands.',
  },
  {
    id: 'BobsMissions_WP',
    displayName: 'Club ARK',
    slug: 'club-ark',
    blurb: 'A social hub for minigames and hanging out — not a survival landmass.',
  },
  {
    id: 'SurvivalOfTheFittest_TheIsland_WP',
    displayName: 'Survival of the Fittest',
    slug: 'survival-of-the-fittest',
    blurb: 'A last-tribe-standing arena variant hosted on The Island.',
  },
  {
    id: 'Nyrandil',
    displayName: 'Nyrandil',
    slug: 'nyrandil',
    blurb: 'A community island map currently hosted on the official roster.',
  },
  {
    id: 'Atlantis_WP',
    displayName: 'Atlantis',
    slug: 'atlantis',
    blurb: 'An aquatic-themed community map on the official server list.',
  },
  {
    id: 'PROTOCOL_WP',
    displayName: 'Protocol',
    slug: 'protocol',
    blurb: 'A compact official-list map running on a small Wildcard cluster.',
  },
  {
    id: 'Svartalfheim_WP',
    displayName: 'Svartalfheim',
    slug: 'svartalfheim',
    blurb: 'A dark, Norse-flavored community map on the official roster.',
  },
  {
    id: 'Forglar_WP',
    displayName: 'Forglar',
    slug: 'forglar',
    blurb: 'A swamp-heavy community map hosted on official servers.',
  },
  {
    id: 'TheVolcano_WP',
    displayName: 'The Volcano',
    slug: 'the-volcano',
    blurb: 'A volcanic community island on the official server list.',
  },
  {
    id: 'LostCity_WP',
    displayName: 'Lost City',
    slug: 'lost-city',
    blurb: 'A city-ruins community map on the official roster.',
  },
  {
    id: 'THARAT_WP',
    displayName: 'Tharat',
    slug: 'tharat',
    blurb: 'A community map currently listed on Wildcard official servers.',
  },
  {
    id: 'LVL_Enclave',
    displayName: 'Enclave',
    slug: 'enclave',
    blurb: 'A compact official-list map running under the Enclave name.',
  },
  {
    id: 'Appalachia_Official_WP',
    displayName: 'Appalachia',
    slug: 'appalachia',
    blurb: 'A forested official-list map styled after an Appalachian wilderness.',
  },
  {
    id: 'ALTHEMIA',
    displayName: 'Althemia',
    slug: 'althemia',
    blurb: 'A small official-list map currently hosted by Wildcard.',
  },
  {
    id: 'Reverence_WP',
    displayName: 'Reverence',
    slug: 'reverence',
    blurb: 'A community map present on the official server list.',
  },
  {
    id: 'EdenPremium_WP',
    displayName: 'Eden Premium',
    slug: 'eden-premium',
    blurb: 'A premium-branded official-list map with a small server set.',
  },
  {
    id: 'ASurviveTheNight',
    displayName: 'Survive the Night',
    slug: 'survive-the-night',
    blurb: 'A night-survival community map on the official roster.',
  },
];

const BY_ID = new Map(MAP_REGISTRY.map((m) => [m.id, m]));
const BY_SLUG = new Map(MAP_REGISTRY.map((m) => [m.slug, m]));

function slugifyMapId(id) {
  return String(id || '')
    .replace(/_WP$/i, '')
    .replace(/_/g, '-')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'map';
}

function resolveMap(id) {
  if (id == null || id === '') {
    return { id: '', displayName: '', slug: 'map', known: false, blurb: '' };
  }
  const key = String(id);
  const known = BY_ID.get(key);
  if (known) return { ...known, known: true };
  return { id: key, displayName: key, slug: slugifyMapId(key), known: false, blurb: '' };
}

function resolveSlug(slug, rosterMapIds = []) {
  if (!slug || typeof slug !== 'string') return null;
  const known = BY_SLUG.get(slug);
  if (known) return { ...known, known: true };
  for (const id of rosterMapIds) {
    const resolved = resolveMap(id);
    if (!resolved.known && resolved.slug === slug) return resolved;
  }
  return null;
}

function registryMapIds() {
  return MAP_REGISTRY.map((m) => m.id);
}

module.exports = {
  MAP_REGISTRY,
  slugifyMapId,
  resolveMap,
  resolveSlug,
  registryMapIds,
};
