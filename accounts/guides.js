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
              { href: '/guides/taming', label: 'Taming guide', note: 'methods and preparation in depth' },
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
  {
    slug: 'taming',
    title: 'Taming Guide — ARK: Survival Ascended',
    shortTitle: 'Taming Guide',
    description:
      'Knockout and passive taming from first bola to first mount: preparation, torpor, feeding, traps, and keeping your target alive.',
    lastVerified: '2026-08-16',
    related: ['beginners', 'breeding-mutations', 'resource-locations'],
    sections: [
      {
        heading: 'Check the rates, then pack for the whole job',
        blocks: [
          {
            type: 'p',
            text: "Every tame is a timer, and the server's taming multiplier sets how long that timer runs. During bonus-rate events the same animal can take a fraction of the usual time, so a five-minute check before you leave home can save you an afternoon. Then pack as if the tame will take twice as long as you hope: food for the animal, food for you, more sedatives than the plan requires, and something to fight with that you are not using to tame.",
          },
          {
            type: 'links',
            items: [
              { href: '/rates', label: 'Current official rates', note: 'see the live taming multiplier before you commit' },
            ],
          },
          {
            type: 'callout',
            text: 'The most common taming failure is not the animal waking up — it is the tamer arriving unprepared and improvising.',
          },
        ],
      },
      {
        heading: 'Two families: knockout and passive',
        blocks: [
          {
            type: 'p',
            text: 'Almost every tame falls into one of two methods. Knockout taming means rendering the creature unconscious and feeding it while it sleeps; it covers most of the animals you will want early. Passive taming means walking up to a conscious animal and feeding it by hand, usually on a repeating timer, and it is reserved for creatures that either flee or cannot reasonably be knocked out. The in-game dossier language and community shorthand both tell you which family a creature belongs to — when in doubt, assume knockout.',
          },
        ],
      },
      {
        heading: 'The knockout: control first, torpor second',
        blocks: [
          {
            type: 'p',
            text: 'Sedating an animal that is running away or eating you is miserable, so the real skill is control. Bolas root small and mid-sized creatures where they stand. Larger targets call for a trap, natural terrain they cannot climb out of, or a mount fast enough to kite safely. Only once the target cannot reach you does the sedation start.',
          },
          {
            type: 'p',
            text: 'Torpor tools scale with your progression: fists and clubs at the very start, a slingshot soon after, then tranquilizer arrows and eventually darts. Aimed hits to the head are generally more effective than body shots. Pace your shots — torpor from tranq ammunition builds over a moment rather than all at once, and an extra hit after the animal is already falling is wasted damage on something you are trying to keep alive.',
          },
          {
            type: 'list',
            items: [
              'Control the target before you sedate it, not after.',
              'Match the tool to the target; a slingshot will not down a rex.',
              'Damage and torpor are in tension: enough hits to sleep, few enough to survive.',
            ],
          },
        ],
      },
      {
        heading: 'Keeping it down and getting it fed',
        blocks: [
          {
            type: 'p',
            text: "An unconscious animal's torpor drains steadily, and if it hits zero the creature wakes up angry with your investment inside it. Watch the torpor bar and top it up with narcoberries or crafted narcotics before it runs low — narcotics are stronger and stack further, which is why they were on the engram list in the beginner guide.",
          },
          {
            type: 'p',
            text: "Feeding is simple: place the right food in the creature's inventory and it eats on its own schedule as it tames. Herbivores take berries, carnivores take meat, and nearly everything tames faster and better on food it specifically prefers. Prime meat and kibble sit at the top of that ladder — harder to source and quick to spoil, but the difference on a long tame is dramatic.",
          },
        ],
      },
      {
        heading: 'Taming effectiveness is the hidden score',
        blocks: [
          {
            type: 'p',
            text: 'Behind the progress bar sits an effectiveness percentage, and it only goes down. Every hit the animal takes while unconscious and every bite of second-rate food chips away at it. Effectiveness decides the bonus levels the creature receives when the tame completes, which is the difference between a workhorse and a trophy. This is the practical case for traps, preferred food, and patience: a fast sloppy tame and a careful one produce two very different animals from the same target.',
          },
        ],
      },
      {
        heading: 'Passive taming: patience under pressure',
        blocks: [
          {
            type: 'p',
            text: 'Passive tames trade violence for vigilance. You approach — sometimes crouched, sometimes from a required angle — feed from the hotbar, then wait out a timer and do it again until the bar fills. The rules that matter: striking the animal, or letting anything else strike it, typically resets or ruins the attempt, and many passive targets spook and scatter if you rush the approach. Clear the area of predators before you start, bring more of the food than the tame should need, and settle in. Boredom is the method working.',
          },
        ],
      },
      {
        heading: 'Traps pay for themselves',
        blocks: [
          {
            type: 'p',
            text: 'A taming trap is any arrangement of structures the target can enter but not leave — commonly a small pen of reinforced walls or stone gateways with a gate you close behind the creature, or an open-topped box you lure it into while it chases you. The trap solves every hard part at once: the animal cannot flee, cannot reach you, and cannot be reached by whatever else wanders past. The materials cost an hour; the trap tames a dozen animals. Build it near where your target spawns, not near home — you are bringing the tame back, not the trap.',
          },
        ],
      },
      {
        heading: 'After the tame',
        blocks: [
          {
            type: 'p',
            text: 'A fresh tame is at its most fragile in the first minutes: it wakes hungry, possibly far from safety, in territory that has not gotten friendlier. Name it, set its behavior to something cautious, and walk it home before you celebrate. Back at base, level it toward the job you tamed it for — weight for a hauler, stamina and damage for a fighter — and from here on, protect it like the time investment it is. Losing a first mount teaches a lesson; it is cheaper to learn it from this sentence.',
          },
          {
            type: 'links',
            items: [
              { href: '/guides/beginners', label: "Beginner's Guide", note: 'the survival fundamentals this guide builds on' },
              { href: '/guides/resource-locations', label: 'Resource routes', note: 'where your new hauler earns its keep' },
              { href: '/lists/official-pve', label: 'Official PvE servers', note: 'the calmest place to practice all of this' },
            ],
          },
        ],
      },
    ],
  },
  {
    slug: 'resource-locations',
    title: 'Resource Locations — ARK: Survival Ascended',
    shortTitle: 'Resource Locations',
    description:
      'Where metal, crystal, obsidian, oil, and pearls actually live: reading terrain, picking the right tool and tame, and hauling it all home.',
    lastVerified: '2026-08-16',
    related: ['taming', 'beginners', 'boss-strategies'],
    sections: [
      {
        heading: 'Resources follow terrain, not maps',
        blocks: [
          {
            type: 'p',
            text: 'Every official map dresses the same underlying logic in different scenery: dense metal collects on mountains and in caves, crystal favors peaks and cold heights, obsidian hugs volcanic and geothermal ground, oil pools underwater and in polar biomes, and pearls hide in the deepest, least friendly water. Learn to read terrain once and you can farm a map you have never visited. Guides that hand you exact pin coordinates go stale with every spawn change; the terrain rules do not.',
          },
          {
            type: 'callout',
            text: "The question is never 'where is the metal on this map' — it is 'where are this map's mountains, and how do I survive them.'",
          },
        ],
      },
      {
        heading: 'Quick pick: what you need, where it lives',
        blocks: [
          {
            type: 'table',
            caption: 'Resource to terrain, tool, and hauling companion',
            headers: ['Resource', 'Terrain to read for', 'Best tool', 'Classic gatherer'],
            rows: [
              ['Metal', 'Mountain slopes, cave interiors, rocky spires', 'Metal pick', 'Ankylosaurus'],
              ['Crystal', 'Summits, ice biomes, crystalline cave growths', 'Metal pick', 'Ankylosaurus'],
              ['Obsidian', 'Volcanic slopes, geothermal zones, deep caves', 'Metal pick', 'Ankylosaurus'],
              ['Oil', 'Seafloor nodes, polar surface deposits', 'Metal pick', 'Dunkleosteus (underwater)'],
              ['Silica pearls', 'Deep ocean floor, cold shallows on some maps', 'Bare hands', 'Any fast swimmer with weight'],
              ['Cementing paste', 'Crafted from stone and chitin or keratin', 'Mortar or grinder', 'Beelzebufo (chitin from insects)'],
              ['Wood and thatch', 'Any forest; denser trees, better yield', 'Hatchet for wood, pick for thatch', 'Castoroides or Therizinosaur'],
            ],
          },
        ],
      },
      {
        heading: 'Metal: the economy runs on it',
        blocks: [
          {
            type: 'p',
            text: 'Metal is the resource that gates everything from mid-game tools to endgame bases, and it is heavy in a way nothing before it prepares you for. The richest nodes sit where living is hardest — high slopes with aggressive spawns and real fall danger. The pattern that works: establish a small forward outpost near the deposit with a bed and a smithy or forge, farm in short loops, and smelt or store on site rather than hauling raw ore down a mountain. Raw metal on your character is how survivors learn what encumbrance means.',
          },
          {
            type: 'list',
            items: [
              'Scout the route up before you bring the tame you cannot replace.',
              'A bed at the deposit turns death from a disaster into a commute.',
              'Smelting near the source moves pounds of ore as bars instead.',
            ],
          },
        ],
      },
      {
        heading: 'Crystal and obsidian: the high, cold, and hostile',
        blocks: [
          {
            type: 'p',
            text: 'Both concentrate where the air gets thin: crystal along summits and ice fields, obsidian on volcanic ground and in the deep caves. The obstacle is rarely finding them — you can often see the deposits glinting from below — it is the cold, the climbers\' hazards, and whatever the map staffs its peaks with. Dress for the biome, clear a safe pocket before you swing, and treat any smoking or lava-adjacent terrain as a place where one misstep costs the whole trip.',
          },
        ],
      },
      {
        heading: 'Oil: two very different trips',
        blocks: [
          {
            type: 'p',
            text: 'Oil offers a choice of miseries. Underwater nodes are plentiful but stack drowning risk on top of everything with teeth down there; a strong swimming tame turns that trip from a dare into a job. Polar surface deposits skip the drowning and swap in freezing temperatures and polar predators. Take whichever hazard your current gear answers better — and on maps with pump-friendly inland seeps, a placed oil pump quietly out-earns both trips while you do something else.',
          },
        ],
      },
      {
        heading: 'Pearls and paste: the patience resources',
        blocks: [
          {
            type: 'p',
            text: 'Silica pearls sit in open shells on the deep seafloor, often exactly where the water is darkest and least forgiving; grab-and-go with a fast swimmer beats lingering. Cementing paste is the other chokepoint material — craftable from stone plus chitin or keratin, which makes insect-heavy caves and swamps your quarry. On maps that have them, giant beaver dams hold ready-made paste, but looting a dam enrages every beaver nearby: empty it completely, swim first, and count the fury as part of the price.',
          },
        ],
      },
      {
        heading: 'Hauling is half the job',
        blocks: [
          {
            type: 'p',
            text: 'A farming trip is measured at home, not at the node. Weight-focused tames exist for exactly this: load the animal, not the survivor, and keep yourself light enough to fight or flee. Plan the return leg before the outbound one — downhill with cargo, along routes you cleared on the way in — and prefer two safe trips over one overloaded crawl. When a haul goes wrong it is almost always on the way back, at the moment the cargo made you slow and the route made you predictable.',
          },
        ],
      },
      {
        heading: 'Match the map to the shopping list',
        blocks: [
          {
            type: 'p',
            text: "Some maps simply serve certain lists better — flatter metal access, calmer waters over the pearl beds, denser forests. Before a dedicated farming session, check where your target map's rich ground actually is on its live hub page, and check the current harvesting rates: a bonus-rate weekend can halve the number of trips the same shopping list costs.",
          },
          {
            type: 'links',
            items: [
              { href: '/maps', label: 'Map hubs', note: 'terrain and live telemetry for every official map' },
              { href: '/rates', label: 'Current official rates', note: 'harvesting multipliers change the math of every trip' },
              { href: '/guides/taming', label: 'Taming guide', note: 'the gatherers in the table above start here' },
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
