#!/usr/bin/env node
'use strict';

/**
 * guides.js
 *
 * Static registry of original ArkHelper guides. Unknown slugs never
 * throw: resolveGuide returns null. Related slugs may name future
 * guides that are not in the registry yet.
 */

const GUIDE_REGISTRY = [
  {
    slug: 'beginners',
    title: "Beginner's Guide — ARK: Survival Ascended",
    shortTitle: "Beginner's Guide",
    description:
      'First spawn to first tame: server choice, spawn zones, early tools, stat points, and the habits that keep a new survivor alive.',
    lastVerified: '2026-08-16',
    related: ['taming', 'resource-locations', 'settings-performance'],
    sections: [
      {
        heading: 'Pick the right server before you spawn',
        blocks: [
          {
            type: 'p',
            text: 'Your first decision happens before the character screen. On a PvE server, other players cannot hurt you or your buildings, which makes it the sensible default for learning the game. PvP is a different hobby: everything you build can be raided, usually while you sleep. Start PvE; switch later if the quiet bothers you.',
          },
          {
            type: 'p',
            text: 'Population matters too. A nearly full server means crowded coastlines and picked-over resources near spawn zones, while a dead one can feel like single-player. Something in the middle gives you neighbors without competition for every stone on the beach.',
          },
          {
            type: 'links',
            items: [
              { href: '/lists/official-pve', label: 'Official PvE servers', note: 'the recommended starting pool' },
              { href: '/lists/available-now', label: 'Available now', note: 'servers with observed free slots' },
              { href: '/rates', label: 'Current official rates', note: 'taming and XP go faster during bonus-rate events' },
            ],
          },
        ],
      },
      {
        heading: 'Choose an easy spawn, then commit to it',
        blocks: [
          {
            type: 'p',
            text: 'Spawn regions are labeled by difficulty, and the labels are honest. Easy zones are warm coastlines with gentle wildlife and the berries, stone, and wood you need in your first minutes. Harder zones front-load cold, predators, or swamp — none of which a naked survivor answers well.',
          },
          {
            type: 'p',
            text: 'Once you spawn, stay put. New players die most often by wandering: into deep water, into the treeline at night, or toward any animal whose disposition they cannot judge yet. Assume anything your size or larger is hostile until proven otherwise, and treat rivers and shorelines as roads — open sightlines, easy retreat.',
          },
          {
            type: 'callout',
            text: 'If a spawn goes badly, dying and re-rolling in the first ten minutes costs you nothing. It is faster to restart on a good beach than to rescue a bad start.',
          },
        ],
      },
      {
        heading: 'The first hour: tools, fire, and a full stomach',
        blocks: [
          {
            type: 'p',
            text: 'Work the loop: pick up loose stones from the ground, punch or harvest trees for wood and thatch, and pull fiber from bushes with your bare hands. That is enough for a stone pick, then a hatchet, then a spear. The pick and hatchet return different resource mixes from the same trees and rocks, so carry both.',
          },
          {
            type: 'p',
            text: 'Eat berries as you gather — any color except the black and white ones, which are for taming and emergencies, not meals. Before dark, put down a campfire: it cooks the meat your spear earns, holds off the night cold, and marks home in the dark.',
          },
          {
            type: 'list',
            items: [
              'Stone pick \u2192 hatchet \u2192 spear \u2192 campfire, in that order.',
              'Keep your inventory light; weight slows you before it stops you.',
              'Night one is for staying warm by the fire, not exploring.',
            ],
          },
        ],
      },
      {
        heading: 'A bed is your save point — place one immediately',
        blocks: [
          {
            type: 'p',
            text: 'Death sends you back to a random spawn unless you have set a respawn point. A thatch shelter with a sleeping bag inside is the first structure worth building; upgrade to a proper bed as soon as the materials allow, because a bag is single-use and a bed is forever. Everything else about your base can wait. Losing your body — and everything it carried — to a respawn on the wrong side of the map is the most common early rage-quit, and it is entirely preventable.',
          },
        ],
      },
      {
        heading: 'Spend levels on survival, not comfort',
        blocks: [
          {
            type: 'p',
            text: 'Each level grants stat points and engram points, and early levels come quickly. For stats, favor weight so you can actually haul what you gather, health so mistakes are survivable, and enough stamina to run away twice. Oxygen, crafting speed, and fortitude can all wait.',
          },
          {
            type: 'p',
            text: 'Engram points are scarcer than they look — you cannot learn everything, and that is by design. Prioritize the tool tier you are already using, the sleeping bag and bed, storage boxes, the bola, narcotics, and a ranged option such as the slingshot or bow. Skip cosmetic and comfort unlocks until the survival spine is bought.',
          },
        ],
      },
      {
        heading: 'Your first tame changes everything',
        blocks: [
          {
            type: 'p',
            text: 'Taming is the moment ARK opens up, and your first one should be modest. A small herbivore that carries weight or gathers berries turns every future trip inland from a gamble into a routine. The basic knockout method: immobilize or outlast the animal, put it to sleep with blunt hits or slingshot stones, then keep its unconscious body fed with the food it prefers — berries for herbivores — and topped up with narcoberries or narcotics so it does not wake early.',
          },
          {
            type: 'p',
            text: 'The bola is the great equalizer: it roots small and mid-sized creatures in place long enough to work safely. Practice on something harmless before you try anything with teeth.',
          },
          {
            type: 'links',
            items: [
              { href: '/guides/taming', label: 'Taming guide', note: 'methods and preparation in depth (coming soon)' },
            ],
          },
        ],
      },
      {
        heading: 'Habits that keep your progress',
        blocks: [
          {
            type: 'p',
            text: 'ARK punishes optimism. Store what you are not using in boxes at home so a bad death costs a kit, not a fortune. Log off inside walls, behind a door, with your tames parked close. Watch the weather and your temperature bar — heatstroke and hypothermia kill quieter than any predator. And before any long trip, ask the only question that matters here: if I die right now, what do I lose?',
          },
        ],
      },
      {
        heading: 'Where to go next',
        blocks: [
          {
            type: 'links',
            items: [
              { href: '/maps', label: 'Map hubs', note: 'live server telemetry for every official map' },
              { href: '/servers', label: 'Server browser', note: 'filter by map, mode, region, and free slots' },
              { href: '/rates', label: 'Official rates', note: 'check before committing to a long tame' },
            ],
          },
        ],
      },
    ],
  },
];

const BY_SLUG = new Map(GUIDE_REGISTRY.map((g) => [g.slug, g]));

function resolveGuide(slug) {
  if (typeof slug !== 'string' || slug === '') return null;
  return BY_SLUG.get(slug) || null;
}

module.exports = {
  GUIDE_REGISTRY,
  resolveGuide,
};
