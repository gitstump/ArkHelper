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
  {
    slug: 'settings-performance',
    title: 'Settings & Performance — ARK: Survival Ascended',
    shortTitle: 'Settings & Performance',
    description:
      "Getting playable performance out of ASA: presets, upscaling, the settings that matter, and how to tell your hardware's problems from the server's.",
    lastVerified: '2026-08-16',
    related: ['beginners', 'resource-locations', 'taming'],
    sections: [
      {
        heading: 'First, establish whose problem it is',
        blocks: [
          {
            type: 'p',
            text: "ASA performance complaints bundle two unrelated problems: frames and lag. Low framerate is your machine rendering slowly — choppy motion even standing alone in a quiet base. Lag is the network — rubber-banding, delayed hits, creatures teleporting — and no graphics setting on Earth fixes it. Before you tune anything, spend one minute diagnosing: check whether the whole network is having an incident, look at your server's ping, and if the ping is the problem, the fix is picking a closer server, not lowering your shadows.",
          },
          {
            type: 'links',
            items: [
              { href: '/is-ark-down', label: 'Is ARK down?', note: 'rule out a network-wide incident before blaming your rig' },
              { href: '/lists/low-ping', label: 'Low-ping servers', note: 'the fix for lag is proximity, not settings' },
            ],
          },
          {
            type: 'callout',
            text: 'Choppy alone in a quiet base: your hardware. Smooth frames but delayed hits and rubber-banding: the connection.',
          },
        ],
      },
      {
        heading: 'Why this game is heavy',
        blocks: [
          {
            type: 'p',
            text: "Survival Ascended is an Unreal Engine 5 rebuild, and it leans on the engine's most expensive features: fully dynamic global illumination and extremely dense geometry. That is why it looks the way it does and why hardware that handled Survival Evolved comfortably can struggle here. The honest framing: this is a demanding game by design, the ceiling on visual quality is very high, and your job is finding the rung of that ladder your machine actually stands on.",
          },
        ],
      },
      {
        heading: 'Presets first, pride later',
        blocks: [
          {
            type: 'p',
            text: 'Start by picking the built-in preset that gives you smooth motion, even if that preset is lower than you hoped, and play on it for a session before tuning anything. A stable baseline tells you what each later change actually does; starting from a custom scramble of settings tells you nothing. Move up one preset when things feel easy, down one when a crowded base or a rainstorm turns the game into a slideshow — weather and player structures are the real stress tests, not an empty beach.',
          },
        ],
      },
      {
        heading: 'The settings that actually move the needle',
        blocks: [
          {
            type: 'p',
            text: "Within the graphics menu, a handful of options carry most of the cost. The global illumination and shadow quality tiers are the heaviest, because they drive the engine's dynamic lighting. View distance matters more in ARK than most games — it changes how far away the world loads in detail, and the map is enormous. Foliage and clutter density fill the jungle at real cost. Effects and water quality spike exactly when things get chaotic, which is the worst possible time to lose frames. Texture quality is the odd one out: it mostly spends video memory rather than speed, so keep it high only if your card has memory to spare.",
          },
          {
            type: 'table',
            caption: 'Symptoms to first suspects',
            headers: ['Symptom', 'Likely culprit', 'First move'],
            rows: [
              ['Low frames everywhere, all the time', 'Overall preset above your hardware', 'Drop one full preset'],
              ['Fine until rain, night, or torchlight', 'Dynamic lighting and shadow tiers', 'Lower global illumination and shadows'],
              ['Fine until a big base or crowded area', 'Draw distance and density settings', 'Lower view distance and foliage'],
              ['Stutters when new areas or effects appear', 'Streaming and shader work, not raw speed', 'Expect improvement as sessions age; avoid alt-tabbing'],
              ['Smooth frames, delayed actions', 'Network, not graphics', 'Check ping and the network status page'],
            ],
          },
        ],
      },
      {
        heading: 'Upscaling is the biggest single lever',
        blocks: [
          {
            type: 'p',
            text: 'Modern upscalers render the game at a lower internal resolution and reconstruct a sharp image, and ASA supports the major ones. For most machines this is the largest single performance gain available, at a visual cost that ranges from invisible to mildly soft depending on the mode. Work down the quality modes until the framerate holds. Frame generation, where supported, is a different tool: it smooths the picture but not your inputs, so treat it as polish on top of an already-playable baseline rather than the thing that rescues an unplayable one.',
          },
        ],
      },
      {
        heading: 'About those launch-option lists',
        blocks: [
          {
            type: 'p',
            text: "Search for ASA performance and you will drown in lists of launch flags and command tweaks, most of them inherited from Survival Evolved — a different engine generation — and carried forward on faith. Some do nothing in Ascended; a few actively fight the engine's own management and cause the stutter they promise to cure. The unglamorous truth is that the in-game menu now covers what matters. If you experiment beyond it, change one thing at a time, measure in the same place and weather, and be ready to undo — 'it feels faster' after five changes is how machines end up haunted.",
          },
        ],
      },
      {
        heading: 'Consoles and the settings you cannot touch',
        blocks: [
          {
            type: 'p',
            text: 'On Xbox and PlayStation the graphics ladder is mostly decided for you, which removes the tuning burden and the tuning options in one stroke. What remains in your control is the same triage from the top of this guide: server choice and connection. A wired connection over wireless, a server on your continent, and joining outside the evening rush hours do more for a console session than anything in a menu. If performance dips network-wide, it is worth checking whether an update is rolling out before troubleshooting your own setup.',
          },
        ],
      },
      {
        heading: 'Where to go next',
        blocks: [
          {
            type: 'links',
            items: [
              { href: '/servers', label: 'Server browser', note: 'sort by ping and filter by region before you commit' },
              { href: '/is-ark-down', label: 'Network status', note: 'incidents and update rollouts, detected live' },
              { href: '/guides/beginners', label: "Beginner's Guide", note: 'now that it runs, here is how to survive it' },
            ],
          },
        ],
      },
    ],
  },
  {
    slug: 'breeding-mutations',
    title: 'Breeding & Mutations — ARK: Survival Ascended',
    shortTitle: 'Breeding & Mutations',
    description:
      'From first egg to a bred line: the breeding loop, imprinting, how inheritance works, and what mutations really are — without the spreadsheet.',
    lastVerified: '2026-08-16',
    related: ['taming', 'boss-strategies', 'beginners'],
    sections: [
      {
        heading: 'Why breed at all',
        blocks: [
          {
            type: 'p',
            text: 'A wild tame is a lottery ticket you already scratched; a bred creature is a design. Breeding lets you combine the best qualities of two parents, raise the baby under your protection, and imprint it to fight harder for you specifically. It is how tribes produce the animals that clear bosses and win wars — and it is the longest time investment in the game, so check the current breeding and maturation rates before you start a line. A bonus-rate weekend can compress days of raising into an evening.',
          },
          {
            type: 'links',
            items: [
              { href: '/rates', label: 'Current official rates', note: 'maturation and imprint multipliers decide your calendar' },
            ],
          },
        ],
      },
      {
        heading: 'The loop: pair, wait, raise, repeat',
        blocks: [
          {
            type: 'p',
            text: 'The mechanics are simple to start: two tamed creatures of the same species, opposite sexes, set to mating in close proximity and not on wander duty elsewhere. Egg-layers produce a fertilized egg that needs incubation at the right temperature — too hot or too cold and the egg takes damage instead of progress. Live-bearers carry a gestation instead. Either way the result is a baby that eats constantly, grows through juvenile and adolescent stages, and demands the most attention in exactly its earliest window, when it cannot feed from a trough and will starve fast without hand feeding. Do not start a hatch you cannot babysit.',
          },
          {
            type: 'callout',
            text: 'The first hour after hatching is the commitment. Clear your schedule before you clear the incubation.',
          },
        ],
      },
      {
        heading: 'Imprinting: raising it yourself pays',
        blocks: [
          {
            type: 'p',
            text: 'While a baby grows, it periodically asks for care — a cuddle, a walk, a particular comfort food. Answering those requests as the same player builds imprint, and a fully imprinted creature is measurably tougher and hits harder when that player rides it. The requests arrive on an interval throughout maturation, which is the real cost of a perfect imprint: presence. Decide up front whether this animal is a personal mount worth the vigil or line stock where imprint matters less, and size your effort accordingly.',
          },
        ],
      },
      {
        heading: 'Inheritance: each stat flips its own coin',
        blocks: [
          {
            type: 'p',
            text: "Every stat on the baby — health, melee, weight, and the rest — is inherited separately, drawn from one parent or the other, with the odds leaning toward the higher parent. That per-stat independence is the entire foundation of selective breeding: pair a father with outstanding health against a mother with outstanding melee, and some offspring will draw both winning cards. Those best-of-both babies become the next generation's parents. A bred line is nothing more than repeating that cull-and-combine loop until one animal carries every stat you care about.",
          },
          {
            type: 'list',
            items: [
              'Tame widely first: wild stats are the raw material of a line.',
              'Track which parent carries which prize stat before pairing.',
              'Keep the best offspring as breeders; the rest are boss fodder.',
            ],
          },
        ],
      },
      {
        heading: 'Mutations: rare, random, and stacked with care',
        blocks: [
          {
            type: 'p',
            text: 'Occasionally a baby is born with something neither parent has: a mutation. Each one adds levels to a single random stat, often with a color change as its calling card, and the game tracks them — the ancestry screen shows a mutation counter on each side of the lineage. The catch that organizes all serious breeding: a parent whose counter has hit its cap has effectively stopped producing new mutations, so long-running programs guard a supply of low-counter breeding stock to keep the door open. The standard pattern is one mutated line crossed repeatedly against clean partners, folding each new mutation back into the stack.',
          },
          {
            type: 'p',
            text: 'None of this needs a spreadsheet to begin. Breed good parents, keep babies that are strictly better, and treat any mutation in a stat you care about as a small lottery win to preserve — the deep optimization can come after the tenth generation, not before the first.',
          },
        ],
      },
      {
        heading: 'Logistics: the part that actually defeats people',
        blocks: [
          {
            type: 'p',
            text: 'Breeding programs fail on food and space before they fail on genetics. Growing babies eat astonishing amounts, so raising means full feeding troughs, a meat or berry pipeline to keep them full, and enough room that a dozen adolescents are not clipping through your walls. Air conditioning or careful biome choice handles egg temperatures; standing incubation infrastructure beats improvising with campfires every hatch. And name things — two generations in, an unlabeled pen of identical creatures is an unsearchable database of your own making.',
          },
        ],
      },
      {
        heading: "When is a line 'done'?",
        blocks: [
          {
            type: 'p',
            text: 'It is not, and accepting that early saves grief. A line is good enough when it does its job: clears the boss tier you are targeting, hauls what you need hauled, wins the fights you pick. Chasing a perfect specimen is a hobby in itself — a fine one, but distinct from playing the rest of the game. Set a concrete goal for the line, reach it, and let the program rest until the goal changes. The best breeders ship.',
          },
        ],
      },
      {
        heading: 'Where to go next',
        blocks: [
          {
            type: 'links',
            items: [
              { href: '/guides/taming', label: 'Taming guide', note: 'every line starts with wild-caught parents' },
              { href: '/guides/boss-strategies', label: 'Boss strategies', note: 'what all this breeding is for' },
              { href: '/rates', label: 'Official rates', note: 'time any serious hatch around the multipliers' },
            ],
          },
        ],
      },
    ],
  },
  {
    slug: 'boss-strategies',
    title: 'Boss Strategies — ARK: Survival Ascended',
    shortTitle: 'Boss Strategies',
    description:
      "Preparing for and surviving ARK's boss arenas: the summoning ritual, army composition, fight roles, and why the preparation is the fight.",
    lastVerified: '2026-08-16',
    related: ['breeding-mutations', 'taming', 'resource-locations'],
    sections: [
      {
        heading: 'The boss fight starts weeks earlier',
        blocks: [
          {
            type: 'p',
            text: "ARK's bosses are the exam at the end of the course. The arena itself lasts minutes; everything that decides it — the bred creatures, the imprints, the saddles, the gear — happened at your base over the preceding weeks. If a boss attempt fails, the lesson is almost never 'fight better.' It is that the army was underbred, the saddles were thin, or the team walked in unrehearsed. This guide is mostly about the weeks, because the weeks are the fight.",
          },
          {
            type: 'callout',
            text: 'You do not lose a boss fight in the arena. You lose it in the breeding pen, and the arena delivers the news.',
          },
        ],
      },
      {
        heading: 'How a fight actually happens',
        blocks: [
          {
            type: 'p',
            text: "Each map's endgame runs through summoning terminals — at obelisks and certain other fixed structures — where you offer up the required tributes to open a fight. The map's exploration rewards, the trophies taken from formidable wild creatures, and the artifacts recovered from its hardest caves are the currency; gathering them is a campaign of its own and a decent dress rehearsal for the arena. Activating the summon teleports you and the creatures standing near you into a sealed arena with a timer. There is no retreating to resupply: whatever and whomever crossed the threshold is the entire plan.",
          },
        ],
      },
      {
        heading: 'Choose your tier honestly',
        blocks: [
          {
            type: 'p',
            text: 'Bosses come in ascending difficulty tiers, and the tiers are not a formality — each step up is a substantially harder version of the same fight, with rewards to match. The honest move is to clear the lowest tier first, treat it as reconnaissance with pay, and let the performance of your army there tell you whether the next tier is a plan or a donation. Wiping a bred army on an overambitious attempt sets a tribe back further than any patient ladder-climb ever would.',
          },
        ],
      },
      {
        heading: 'The army: bred, imprinted, and saddled',
        blocks: [
          {
            type: 'p',
            text: 'The backbone of most boss armies is a line of bred creatures with concentrated health and melee — the direct product of the breeding loop — imprinted to the player who will lead them, and wearing the best saddles your smithy can produce. Saddle armor is the quiet variable that decides fights: it reduces every hit every creature takes for the entire arena, and a strong saddle blueprint is worth more than another dozen levels of stats. Alongside the frontline, most compositions carry a support creature whose buff strengthens nearby allies — the classic edge that turns a close fight comfortable.',
          },
          {
            type: 'list',
            items: [
              'Health and melee win arenas; hauling stats stay home.',
              'Imprint to the rider who will actually be in the arena.',
              'Farm and craft for saddle quality like the fight depends on it, because it does.',
            ],
          },
        ],
      },
      {
        heading: 'Roles in the arena',
        blocks: [
          {
            type: 'p',
            text: "A boss team is small enough that everyone's job matters. The rider on the sturdiest mount takes and holds the boss's attention and keeps it pointed away from the pack. The rest of the riders bring the damage, hitting from the flanks. Whistle commands are the steering wheel for the unridden army — practice moving the pack as a group before the day, because the arena is a terrible classroom. Some fights add waves of lesser creatures or hazards that punish tunnel vision; someone must own the job of watching for them while everyone else watches the boss.",
          },
        ],
      },
      {
        heading: 'Gear for the minutes that matter',
        blocks: [
          {
            type: 'p',
            text: 'Riders die in arenas more often than mounts do. Bring the best armor you can craft, food and brews to keep yourself standing, and a ranged weapon for the phases where dismounting or losing your mount forces plan B. Cold, heat, or other environmental pressure inside some arenas can add a layer the boss itself never mentions — dress for the venue, not just the fight. And carry nothing you fear losing: arenas are where optimistic inventories go to be donated.',
          },
        ],
      },
      {
        heading: 'After the victory',
        blocks: [
          {
            type: 'p',
            text: "A won fight pays in three currencies: element, the endgame resource that powers the technology tier; engrams, unlocking that tier's crafting; and progression toward the map's ascension — the story climb that raises your level ceiling and leads to the next chapter. Element is why boss fights become routine rather than milestones: the technology it powers is consumed with use, so the arena becomes a farm. That is the endgame loop — breed, fight, spend, repeat — and it is exactly why the breeding guide ends with 'the best breeders ship.'",
          },
        ],
      },
      {
        heading: 'Where to go next',
        blocks: [
          {
            type: 'links',
            items: [
              { href: '/guides/breeding-mutations', label: 'Breeding & Mutations', note: 'the army does not tame itself into existence' },
              { href: '/maps', label: 'Map hubs', note: 'pick the map whose endgame you are gearing for' },
              { href: '/rates', label: 'Official rates', note: 'breed and farm the army on the right weekend' },
            ],
          },
        ],
      },
    ],
  },
  {
    slug: 'scorched-earth-progression',
    title: 'Scorched Earth Progression Guide — ARK: Survival Ascended',
    shortTitle: 'Scorched Earth Progression',
    description:
      'Surviving the desert from first canteen to the Manticore: water, heat, sandstorms, wyverns, and the order that makes the map beatable.',
    lastVerified: '2026-08-17',
    related: ['boss-strategies', 'resource-locations', 'aberration-progression', 'beginners'],
    sections: [
      {
        heading: 'What Scorched Earth asks of you',
        blocks: [
          {
            type: 'p',
            text: 'Scorched Earth is the first story expansion, and it teaches by subtraction. There are no forgiving coastlines, no easy freshwater, and no gentle starter biome — the whole map is desert, and the desert is the antagonist. Everything you learned on The Island still applies; the map just adds a second clock. On The Island you managed food and safety. Here you also manage water and temperature, all the time, everywhere.',
          },
          {
            type: 'p',
            text: 'You can arrive two ways: transfer an established survivor through an obelisk or supply drop, or start fresh on the sand. A transferred character keeps levels and engrams, which softens the early game considerably. A fresh start is the harder, purer version — and a popular one, because Scorched Earth rewards exactly the habits the beginner path builds. Either way, your first days are about infrastructure, not exploration.',
          },
          {
            type: 'callout',
            text: 'The map has a difficulty gradient like any other: the outer dunes and lowlands are the easy zone, the central canyons and mountains are not. Progression on this map is mostly the story of earning your way inward.',
          },
        ],
      },
      {
        heading: 'Water is the real tutorial',
        blocks: [
          {
            type: 'p',
            text: 'Thirst drains faster here than anywhere else, and open water is scarce and rarely safe to camp beside. Your progression through the map tracks your progression through water technology: drink from the rare oases when you find them, then carry water in jars, then stop hauling it at all. Wells and reservoirs let a base bank its own supply, and irrigation makes crop plots viable in a place that otherwise refuses to grow anything.',
          },
          {
            type: 'p',
            text: 'The desert also offers water in stranger forms. Certain cacti yield a sap you can drink your way through, some insects can be harvested for hydration in a pinch, and one local herbivore is essentially a walking water tank — tame one early and your gathering runs stop being timed by your canteen. Learning these backup sources is the difference between a bad afternoon and a corpse run.',
          },
          {
            type: 'list',
            items: [
              'Never leave base without more water than you think the trip needs.',
              'Build your first real base within reach of a reliable water source, then engineer your way to independence from it.',
              'Heat multiplies thirst: the hotter the hour, the shorter your range.',
            ],
          },
        ],
      },
      {
        heading: 'Heat, insulation, and the adobe answer',
        blocks: [
          {
            type: 'p',
            text: "Daytime heat on this map will cook an unprepared survivor through their armor, and the nights swing cold enough to bite. The clothing answer is counterintuitive: desert-appropriate gear protects against both extremes, and sometimes the right move in a heat wave is less armor, not more. Watch your insulation readouts and dress for the weather, not the fight.",
          },
          {
            type: 'p',
            text: "The building answer is adobe. This map introduces a building tier made from local materials that insulates far better than stone against the desert's swings, and a structure that shades and cools whatever stands under it. An adobe base with shade and stored water turns the climate from a constant threat into background noise — which is precisely what lets you start thinking about the rest of the map.",
          },
        ],
      },
      {
        heading: 'The desert food chain, and your first tames',
        blocks: [
          {
            type: 'p',
            text: 'The local wildlife is a study in specialization. A small shoulder pet will flinch and cry before weather events hit, giving you a warning system that no crafted item replaces. The water-storing herbivore doubles as an early pack animal. Vultures wheel over anything dead and will mob you at a carcass, which is both a hazard and a dinner bell. Familiar Island species roam here too, so your existing taming instincts still earn their keep.',
          },
          {
            type: 'p',
            text: 'Tame in this order of need, not prestige: weather warning, water carrier, then a fast mount that can outrun what you cannot fight. Speed matters more here than raw power for most of the early map, because the correct response to half the desert\'s threats is to leave.',
          },
          {
            type: 'links',
            items: [
              { href: '/guides/taming', label: 'Taming Guide', note: 'knockout and passive methods that all transfer to the desert' },
              { href: '/guides/resource-locations', label: 'Resource Locations', note: 'terrain-first farming logic that applies on every map' },
            ],
          },
        ],
      },
      {
        heading: 'Sandstorms and the weather that fights back',
        blocks: [
          {
            type: 'p',
            text: 'Scorched Earth\'s weather is an active participant. Sandstorms drop visibility to arm\'s length, sap your stamina, and ground any sensible flyer; heat waves push the day\'s temperature from hostile to lethal. Neither can be fought — both can be scheduled around. When your shoulder pet panics, you have a short window to get under a roof, and a base with shade, water, and walls makes weather a coffee break instead of an emergency.',
          },
          {
            type: 'callout',
            text: 'Getting caught in the open by a sandstorm is survivable if you stop moving, hunker behind terrain, and wait it out. Getting caught in the open and pressing on is how the desert collects gear.',
          },
        ],
      },
      {
        heading: 'Wyverns and the scar in the world',
        blocks: [
          {
            type: 'p',
            text: 'The map\'s signature predators are wyverns, and they mark the midgame line. They nest in the great trench that cuts through the map, and they cannot be tamed the way anything else can: you raise one, from an egg, stolen from that trench while its owners object. An egg heist is a genuine operation — you need a fast way in, a faster way out, and a plan for the escort of angry adults that follows you home.',
          },
          {
            type: 'p',
            text: 'A stolen egg is only half the job. Hatching one demands serious temperature control, and a hatchling will only accept a special milk that comes from the very creatures you just robbed. The whole loop — heist, hatch, milk runs — is the map\'s midgame in miniature: preparation-heavy, terrifying the first time, and routine by the third. A raised wyvern then trivializes travel and rewrites what you can hunt.',
          },
        ],
      },
      {
        heading: 'Deathworms and the deep desert',
        blocks: [
          {
            type: 'p',
            text: 'The open dunes hide the map\'s ambush predator: a burrowing horror that erupts under anything heavy crossing the deep sand. Deathworms gatekeep the emptiest stretches of the map and, importantly, drop a trophy the endgame requires — so you cannot simply avoid them forever. Fight them on your terms: bring a hard-hitting mount, watch the sand for movement, and never wander the deep desert encumbered and slow.',
          },
          {
            type: 'p',
            text: 'By the time deathworms are farmable rather than frightening, you have effectively finished the map\'s curriculum: your water is infrastructure, your base ignores the weather, and your stable includes speed, cargo, and violence. What remains is the exam.',
          },
        ],
      },
      {
        heading: 'The Manticore, and where the story goes next',
        blocks: [
          {
            type: 'p',
            text: 'The desert\'s guardian is the Manticore, fought in its own arena and reached the way all guardians are: gather the artifacts hidden in the map\'s caves, pay the arena\'s entry requirements, and bring a team of creatures bred and armored for the job. It is a flying, stinging fight that punishes ground-only armies — plan your composition around a boss that refuses to stay put. The general preparation logic is the same as every boss fight, and the Boss Strategies guide covers it.',
          },
          {
            type: 'p',
            text: 'Beating the guardian is not just a victory screen; in the story\'s arc it is the reason the map exists. Scorched Earth is the bridge between The Island\'s ending and what waits underground on Aberration, and finishing here — ascending through the guardian\'s arena — is how a survivor follows the story forward. When you leave the desert, you leave it upward.',
          },
          {
            type: 'links',
            items: [
              { href: '/guides/boss-strategies', label: 'Boss Strategies', note: 'army composition, arena roles, and why preparation is the fight' },
              { href: '/guides/beginners', label: "Beginner's Guide", note: 'the fundamentals the desert assumes you know' },
            ],
          },
        ],
      },
    ],
  },
  {
    slug: 'aberration-progression',
    title: 'Aberration Progression Guide — ARK: Survival Ascended',
    shortTitle: 'Aberration Progression',
    description:
      'The underground ARK from first Bulbdog to Rockwell: charge light, verticality, radiation, Rock Drakes, and the order that makes the map survivable.',
    lastVerified: '2026-08-17',
    related: ['scorched-earth-progression', 'boss-strategies', 'taming', 'extinction-progression'],
    sections: [
      {
        heading: 'What Aberration asks of you',
        blocks: [
          {
            type: 'p',
            text: 'Aberration is a broken ARK. The station malfunctioned, the surface burned, and the world that survived moved underground — which means everything you know about reading a map gets rotated ninety degrees. There are no flyers here; the map forbids them outright. The surface is lethal for most of the day. Progress does not live north or inland the way it did on earlier maps. It lives down, and the map\'s real antagonist is gravity.',
          },
          {
            type: 'p',
            text: 'As with Scorched Earth, you can arrive by transferring an established survivor through an obelisk or supply drop, or start fresh in the dirt. A transfer keeps your levels and engrams and softens the opening considerably. A fresh start is harder and slower, but Aberration is arguably the best map in the game at teaching its own grammar — every system it introduces gets a gentle version near spawn and a lethal version below. Either way, resist the urge to descend early. The map will let you walk into places it has no intention of letting you leave.',
          },
          {
            type: 'callout',
            text: 'The difficulty gradient runs downward: the green upper zone is the easy ring, the blue glowing middle is the test, and the red depths are the endgame. Progression on Aberration is the story of earning your way down.',
          },
        ],
      },
      {
        heading: 'The green zone is your whole early game',
        blocks: [
          {
            type: 'p',
            text: 'You spawn in the fertile upper zone — green, wet, and deceptively familiar. Trees, berries, and open water make it feel like The Island with mood lighting, and by Aberration\'s standards it is genuinely safe. Treat it the way the beginner path treats an easy beach: base here, level here, and learn the map\'s verticality while the stakes are low. Ledges that look like scenery are roads, and the sooner you start seeing routes in three dimensions, the sooner the map stops killing you.',
          },
          {
            type: 'p',
            text: 'Build early and build modestly, close to water and away from ledge edges. The fertile zone supplies everything your first weeks need: wood, stone, crystal in the walls, and farmable plots that grow the mushrooms this map substitutes for familiar crops. There is no rush to leave. A survivor who over-stays the green zone loses nothing; a survivor who under-stays it becomes a loot bag somewhere dark.',
          },
          {
            type: 'links',
            items: [
              { href: '/maps/aberration', label: 'Live Aberration servers', note: 'population, uptime, and versions right now' },
              { href: '/lists/official-pve', label: 'Official PvE servers', note: 'the recommended pool for a first Aberration run' },
              { href: '/guides/beginners', label: "Beginner's Guide", note: 'the habits this map assumes you already have' },
            ],
          },
        ],
      },
      {
        heading: 'Charge light and the things that hate it',
        blocks: [
          {
            type: 'p',
            text: 'Charge light is Aberration\'s signature mechanic, and it is not cosmetic. In the deeper zones, darkness is inhabited: the Nameless rise out of the ground around survivors who travel without light, and enough of them will summon something far worse. Charge — the blue-white glow carried by this map\'s light pets and a few crafted lanterns — suppresses them. On Scorched Earth the resource that ruled your planning was water. Here it is light.',
          },
          {
            type: 'p',
            text: 'The fix is one of the friendliest tames in the game. Small glowing shoulder pets wander the green and blue zones and tame passively — walk up with the right food and a little patience. A Bulbdog is the classic first pick, and one on your shoulder with its light up is the difference between the deep zones being a place you work and a place you die. Keep its charge topped up, and never descend without it.',
          },
          {
            type: 'callout',
            text: 'A shoulder light pet is not decoration. It is this map\'s canteen — the one piece of preparation that everything below the green zone silently assumes.',
          },
        ],
      },
      {
        heading: 'First tames of the underground',
        blocks: [
          {
            type: 'p',
            text: 'The map\'s workhorse is the Ravager — a pack-hunting wolf that climbs ziplines, carries absurd loads, and gets weight-reduction on the ores and materials you will be hauling constantly. Taming one converts Aberration from a hiking trip into a logistics operation, and taming several gives you a pack that can fight its way through most of what the middle zones offer. If you tame one thing on purpose in your first week, make it a Ravager.',
          },
          {
            type: 'p',
            text: 'Around it, build the same modest bench of workers the beginner path recommends anywhere: something that gathers, something that fights, and your light pet. The fertile zone stocks gentle herbivores for berry and thatch work, and the Roll Rat digs up wood and fungal materials while doubling as transport. Knockout taming works exactly as it does everywhere else — torpor, the right food, and a safe perimeter — so the taming guide applies unchanged here.',
          },
          {
            type: 'links',
            items: [
              { href: '/guides/taming', label: 'Taming Guide', note: 'knockout and passive methods, torpor, and traps' },
            ],
          },
        ],
      },
      {
        heading: 'Moving without wings',
        blocks: [
          {
            type: 'p',
            text: 'Aberration deletes flyers and then hands you a stranger, better toolkit. Climbing picks turn sheer walls into paths. Ziplines turn chasms into commutes — anchor them between ledges, and a Ravager can run them with you mounted. The glider suit turns every high ledge into a launch point, and half of the map\'s traversal skill is learning which drops are a glide and which are an obituary. Together they make movement on this map a learned craft rather than a stat check.',
          },
          {
            type: 'p',
            text: 'Fall damage is Aberration\'s leading cause of death, and it is not close. Plan routes down, not across: a good descent is a chain of ledges, each one survivable, scouted from above before you commit. Mark your route home. The map\'s layered geometry means the way back is rarely the reverse of the way in, and a survivor who descends without an exit plan has not actually descended — they have moved into the hole they will die in.',
          },
          {
            type: 'callout',
            text: 'Before any serious descent, ask one question: if this goes wrong halfway down, where do I land, and does anything live there?',
          },
        ],
      },
      {
        heading: 'Radiation and the hazard suit',
        blocks: [
          {
            type: 'p',
            text: 'Below the blue bioluminescent zone, the map stops negotiating. The red element depths are irradiated, and radiation ignores armor, ignores hit points, and kills unprotected survivors with total indifference. The answer is the hazard suit — a full-body crafted set that makes the deep zones workable. It degrades with use, so carry spares; a suit that fails at the bottom of the map is the same as never having worn one.',
          },
          {
            type: 'p',
            text: 'What the depths offer is the reason this map exists: dense metal and crystal, the charged materials that power this map\'s technology, and the nesting trenches where Rock Drake eggs wait. Work the red zones in deliberate, planned trips — descend with a purpose, fill your Ravager, and leave. The deep is a place you raid, not a place you live, and every system on the map is tuned to punish anyone who forgets which.',
          },
        ],
      },
      {
        heading: 'Rock Drakes and the grave of the lost',
        blocks: [
          {
            type: 'p',
            text: 'The Rock Drake is Aberration\'s signature mount, and you do not tame one — you steal one. Adults cannot be tamed at all. Eggs nest in the irradiated trenches near the bottom of the map, guarded by adult drakes that turn hostile the moment you touch a nest, and the theft run is this map\'s wyvern moment: hazard suit on, light pet up, escape route memorized, and a plan for being chased by things that climb every surface you can.',
          },
          {
            type: 'p',
            text: 'A raised drake rewrites the map. It climbs any wall, glides any gap, and cloaks itself and its rider — which matters, because the deep zones are also where the Nameless and worse hunt in earnest. The egg run is the hardest thing the map has asked of you so far, and it is deliberately positioned that way: everything before it — the light pets, the Ravagers, the movement tech, the hazard suit — was the preparation, whether you knew it or not.',
          },
          {
            type: 'links',
            items: [
              { href: '/guides/scorched-earth-progression', label: 'Scorched Earth Progression', note: 'the wyvern-scar run this one rhymes with' },
            ],
          },
        ],
      },
      {
        heading: 'Rockwell, and where the story goes next',
        blocks: [
          {
            type: 'p',
            text: 'The depths hold one more predator worth naming. Reaper Queens hunt the red zones, and the map\'s strangest mechanic runs through them: a survivor who plays that encounter exactly right — and it is an encounter you study for, not stumble into — can end up raising a rideable Reaper of their own, one of the strongest creatures on the ARK. It is optional, late-game, and pure Aberration: the map\'s worst monster is also its best reward.',
          },
          {
            type: 'p',
            text: 'The map ends at a terminal in the deepest place it has, where Sir Edmund Rockwell — the expansion\'s ruined antagonist — waits as its boss. The fight favors everything this map taught you: charge light to strip his defenses, mobile mounts, and the discipline to prepare rather than improvise. Beating him ascends your survivor and points the story at its next stop — Extinction, and the ruined Earth the ARKs have been circling all along.',
          },
          {
            type: 'callout',
            text: 'Boss preparation on this map follows the same law as everywhere else: the fight is won in the weeks before the terminal, not the minutes after it. The Boss Strategies guide covers the shape of that preparation.',
          },
        ],
      },
    ],
  },
  {
    slug: 'extinction-progression',
    title: 'Extinction Progression Guide — ARK: Survival Ascended',
    shortTitle: 'Extinction Progression',
    description:
      'The ruined Earth from city scavenging to the King Titan: corruption, Element, orbital drops, the three Titans, and the order that makes the endgame earnable.',
    lastVerified: '2026-08-17',
    related: ['aberration-progression', 'boss-strategies', 'breeding-mutations', 'genesis-progression'],
    sections: [
      {
        heading: 'What Extinction asks of you',
        blocks: [
          {
            type: 'p',
            text: 'Extinction is not an ARK. It is the Earth the ARKs left behind — a ruined homeworld overgrown with Element, patrolled by creatures the corruption has already claimed, and dotted with the wreckage of the civilization that built everything you have been climbing toward. This is the destination of the original trilogy, and the map assumes you finished growing up somewhere else. Its opening is gentler than Aberration\'s, but its endgame is the hardest content the first three maps have.',
          },
          {
            type: 'p',
            text: 'As before, you can transfer an established survivor through an obelisk or supply drop, or start fresh in the ruins. Fresh starts are genuinely viable here — the map\'s opening zone is one of the more protective in the game — but Extinction is the trilogy\'s finale, and it reads best in order: the habits Scorched Earth drilled and the discipline Aberration demanded are exactly what the wasteland spends. Either way, the early game is about the city, and the city is kinder than it looks.',
          },
          {
            type: 'callout',
            text: 'Aberration\'s gradient ran downward. Extinction\'s runs outward: the city is the easy ring, the open wasteland is the test, and the domes and the forbidden zone are the endgame. Progression here is the story of earning your way out.',
          },
        ],
      },
      {
        heading: 'The city is your green zone',
        blocks: [
          {
            type: 'p',
            text: 'You start in the Sanctuary — a dead city under a failing shield, and the safest ground the map offers. Its streets hold gentle wildlife and its edges hold everything else, so the early rule is simple: the deeper into the city you are, the safer you are. Base inside it, modestly, the way the beginner path bases on an easy beach, and treat the shield boundary as the line between learning the map and being tested by it.',
          },
          {
            type: 'p',
            text: 'The city has one habit no other map teaches: it is harvestable. Lampposts, benches, wrecked vehicles, and broken structures break down into metal, crystal, electronics, and scrap at rates other maps reserve for mountaintops. The ruins are a starter kit — a survivor who spends their first days stripping streets will hit mid-game technology faster here than anywhere else in the trilogy. Scavenge first, mine later.',
          },
          {
            type: 'links',
            items: [
              { href: '/maps/extinction', label: 'Live Extinction servers', note: 'population, uptime, and versions right now' },
              { href: '/lists/official-pve', label: 'Official PvE servers', note: 'the recommended pool for a first Extinction run' },
              { href: '/guides/beginners', label: "Beginner's Guide", note: 'the habits the wasteland will spend' },
            ],
          },
        ],
      },
      {
        heading: 'Corruption, and the enemies that never tame',
        blocks: [
          {
            type: 'p',
            text: 'The corruption is Extinction\'s standing threat. Corrupted creatures — Element-warped versions of animals you know — roam the wasteland in packs, attack anything uncorrupted on sight, and chew through structures with unusual appetite. They are the reason the open map feels hostile in a way no weather system ever managed: the danger is not an environment you dress for but a population that hunts.',
          },
          {
            type: 'p',
            text: 'Plan around them the way Aberration taught you to plan around the dark. Travel with escorts, build with defense in mind even in quiet stretches, and treat any corrupted sighting as a pack until proven otherwise. Their pressure scales with how far from the city you are, which is the map\'s gradient enforcing itself.',
          },
          {
            type: 'callout',
            text: 'On every other map, each predator is a future mount. Corrupted creatures are not: nothing corrupted can ever be tamed. There is no clever method and no exception — fight them or route around them.',
          },
        ],
      },
      {
        heading: 'First tames of the wasteland',
        blocks: [
          {
            type: 'p',
            text: 'Extinction\'s native bench is the strangest in the game, and three of its tames restructure your economy outright. The Gacha is a walking production line — feed it stone and scrap and it produces crystals containing resources and loot. Gasbags is an absurd, lovable hauler that carries enormous weight and floats down from any height. The Velonasaur is a living turret whose spines answer the corrupted-pack problem directly. Between those three, the map\'s logistics, and much of its defense, are solved.',
          },
          {
            type: 'p',
            text: 'The colder and greener reaches add the Snow Owl, whose dive can freeze and whose presence can heal — the closest thing the game has to a field medic — and the Managarmr, a frost-breathing dasher that makes distance trivial. Under all of it, the fundamentals have not changed: torpor, the right food, and a safe perimeter still tame everything tameable, so the taming guide applies unchanged here.',
          },
          {
            type: 'links',
            items: [
              { href: '/guides/taming', label: 'Taming Guide', note: 'knockout and passive methods, torpor, and traps' },
            ],
          },
        ],
      },
      {
        heading: 'Element nodes and orbital drops',
        blocks: [
          {
            type: 'p',
            text: 'The wasteland\'s core loop is defense. Element nodes erupt from the ground and orbital supply drops fall from the sky, and both work the same way: activate one, and escalating waves of corrupted creatures come to destroy it while you hold the line. Win, and the node yields harvestable Element — the endgame currency every other map locks behind bosses — while the drop opens into loot that scales with the difficulty you defended.',
          },
          {
            type: 'p',
            text: 'Respect the tiers. Low-difficulty defenses are honest early-game content the moment you have a Velonasaur and a wall; the highest tiers will delete an unprepared army without slowing down. Work upward deliberately, fortify before you activate rather than after, and treat each defense as a rehearsal for the fight this map ends on — because that is exactly what they are.',
          },
          {
            type: 'callout',
            text: 'Extinction hands out Element without a boss fight, and that is the map\'s quiet gift: the endgame materials every earlier map gated behind arenas are farmable here by anyone who can hold a wall.',
          },
        ],
      },
      {
        heading: 'The domes and the deep wasteland',
        blocks: [
          {
            type: 'p',
            text: 'Past the open wasteland, the map concentrates its biomes into sealed extremes: a desert dome and a snow dome, each a compressed, harsher version of the climates earlier maps spread across whole regions, and a sunken forest crater that hides the map\'s strangest wildlife. Each holds creatures and resources the city and wasteland do not, and each assumes you arrive equipped — the domes are destinations, not detours.',
          },
          {
            type: 'p',
            text: 'Beyond even those lies the forbidden zone, the Element-saturated heart of the corruption where the map keeps its final terminal and its worst inhabitants. You do not wander in. Everything the map has taught — city economy, corrupted-pack discipline, defense rehearsals, dome-hardened gear — is the entry fee, and the zone collects it in full.',
          },
        ],
      },
      {
        heading: 'The Titans',
        blocks: [
          {
            type: 'p',
            text: 'Extinction\'s mid-bosses are the Desert, Ice, and Forest Titans — creatures at a scale the game has not asked you to fight before, each summoned at its own arena in the region it rules. They are the trilogy\'s strangest power spike: a Titan defeated the right way can be brought over to your side, temporarily, as a raid-scale ally. The map is explicit about the trade — Titans do not last, so a tamed one is a window, not a possession, and the window is meant to be spent.',
          },
          {
            type: 'p',
            text: 'Fight them even if you never intend to tame one. Each Titan is a lesson in the grammar the King Titan speaks — huge health pools, arena mechanics that punish standing still, and armies as ammunition — delivered at a survivable scale. Survivors who arrive at the final terminal without having fought a Titan are taking the exam without the coursework.',
          },
        ],
      },
      {
        heading: 'The King Titan, and where the story goes next',
        blocks: [
          {
            type: 'p',
            text: 'The map ends where the corruption began: the King Titan, summoned at the forbidden zone\'s terminal, the final boss of the original trilogy and the hardest fight in it. Everything is legal here — bred armies, crafted war machines, even a tamed Titan brought as a siege partner — and the fight expects all of it. This is the encounter the entire progression chain has been quietly preparing you for since the first beach.',
          },
          {
            type: 'p',
            text: 'Victory closes the story the first three maps told — and opens the next one. Beyond Extinction the ARKs\' tale continues into Genesis and its simulated worlds, where the rules bend again and the preparation starts over. The trilogy\'s lesson travels with you: every map teaches its own grammar, and the survivors who thrive are the ones who arrive ready to learn it.',
          },
          {
            type: 'callout',
            text: 'The law from every arena still holds, at its largest scale yet: the King Titan is won in the months before the terminal, not the minutes after it. The Boss Strategies guide covers the shape of that preparation.',
          },
        ],
      },
    ],
  },
  {
    slug: 'genesis-progression',
    title: 'Genesis Progression Guide — ARK: Survival Ascended',
    shortTitle: 'Genesis Progression',
    description:
      'The simulation from first mission to the Master Controller: five biomes, HLN-A, Hexagons, the remade ocean, and the order that makes the tests passable.',
    lastVerified: '2026-08-18',
    related: ['extinction-progression', 'boss-strategies', 'taming'],
    sections: [
      {
        heading: 'What Genesis asks of you',
        blocks: [
          {
            type: 'p',
            text: 'Genesis is not a place. It is a simulation — a training program run by a small holographic companion named HLN-A, who greets you on arrival and never really leaves. The world it simulates is five hostile biomes, and the rules you have relied on since the first beach start bending immediately: progression here is not a march across a landscape but a curriculum, delivered as missions, graded in difficulty tiers, and paid out in a currency the simulation invents for the purpose. The maps before this one tested how you survive. Genesis tests how you perform.',
          },
          {
            type: 'p',
            text: 'Arrival is unusually generous: you choose your starting biome and even the compass direction you enter it from, and you can make that choice badly with very little penalty — the simulation is built for re-entry. What it is not built for is wandering. Every biome wants you dead in its own way, and the connective tissue between them is not a gentle overland route but open water and teleportation. Pick one biome, learn it the way you once learned a starter beach, and let the mission list — not curiosity — decide when you leave.',
          },
          {
            type: 'callout',
            text: 'One boundary to know before anything else: this guide covers the free Genesis map that every ASA owner has. The paid Tides of Fortune expansion that launched beside it — pirate ships, its own campaign and creatures — is separate content and none of it is required for anything below.',
          },
        ],
      },
      {
        heading: 'Missions, Hexagons, and the simulation\'s economy',
        blocks: [
          {
            type: 'p',
            text: 'HLN-A offers missions across every biome — hunts, escorts, races, waves of enemies, and stranger tests — each at selectable difficulty tiers you can attempt at your own pace. Completing them pays Hexagons, the simulation\'s currency, which you spend on resources, technology, and gear from HLN-A\'s shop. This inverts the usual ARK economy: on every earlier map, materials came from the world and progress came from materials. Here, performance is a resource in itself, and a survivor good at missions can buy their way past bottlenecks that took weeks of gathering elsewhere.',
          },
          {
            type: 'p',
            text: 'The open world participates too. Glitches — small shimmering anomalies scattered through the biomes — replace the explorer notes of older maps, and fixing them pays Hexagons and pieces of the story. Between missions and glitches, the map is constantly offering you a next objective, which is exactly the habit it wants to build: the final door in Genesis is opened by mission completions, so the curriculum is not optional. Treat the mission list the way earlier guides treated the tech tree.',
          },
          {
            type: 'callout',
            text: 'Spend Hexagons on bottlenecks, not groceries. Anything you can gather in ten safe minutes is a waste of the currency; the shop earns its keep on the things your current biome refuses to give you.',
          },
        ],
      },
      {
        heading: 'Pick one biome and learn it',
        blocks: [
          {
            type: 'p',
            text: 'The classic first pick is the Bog — a fetid, green, dangerous swamp that is nonetheless the most conventionally ARK-like of the five, with familiar taming targets, dense resources, and hazards that punish carelessness rather than existence. The Arctic and the Ocean\'s calmer margins are workable starts for survivors who know what they are signing up for. The Volcanic biome and the Lunar surface are not starts at all; they are destinations, and the simulation will make that clear quickly if you test it.',
          },
          {
            type: 'p',
            text: 'Whichever you choose, the opening plays like a compressed first week anywhere: shelter, a bed, basic tools, and a small bench of working tames before anything ambitious. The difference is what the base is for. On Genesis a home biome is a mission hub — you will leave from it, fail missions, and return to re-equip far more often than you will defend it from sieges. Build for quick turnaround: storage you can restock from in one pass beats walls you never needed.',
          },
        ],
      },
      {
        heading: 'The five biomes, briefly',
        blocks: [
          {
            type: 'p',
            text: 'The Bog is the green tutorial: swamp predators, thick resources, and constant low-grade danger. The Arctic is the cold test — altitude, predators, and weather that kills the underdressed, familiar in kind from other maps but sharpened here. The Ocean is the map\'s showpiece in this version: rebuilt as a true open sea with rolling waves, working buoyancy, scattered islands, and ships you can actually build and sail, it has gone from the gap between biomes to a place with its own economy, wildlife, and dangers in the water column below.',
          },
          {
            type: 'p',
            text: 'The Volcanic biome is the forge: lava fields, brutal heat, the map\'s richest veins of high-end minerals, and the creatures that guard them. The Lunar biome is the strangest ground in the game — low gravity, vacuum pockets, meteor strikes, and technology-tier threats — and it is best understood as endgame terrain that happens to be standing next to the rest of the map. Each biome keeps its own hazards, its own signature creatures, and its own reason to visit; the progression is learning them in the order their difficulty suggests.',
          },
        ],
      },
      {
        heading: 'Getting around: HLN-A and the open sea',
        blocks: [
          {
            type: 'p',
            text: 'Travel between biomes runs through HLN-A\'s teleportation, and one habit will save you real grief: teleport with HLN-A rather than relying on beds, because bed travel drops what you are carrying while HLN-A moves you intact — tames nearby can come along too. Treat teleportation the way earlier maps treated obelisk runs: a deliberate act with a packing list, not a casual hop. Arriving in a new biome with the wrong gear is the classic Genesis death.',
          },
          {
            type: 'p',
            text: 'The remade ocean adds a second option this map never used to have: sailing. With the zones joined by open water, a seaworthy vessel turns the sea into a road — slower than teleporting, but it moves cargo, lets you fish the water column and its islands on the way, and makes the Ocean biome a journey rather than a menu entry. Most survivors will use both: HLN-A for speed, the sea for freight and for the pleasure of it.',
          },
        ],
      },
      {
        heading: 'The simulation\'s signature tames',
        blocks: [
          {
            type: 'p',
            text: 'Genesis stocks creatures built for its own strange geography. The Bloodstalker is the movement answer — a web-slinging spider mount that turns the Bog\'s canopy into a highway. The Ferox is a pocket-sized companion with a monstrous transformation and a costly appetite for the element that triggers it. The Magmasaur is the Volcanic biome\'s prize, a walking furnace that smelts as it fights. The Megachelon is a turtle so large it doubles as a mobile base, and the deep water hides the Astrocetus, the space whale, and the Palaeoctopus, new to this version of the map.',
          },
          {
            type: 'p',
            text: 'Around the exotics, the biomes also run their own hardened variants of familiar creatures — visually distinct, meaner, and notably harder to bring down than their ordinary cousins, so pad your estimates and your narcotic supply accordingly. The fundamentals have not moved: torpor, the right food, and a controlled situation still tame everything tameable, and the taming guide applies here unchanged.',
          },
          {
            type: 'links',
            items: [
              { href: '/guides/taming', label: 'Taming Guide', note: 'knockout and passive methods, torpor, and traps' },
              { href: '/maps/genesis', label: 'Live Genesis servers', note: 'population, uptime, and versions right now' },
            ],
          },
        ],
      },
      {
        heading: 'Climbing the mission ladder',
        blocks: [
          {
            type: 'p',
            text: 'Missions are the map\'s actual progression axis, and they scale from genuinely gentle to genuinely cruel. Start at the lowest tiers in your home biome — early wins pay Hexagons, teach the mission grammar, and cost almost nothing to fail. Move up a tier when the current one stops feeling dangerous, and spread sideways into other biomes\' missions as your travel kit matures. The simulation counts your completions, and that count is the key that unlocks the way forward.',
          },
          {
            type: 'p',
            text: 'The ladder has a mid-boss: Moeder, the master of the deep, reached through an ocean mission and fought in open water. She is the map\'s rehearsal dinner — the first time Genesis asks you to bring real preparation to a single fight rather than a mission\'s worth of stamina — and clearing her is both a story beat and an honest signal about whether your bench is ready for what the simulation is building toward.',
          },
        ],
      },
      {
        heading: 'The Master Controller, and where the story goes next',
        blocks: [
          {
            type: 'p',
            text: 'The simulation ends with its administrator. The Master Controller — corrupted, hostile, and fought in an arena that plays by mission rules rather than open-world ones — is gated behind mission completions across the biomes: the curriculum was the key all along. The fight leans on everything the map graded you on — performance under time pressure, a deep bench of tames, and gear bought with the currency of your own competence — and it caps the strangest and most structured progression in the game.',
          },
          {
            type: 'p',
            text: 'Beating the Controller closes this chapter of the story, but the story itself is visibly unfinished — Genesis was built as a two-part tale, and its second half has not yet arrived in ASA. When it does, the preparation starts over, as it always has. Until then, this is where the progression chain rests: five maps, five grammars, and a survivor who has learned all of them.',
          },
          {
            type: 'callout',
            text: 'The arena law holds even inside a simulation: the Master Controller is won in the weeks of missions before the fight, not the minutes inside it. The Boss Strategies guide covers the shape of that preparation.',
          },
        ],
      },
    ],
  },
  {
    slug: 'the-island-resources',
    title: 'The Island Resources Guide — ARK: Survival Ascended',
    shortTitle: 'The Island Resources',
    description:
      'Terrain-first farming on The Island: beaches, jungle, swamp, snow, mountains, caves, and ocean — how the land pays, and how to haul it home.',
    lastVerified: '2026-08-23',
    related: ['resource-locations', 'scorched-earth-resources', 'aberration-resources', 'the-center-resources'],
    sections: [
      {
        heading: 'What this map is like',
        blocks: [
          {
            type: 'p',
            text: 'The Island is the curriculum every later map assumes you already passed. It is one landmass ringed by ocean, with a coastline that teaches the game and an interior that spends what the coast taught. Beaches give way to jungle, jungle to swamp and highland, highland to snow and exposed rock. Caves punch down through all of it. The ocean is not a border so much as a second map glued to the first.',
          },
          {
            type: 'p',
            text: 'The layout is radial in spirit: the farther you walk from gentle water, the more the terrain asks of you. Warm sand and shallow surf are the tutorial. Green canopy is the workshop. Wet lowland is the first place that will eat an unprepared gatherer. High stone and ice are the economy. Dark water is the patience test. A survivor who learns that gradient — sand to soil to stone to ice, then cave and ocean — can farm this island without ever looking at a pin.',
          },
          {
            type: 'callout',
            text: 'Treat The Island as a terrain school, not a treasure map. The later maps only change the costume.',
          },
        ],
      },
      {
        heading: 'Where the biomes put resources',
        blocks: [
          {
            type: 'p',
            text: 'Wood and thatch live wherever trees live, which on this map is most of the warm interior. Dense jungle pays better than coastal scrub; swamp timber is thick but wet and contested. Fiber and berries come from bushes in those same green places. The whole starter kit — wood, thatch, fiber, stone, food — is a beach-and-jungle story. It never really stops being available. It only gets heavier once you mix it with ore.',
          },
          {
            type: 'p',
            text: 'Stone is the island\'s default mineral: beaches, riverbeds, any slope that has shrugged its soil. Metal is pickier. It shows up on exposed rock — mountain faces, cliff shoulders, cave interiors — not in dirt, not in sand, and not in the first meadow you like. If the ground still has a forest floor, keep walking until the rock shows through. Crystal prefers the high and the cold: snowy ridges, icy cave walls, places where the air already hurts. Obsidian wants volcanic and geothermal ground, or the deepest cave rock that looks poured rather than stacked.',
          },
          {
            type: 'p',
            text: 'Oil is a water story and a cold story. Seafloor nodes sit where the ocean floor goes dark. Surface oil belongs to the frozen fringe. Silica pearls hide in that same unfriendly water, usually deeper and quieter than a casual swim. Cementing paste is not a node; it is insects and chitin, which makes the swamp and insect-heavy caves your quarry. Shallow reefs are not the drop-off. If you cannot see the bottom, you are in the harvest zone and the danger zone together.',
          },
          {
            type: 'list',
            items: [
              'Green and wet: wood, thatch, fiber, chitin, the starter loop.',
              'Bare rock and cave wall: metal first, then whatever else the stone is hiding.',
              'Snow, ice, and thin air: crystal, and the oil that refuses to live in a jungle.',
              'Dark water: oil, pearls, and a return trip you should plan before you dive.',
            ],
          },
        ],
      },
      {
        heading: 'Tools and what they favor',
        blocks: [
          {
            type: 'p',
            text: 'A stone pick and a stone hatchet teach the split that never goes away. The pick favors ore, flint, thatch, and the mineral side of a node. The hatchet favors wood, hide, and the organic side of the same swing. Upgrade both to metal when the island starts paying metal. They are not interchangeable, and carrying both is cheaper than two trips for the wrong mix. A sickle turns fiber from a chore into a stack; it will not replace the hatchet or mine a rock. Hands still gather pearls and loose ground stone.',
          },
          {
            type: 'p',
            text: 'Tames bias the same nodes harder in the same directions. A dedicated mineral gatherer on a mountain face will fill a saddle with metal that would have broken your spine. A wood specialist in jungle or swamp will empty a grove while you watch the tree line. An insect hunter in the swamp turns paste from a bottleneck into a routine. A strong swimmer with weight to spare turns the ocean from a dare into a commute. None of this changes where the nodes live. It only changes how many trips the same hillside costs.',
          },
        ],
      },
      {
        heading: 'Hauling and logistics',
        blocks: [
          {
            type: 'p',
            text: 'The Island\'s weight problem is vertical. The richest mineral sits up, and home is usually down, near water and wood. Raw metal is heavier than you expect. Crystal is awkward. Oil and pearls are a swim with a backpack that wants to drown you. Load the tame, not the survivor. Put a bed near the deposit so death is a commute. Smelt or store on the mountain when you can — walk bars, not rocks.',
          },
          {
            type: 'p',
            text: 'Water is the island\'s road. Rivers and shoreline skip jungle sightlines and also advertise you. Overland through trees is worse for a loaded mount that cannot turn. Pick the route for the cargo, not the scenery. Two light trips beat one overloaded crawl. When a haul fails it is almost always on the way home: you are slow, the path is familiar, and whatever lives on that slope has had time to wander back. The harvest is finished when the box at home closes.',
          },
        ],
      },
      {
        heading: 'Hazards while farming',
        blocks: [
          {
            type: 'p',
            text: 'The beach is honest. The jungle is not. Predators use trees as cover, and a farming swing is a loud invitation. Swamp water hides things that consider you food. Snow drains stamina and health while you chip crystal. Caves combine darkness, tight rooms, and residents that do not want company. The ocean adds drowning to teeth. These are the rent each biome charges for its nodes.',
          },
          {
            type: 'p',
            text: 'Falling is an Island specialty. Mountain faces and cave drops punish a survivor who looks at the node instead of the footing. If the harvest made you too heavy to jump, you are already late to leave. Clear a pocket before you swing. Park the hauler where a slip does not take it over the edge. Night and weather are quieter killers — cold on a ridge, rain in a swamp, a storm at sea. Dress for the biome you are farming, not the one you spawned in.',
          },
        ],
      },
      {
        heading: 'First-week priorities',
        blocks: [
          {
            type: 'p',
            text: 'Week one on this map is not a metal rush. Secure a beach or river camp with a bed, a box, and a fire. Learn the pick-and-hatchet split on local stone and trees until the muscle memory is boring. Get a modest weight-carrying herbivore so the second day\'s wood and stone stop living in your own inventory. That tame is the difference between a base that grows and a survivor who spends every evening over-encumbered on the sand.',
          },
          {
            type: 'p',
            text: 'Then read the nearest rock. If the slope shows metal, treat that hillside as your first real economy and put a sleeping bag in walking distance of it. Do not graduate to snow or caves until you can leave a body behind and still have a kit at home. Oil and pearls wait until you have a swimmer you trust. Paste waits until the swamp is a job, not a dare. Crystal waits until you own clothes that answer the cold. The Island hub page tells you how crowded that lesson is right now. The Resource Locations guide is the grammar this page applies.',
          },
          {
            type: 'links',
            items: [
              { href: '/guides/resource-locations', label: 'Resource Locations', note: 'the terrain grammar this map-specific page applies' },
              { href: '/maps/the-island', label: 'Live The Island servers', note: 'population, uptime, and versions right now' },
            ],
          },
        ],
      },
    ],
  },
  {
    slug: 'scorched-earth-resources',
    title: 'Scorched Earth Resources Guide — ARK: Survival Ascended',
    shortTitle: 'Scorched Earth Resources',
    description:
      'Terrain-first farming on Scorched Earth: dunes, rock, salt, sulfur, and scarce water — what the desert pays, and what it costs to carry.',
    lastVerified: '2026-08-23',
    related: ['resource-locations', 'scorched-earth-progression', 'the-island-resources', 'ragnarok-resources'],
    sections: [
      {
        heading: 'What this map is like',
        blocks: [
          {
            type: 'p',
            text: 'Scorched Earth is a desert with opinions. There is no gentle ring of beach to learn on, no continuous forest to hide a mistake in, and no freshwater ribbon you can follow home by ear. The landmass is open, bright, and dry. Dunes roll into badland cuts. Badland cuts rise into bare mountains. The rare green is a wet exception, not a climate. Shade is a resource. Water is a resource. Time in the sun is a cost you pay whether you meant to or not.',
          },
          {
            type: 'p',
            text: 'The map still has a gradient, just not the Island\'s. Outer flats and dune seas are the easy read: long sightlines, thin cover, nodes that do not require a climb you cannot reverse. Interior stone — canyons, cliffs, the rock that looks cooked — is where the desert keeps the materials that gate mid-game. You earn your way inward the same way you earn your way up on other maps: by arriving able to leave. Every trip is hydration, heat, and visibility stacked on a gathering problem.',
          },
          {
            type: 'callout',
            text: 'If a node sits in open sand, the sand is part of the price. If it sits in a cut of rock, the climb and the heat are part of the price. Pay both on purpose.',
          },
        ],
      },
      {
        heading: 'Where the biomes put resources',
        blocks: [
          {
            type: 'p',
            text: 'Wood is the desert\'s first argument with Island habits. Trees exist, but they cluster near water, in canyon bottoms, and anywhere the ground remembers being wet. Fiber is thinner on open dune and thicker in scrub and oasis-green. Cactus is the local substitute garden: sap for thirst, and a reminder that the flora here is armed. Do not punch the desert the way you punched a beach bush.',
          },
          {
            type: 'p',
            text: 'Stone is everywhere the wind has failed to bury it — rocky shelves, canyon walls, mountain bone. Metal follows the same rule it does on every map: exposed rock, not sand. Look at faces that have shrugged their dunes, the spines of ridgelines, caves that open from stone. Crystal likes high, hostile rock and the colder hours those heights invent at night. Sulfur favors scorched, chemically angry ground — fumaroles, cooked canyon stone, places that smell like a mistake. Salt favors flats and evaporite crust, the pale ground that looks like the ocean left and forgot its cargo.',
          },
          {
            type: 'p',
            text: 'Oil still lives in two tempers: desert seeps and pump-friendly stains on hardpan, and the rare deep water you should not assume is a lake you can live beside. Silk is an animal product here, not a tree product. Clay and sand sit underfoot on the flats, and they matter because adobe is how a base stops fighting the weather. Chitin and keratin still come from shells and horns, which in a desert often means the dunes are hunting you back.',
          },
          {
            type: 'list',
            items: [
              'Sand and scrub: starter stone, thin wood, cactus, the clay that becomes a house.',
              'Bare ridgeline and cave rock: metal, and the crystal that hid from the heat below.',
              'Cooked stone and pale crust: sulfur and salt, the desert\'s own crafting language.',
              'Rare water: oil if you must swim, and the trees the rest of the map refused to grow.',
            ],
          },
        ],
      },
      {
        heading: 'Tools and what they favor',
        blocks: [
          {
            type: 'p',
            text: 'The pick-and-hatchet split does not change because the sky is empty of trees. A pick still favors the mineral side of rock and the thatch side of the few trunks you find. A hatchet still favors wood and hide. Metal tools matter more here than on a jungle map because every wasted swing is also wasted water. A sickle still wins at fiber, and it is kinder to cactus than bare hands. Jars and canteens are harvest tools in this climate; a trip that forgets them is not a gathering trip.',
          },
          {
            type: 'p',
            text: 'Desert tames bias the same way Island tames do, with extra homework. A mineral gatherer on exposed rock is still the metal answer. A weight-focused herbivore that also banks water turns the logistics layer kinder. A fast mount matters more than a brutal one for most early loops, because the correct response to half the dune\'s interruptions is to leave. Silk and chitin want the creatures that produce them, not a better pick. Bring the tool that matches the node, then the animal that matches the tool.',
          },
        ],
      },
      {
        heading: 'Hauling and logistics',
        blocks: [
          {
            type: 'p',
            text: 'The desert\'s weight problem is distance plus thirst. Nodes are often a long, shadeless walk from anything you would call home, and the cargo that matters — metal, crystal, sulfur — is as heavy as it is anywhere. Load the tame, not the survivor. The extra trick is that the tame and the survivor both drink. A hauler that arrives at the node already dry is a statue you will die next to.',
          },
          {
            type: 'p',
            text: 'Open sand is a terrible road when you are slow. Deep dune hides things that erupt under weight, and a loaded line across empty flats is a confession. Prefer rock and hardpan for the return. Prefer two short loops from a forward bag and a box over one heroic crossing. Green folds of land are filling stations, not automatic homes — everyone else can see them too. Smelt near the deposit when the heat makes a raw-ore walk foolish. Plan the return as if the sky will close. A sandstorm will ground the sensible flyers and strand the stubborn.',
          },
        ],
      },
      {
        heading: 'Hazards while farming',
        blocks: [
          {
            type: 'p',
            text: 'Heat is the standing tax. Daylight on open ground will cook an underdressed gatherer through a full bag of good decisions. Night swings cold enough to bite, especially on height. Dress for the hour, not the screenshot. Sandstorms erase sightlines, sap stamina, and turn every loaded retreat into guesswork. When the horizon goes brown, you stop being a farmer and start being someone who needs a wall. Hunker. Do not press.',
          },
          {
            type: 'p',
            text: 'The dune itself hunts. Burrowing things treat heavy footsteps as a dinner bell, which makes an overloaded mineral run across deep sand a special kind of optimism. Vultures turn a pause at a carcass into a mob. Canyons add falling to heat. Caves add closed rooms and residents that were waiting in the shade you wanted. Water sources are not automatically safe camps — anything that must drink will eventually visit them. Farm the rock. Visit the water. Do not confuse the two.',
          },
        ],
      },
      {
        heading: 'First-week priorities',
        blocks: [
          {
            type: 'p',
            text: 'Week one on Scorched Earth is water, then shade, then stone. Plant a bed within reach of a drink you can defend or replace, even if the view is ugly. Learn cactus and jars before you learn a mountain. Put down enough adobe or shade to make noon survivable indoors. A camp that cannot outlast a heat wave is a respawn timer with extra steps.',
          },
          {
            type: 'p',
            text: 'Once you can stay wet and stay indoors, read the nearest exposed rock for metal and start the loop you already know: bag at the deposit, tame that carries, short trips, smelt before you stroll. Salt and sulfur join the list as soon as your bench starts asking for the desert\'s own language; they are not first-day emergencies. Silk and deep-dune trophies wait until you can cross sand without looking like bait. The hub page tells you how populated that desert is today. The progression guide is the survival order; this page is the shopping list. The Resource Locations guide remains the grammar.',
          },
          {
            type: 'links',
            items: [
              { href: '/guides/resource-locations', label: 'Resource Locations', note: 'the terrain grammar this desert applies' },
              { href: '/maps/scorched-earth', label: 'Live Scorched Earth servers', note: 'population, uptime, and versions right now' },
              { href: '/guides/scorched-earth-progression', label: 'Scorched Earth Progression', note: 'water, heat, and the order that makes the map beatable' },
            ],
          },
        ],
      },
    ],
  },
  {
    slug: 'aberration-resources',
    title: 'Aberration Resources Guide — ARK: Survival Ascended',
    shortTitle: 'Aberration Resources',
    description:
      'Terrain-first farming on Aberration: fungal caverns, charged rock, radiation, and the surface — what the dark pays, and how to move it without wings.',
    lastVerified: '2026-08-23',
    related: ['resource-locations', 'aberration-progression', 'the-island-resources', 'extinction-resources'],
    sections: [
      {
        heading: 'What this map is like',
        blocks: [
          {
            type: 'p',
            text: 'Aberration is a cave that ate a world. The surface burned, the station failed, and what survived did so underground, which means the usual compass habits arrive already wrong. There is no beach ring. There is no flyer commute. Progress is vertical: fertile fungal floors near the light you can live in, then down through charged blue stone, then into rock that will poison an unsuited body, with a lethal surface waiting above for anyone who climbs the wrong way at the wrong hour.',
          },
          {
            type: 'p',
            text: 'The map reads as layers more than regions. A farming trip is less "head inland" and more "change floors." Gravity is a participant. A node you can see across a chasm may be a short cling for the right creature, or a death for a survivor who only knows how to walk. Mushrooms replace trees as the thing you keep bumping into. Charge light replaces daylight as the thing that decides whether the dark is empty or occupied. Farming here is a lighting problem and a falling problem stacked on a gathering problem.',
          },
          {
            type: 'callout',
            text: 'If you cannot see a safe way back up, you are not looking at a harvest. You are looking at a hole.',
          },
        ],
      },
      {
        heading: 'Where the biomes put resources',
        blocks: [
          {
            type: 'p',
            text: 'The fertile fungal floors are the green workshop. Wood as you knew it is scarce; mushroom trunks and the strange local flora carry the early building kit instead. Fiber still comes from harvestable plants, thicker in the undergrowth than on bare stone. Stone is everywhere the fungus has failed to carpet. Metal still wants exposed rock — cliff faces inside the caverns, broken shelves, station bone showing through — not the soft mushroom dirt you first want to live on. If it looks like soil, keep walking until it looks like a wall.',
          },
          {
            type: 'p',
            text: 'The charged blue layer is where the map starts paying like an endgame. Crystal and gem-bearing growths favor this glowing stone; they sit on walls and ceilings as much as the floor, which is a hint about your footing. The rarer ores concentrate as the rock gets less friendly and more irradiated. The red, poisoned stone is honest: if the air is a hazard, the harvest is not a starter loop. The surface, when you can stand it, is a scorched lid with its own nodes and its own reasons not to linger. Treat it as a raid, not a commute.',
          },
          {
            type: 'p',
            text: 'Organic gathering changes costume. Chitin still comes from the things with plates. Local insects and crawlers are the paste and polymer conversation. Aquatic pockets exist, but they are lakes in a cave, not an ocean biome — do not dive as if The Island\'s pearl rules apply. Charge is a resource in its own right. The light-producing flora and the creatures that store it are how you keep the dark from filling with things that hate a lantern. Farm charge on purpose the way you would farm narcotics anywhere else.',
          },
          {
            type: 'list',
            items: [
              'Fertile fungal floor: the building kit, early stone, the first honest metal on cavern rock.',
              'Charged blue stone: crystal, gems, the harvest that assumes you can climb and see.',
              'Irradiated rock and the surface: the late minerals, and a suit that is not optional.',
              'Flora and fauna that glow: charge, the resource that makes every other trip possible.',
            ],
          },
        ],
      },
      {
        heading: 'Tools and what they favor',
        blocks: [
          {
            type: 'p',
            text: 'Picks and hatchets still split a node the same way. A pick favors ore, crystal, thatch-like return from the local trunks, and the mineral face of gemmed walls. A hatchet favors the woody and hide-like returns. Metal tools matter sooner than your pride wants, because a long climb to a bad yield is a longer climb home. A sickle still wins at plant fiber. Climbing picks are movement tools, not harvest tools; they get you to the wall the real pick then works.',
          },
          {
            type: 'p',
            text: 'A charge lantern is also not a harvest tool, but farming without one in the deeper layers is a decision to share the node with things that prefer you blind. Powered industrial tools pull more from the same rock and weigh more on the way to it — bring them when the floor is safe enough to justify the encumbrance. The tame bench is inverted by the flyer ban. A mineral gatherer that can also walk a cliff is worth more than a stronger gatherer that cannot come home. Pack-capable mounts turn a vertical map into something you can actually logistics. Glow pets keep charge on your shoulder while both hands work.',
          },
        ],
      },
      {
        heading: 'Hauling and logistics',
        blocks: [
          {
            type: 'p',
            text: 'Aberration\'s weight problem is gravity. The good rock is often below you, or on a ledge you will not want to recross loaded. A fall with metal is how kits disappear into a layer you are not dressed for. Load the tame, keep yourself light, store near the node — and never take a downhill harvest you have not already climbed with empty bags. If the way up is a puzzle, solve it before you are heavy.',
          },
          {
            type: 'p',
            text: 'Zip lines, climbs, and glides are the roads. Walking the long way around a chasm is safer than inventing a shortcut with a full saddle. Park haulers on flats, not on the lip of a drop. Put a bed on the fertile side of any descent that would take a naked respawn through radiation or nameless dark. A forward box on the correct floor is worth more than a bigger base on the wrong one. Two light trips are how you stay on the floor you meant to stay on. Bring more charge than the room looks like it needs.',
          },
        ],
      },
      {
        heading: 'Hazards while farming',
        blocks: [
          {
            type: 'p',
            text: 'The dark is staffed. Nameless and their worse relations treat an unlit gatherer as an opportunity, which makes charge management part of every swing in the deeper layers. Ceiling hunters drop into a node the moment you look at the rock instead of the roof. Fertile floors have their own predators; they are simply ones you can see coming if you chose a sightline.',
          },
          {
            type: 'p',
            text: 'Radiation does not negotiate. Irradiated rock will empty a health bar through clothes that were fine on a mountain. If you are not suited, you are not farming that floor. The surface adds heat, radiation, and things that fly in a map that otherwise forbade you that privilege; it is hostile on a timer. Falling remains the quiet killer. Encumbered jumps, wet fungus, and ledges that look wider than they are will put you on a floor whose air you cannot breathe. A perfect vein on a bad ledge is not a perfect vein.',
          },
        ],
      },
      {
        heading: 'First-week priorities',
        blocks: [
          {
            type: 'p',
            text: 'Week one on Aberration is light, a bed on fertile ground, and a way to move that is not a hopeful jump. Secure charge — a glow pet, a lantern, the habit of watching the meter — before you secure a pretty mineral wall across a drop. Learn the local trunks and the cavern stone with the pick-and-hatchet split you already own. Get a pack animal that can handle slopes so wood and stone stop living on your corpse.',
          },
          {
            type: 'p',
            text: 'Read the nearest cavern wall for metal only after you can die and respawn without a tour of the dark. Blue-layer crystal and gems wait until you can climb back out with a bag. Irradiated rock and the surface wait until you own a suit and a reason. Paste and charge stay on the weekly list the entire time; this map spends both. Do not skip the fertile floor because it looks like a tutorial. It is the only floor that will forgive you. The hub page tells you how crowded those caverns are right now. The progression guide is the order of survival; this page is where the rock pays. The Resource Locations guide is still the grammar.',
          },
          {
            type: 'links',
            items: [
              { href: '/guides/resource-locations', label: 'Resource Locations', note: 'the terrain grammar this cavern applies' },
              { href: '/maps/aberration', label: 'Live Aberration servers', note: 'population, uptime, and versions right now' },
              { href: '/guides/aberration-progression', label: 'Aberration Progression', note: 'charge, verticality, and the order that makes the map survivable' },
            ],
          },
        ],
      },
    ],
  },
  {
    slug: 'the-center-resources',
    title: 'The Center Resources Guide — ARK: Survival Ascended',
    shortTitle: 'The Center Resources',
    description:
      'Terrain-first farming on The Center: floating islands, underworld, lava, redwoods, and ocean — familiar land, rearranged.',
    lastVerified: '2026-08-24',
    related: ['resource-locations', 'the-island-resources', 'ragnarok-resources'],
    sections: [
      {
        heading: 'What this map is like',
        blocks: [
          {
            type: 'p',
            text: 'The Center is The Island taken apart and hung back up in a different order. The biomes will feel like homework you already finished: beach, jungle, redwood, snow, ocean, a place that burns. What changes is the architecture. Land floats. A cavern swallows the middle of the world. Lava keeps its own island. A survivor who only knows how to walk inland will keep arriving at a cliff, a drop, or open air where The Island would have offered another hill.',
          },
          {
            type: 'p',
            text: 'Read it as a remix, not a sequel. The coastline still teaches. The jungle still workshops. The redwoods still make timber and trouble. Snow and bare rock still hold the mineral economy. Then the map adds its two arguments: the floating islands, where the same high-rock rules apply with no walk-off, and the underworld cavern, a second climate stacked under the first. The ocean is as large as it looks. Familiar rules. Unfamiliar commute.',
          },
          {
            type: 'callout',
            text: 'If the terrain looks like The Island, ask how you would leave. The answer is usually not a walk.',
          },
        ],
      },
      {
        heading: 'Where the biomes put resources',
        blocks: [
          {
            type: 'p',
            text: 'Wood and thatch still live where trees live, and The Center has no shortage of trees — they just do not sit on one inland. Jungle pays on the main islands the way it did on The Island. Redwoods pay heavier timber and a meaner floor. Fiber and berries follow the same green. The starter kit is still a beach-and-jungle story. The beach may be on a different island than the grove you meant to finish in.',
          },
          {
            type: 'p',
            text: 'Stone is the default mineral wherever soil has failed: beaches, river cuts, any slope that shows its bone. Metal still wants exposed rock — mountain faces, cliff shoulders, floating shelves, cave wall, the stone that lines the underworld. If you are standing on dirt, keep walking until you are standing on a wall. Crystal prefers height and cold: snowy ridges, thin air above the treeline, floating shelves that already feel like a peak. Obsidian wants the lava island and the rock that looks poured. The volcano\'s western approach is rock before it is fire.',
          },
          {
            type: 'p',
            text: 'Oil is still a water story and a cold story: dark seafloor, the frozen fringe. Silica pearls hide in that same unfriendly water. The underworld is not an ocean and does not obey ocean rules — it is a climate with its own walls, its own heat, and its own reasons to pack a way out before you pack a pick. Cementing paste is still insects and chitin. Plan the dive and the drop as two different jobs.',
          },
          {
            type: 'list',
            items: [
              'Green islands and redwood floor: wood, thatch, fiber, the starter loop.',
              'Bare rock, floating shelves, cave wall: metal first, then whatever else the stone is hiding.',
              'Snow, thin air, and the lava approach: crystal and obsidian, paid in climate.',
              'Dark water and the underworld: oil, pearls, and a return you plan before you leave.',
            ],
          },
        ],
      },
      {
        heading: 'Tools and what they favor',
        blocks: [
          {
            type: 'p',
            text: 'The pick-and-hatchet split did not move because the land did. A pick still favors ore, flint, thatch, and the mineral side of a node. A hatchet still favors wood, hide, and the organic side of the same swing. Upgrade both to metal when the map starts paying metal. They are not interchangeable. A sickle still wins at fiber. Hands still gather pearls and loose ground stone. A flyer is a road, not a pick; it gets you to the shelf the real tool then works.',
          },
          {
            type: 'p',
            text: 'Tames bias the same nodes in the same directions, with extra homework about gaps. A dedicated mineral gatherer on exposed rock will still fill a saddle. A wood specialist in jungle or redwood will still empty a grove. A strong swimmer with weight to spare still turns the ocean into a commute. The new requirement is a way across air and a way back out of the cavern. None of this changes where the nodes live. It only changes whether the same hillside is a loop or a stranding.',
          },
        ],
      },
      {
        heading: 'Hauling and logistics',
        blocks: [
          {
            type: 'p',
            text: 'The Center\'s weight problem is gaps. The richest mineral sits up, or down, or on a floating shelf with no walk-off, and home is usually a beach you can no longer see. Load the tame, not the survivor. Put a bed near the deposit so death is a commute. Smelt or store on the rock when you can — walk bars, not rocks. A full bag on a floating island is a hostage situation until something that flies arrives.',
          },
          {
            type: 'p',
            text: 'Water is still a road, and so is air. Shoreline skips jungle sightlines; it also advertises you. Overland through trees is worse for a loaded mount that cannot turn, and useless when the next grove is across a drop. Pick the route for the cargo, not the scenery. Two light trips beat one overloaded crawl, especially when the crawl has a cliff in it. The underworld is a one-way harvest if you get heavy before you have mapped the climb. The harvest is finished when the box at home closes.',
          },
        ],
      },
      {
        heading: 'Hazards while farming',
        blocks: [
          {
            type: 'p',
            text: 'The beach is still honest. The jungle is still not. Redwoods add height to the ambush: things drop from timber you were looking at as lumber. Snow drains stamina while you chip crystal. The lava island adds fire to falling. The ocean adds drowning to teeth. The underworld adds heat, dark, and a climb you will not want to invent loaded. These are the rent each biome charges for its nodes.',
          },
          {
            type: 'p',
            text: 'Falling is this map\'s specialty, practiced in more directions than The Island offered. Floating shelves and cavern drops punish a survivor who looks at the node instead of the footing. If the harvest made you too heavy to jump, you are already late to leave. Clear a pocket before you swing. Park the hauler where a slip does not take it into sky or lava. Night and weather are quieter killers — cold on a ridge, rain in a jungle, a storm at sea. Dress for the biome you are farming, not the one you spawned in.',
          },
        ],
      },
      {
        heading: 'First-week priorities',
        blocks: [
          {
            type: 'p',
            text: 'Week one on this map is still not a metal rush. Secure a beach or river camp with a bed, a box, and a fire. Learn the pick-and-hatchet split on local stone and trees until the muscle memory is boring. Get a modest weight-carrying herbivore so the second day\'s wood and stone stop living in your own inventory. That tame is the difference between a base that grows and a survivor who spends every evening over-encumbered on the sand.',
          },
          {
            type: 'p',
            text: 'Then read the nearest rock. If the slope shows metal, treat that hillside as your first real economy and put a sleeping bag in walking distance of it. Do not graduate to snow, floating shelves, the underworld, or the lava island until you can leave a body behind and still have a kit at home. Oil and pearls wait until you have a swimmer you trust. Crystal waits until you own clothes that answer the cold. The hub page tells you how crowded that remix is right now. The Resource Locations guide is the grammar this page applies.',
          },
          {
            type: 'links',
            items: [
              { href: '/guides/resource-locations', label: 'Resource Locations', note: 'the terrain grammar this remixed island applies' },
              { href: '/maps/the-center', label: 'Live The Center servers', note: 'population, uptime, and versions right now' },
            ],
          },
        ],
      },
    ],
  },
  {
    slug: 'ragnarok-resources',
    title: 'Ragnarok Resources Guide — ARK: Survival Ascended',
    shortTitle: 'Ragnarok Resources',
    description:
      'Terrain-first farming on Ragnarok: highlands, desert, canyons, jungle, and a large ocean — scale and travel cost are the tax.',
    lastVerified: '2026-08-24',
    related: ['resource-locations', 'scorched-earth-resources', 'the-center-resources'],
    sections: [
      {
        heading: 'What this map is like',
        blocks: [
          {
            type: 'p',
            text: 'Ragnarok is not a bigger Island. It is a continent that happens to share a server, and the share is the problem. Highlands roll into desert. Desert cuts into canyon. Green Scottish hills sit beside jungle that sits beside a real ocean. Each of those climates already taught you how it pays; this map\'s lesson is how far apart it put them. A full bag on the wrong side of the landmass is not wealth. It is a walk you will not finish.',
          },
          {
            type: 'p',
            text: 'The gradient is not inland. It is across. A gentle highland pasture can be a short ride from a desert that will cook you, and that desert can be a short ride from a jungle that will eat you. You earn your way into each climate the way you earned height on The Island: by arriving able to leave. The difference is that leave may mean a different biome, not a downhill. Every trip is a travel problem stacked on a gathering problem.',
          },
          {
            type: 'callout',
            text: 'A node you cannot reach with the cargo is not a node. It is a postcard.',
          },
        ],
      },
      {
        heading: 'Where the biomes put resources',
        blocks: [
          {
            type: 'p',
            text: 'Wood and thatch live wherever this map is still green, and the greens are not one forest. Highland and Scottish hills grow honest timber. Jungle pays thicker and meaner. Desert wood is the old argument: trees cluster near water, in canyon bottoms, and anywhere the ground remembers being wet. Fiber and berries follow those same greens. The starter kit is easy to start and easy to strand. The grove you can see from a highland ridge may belong to a climate you are not dressed for.',
          },
          {
            type: 'p',
            text: 'Stone is everywhere the wind or the grass has failed to hide it — highland shelves, canyon walls, mountain bone. Metal follows the same rule it does on every map: exposed rock, not soil, not sand. Look at faces that have shrugged their turf, the spines of ridgelines, caves that open from stone. Crystal likes high, hostile rock and the colder hours those heights invent. The desert keeps its own language: sulfur on cooked stone, salt on pale crust, oil in seeps and stains on hardpan. Cactus is the local garden, and it is armed.',
          },
          {
            type: 'p',
            text: 'The ocean is not a border. It is a second map with the usual dark-water pay: oil on the seafloor, pearls deeper and quieter than a casual swim. Do not treat a desert basin as that ocean. Cementing paste is still insects and chitin, which makes jungle, swampy folds, and the things that hunt the dunes your quarry. Silk is an animal product in the dry country, not a tree product. If you cannot see the bottom, you are in the harvest zone and the danger zone together.',
          },
          {
            type: 'list',
            items: [
              'Highlands, Scotlands, and jungle: wood, thatch, fiber, the starter loop.',
              'Bare ridgeline, canyon wall, cave rock: metal, and the crystal that hid from the pastures below.',
              'Cooked stone and pale crust: sulfur, salt, and the desert\'s own crafting language.',
              'Dark water: oil, pearls, and a return trip you should plan before you dive.',
            ],
          },
        ],
      },
      {
        heading: 'Tools and what they favor',
        blocks: [
          {
            type: 'p',
            text: 'The pick-and-hatchet split does not change because the landmass got wider. A pick still favors the mineral side of rock and the thatch side of trunks. A hatchet still favors wood and hide. Metal tools matter more here than pride wants, because a wasted swing is also wasted travel. A sickle still wins at fiber, and it is kinder to cactus than bare hands. In the desert, jars and canteens are harvest tools; a trip that forgets them is not a gathering trip.',
          },
          {
            type: 'p',
            text: 'The tame that matters most is the one that crosses climates. A mineral gatherer on exposed rock is still the metal answer. A wood specialist still empties a grove. A swimmer still turns the ocean into a commute. None of that helps if the node and the box are in different weathers and you have no road between them. A flyer or a boat is how this map stops being a dare. Bring the tool that matches the node, then the animal that matches the distance.',
          },
        ],
      },
      {
        heading: 'Hauling and logistics',
        blocks: [
          {
            type: 'p',
            text: 'Ragnarok\'s weight problem is distance. Nodes that would be a hillside apart on The Island can be a climate apart here, and the cargo that matters — metal, crystal, sulfur — is as heavy as it is anywhere. Load the tame, not the survivor. Put a bed near the deposit so death is a commute, not a tour. Smelt or store on site when the walk home crosses a biome you did not pack for. Walk bars, not rocks.',
          },
          {
            type: 'p',
            text: 'Air and shoreline are the roads. Overland through mixed country is how loaded mounts disappear. Prefer two short loops from a forward bag and a box over one heroic crossing. A highland base does not make a desert node local; a coastal box does not make a mountain local. Plan the return as if the weather will change, because on this map it will — sandstorm in the dry country, cold on the heights, a storm at sea. The harvest is finished when the box at home closes.',
          },
        ],
      },
      {
        heading: 'Hazards while farming',
        blocks: [
          {
            type: 'p',
            text: 'Each climate charges its usual rent, then adds the commute. Highland predators use folds of land as cover. Jungle uses trees. Desert heat cooks an underdressed gatherer through a full bag of good decisions, and sandstorms erase the way home. Canyons add falling to heat. Snow drains stamina on the crystal you came for. The ocean adds drowning to teeth. Wyverns treat the desert scar as a porch. Dress for the biome you are in, not the one you left this morning.',
          },
          {
            type: 'p',
            text: 'Scale is the quiet killer. A route that looks obvious from a ridge can strand you in the wrong weather with the wrong cargo. Deep dune still hides things that erupt under weight. Water sources in the dry country are not automatically safe camps — anything that must drink will eventually visit them. Farm the rock. Visit the water. Do not confuse a scenic overlook with a path. If the harvest made you too heavy to run, you are already late to leave.',
          },
        ],
      },
      {
        heading: 'First-week priorities',
        blocks: [
          {
            type: 'p',
            text: 'Week one on Ragnarok is pick a climate and stay in it. Secure a highland fold or a gentle coast with a bed, a box, and a fire. Learn the pick-and-hatchet split on local stone and trees until the muscle memory is boring. Get a modest weight-carrying herbivore so wood and stone stop living in your own inventory. Do not tour the desert, the jungle, and the ocean in the same week because the map offered you all three.',
          },
          {
            type: 'p',
            text: 'Then read the nearest rock. If the slope shows metal, treat that hillside as your first real economy and put a sleeping bag in walking distance of it. Desert salt, sulfur, and dune trophies wait until you can cross sand without looking like bait, and until you own water for the ride. Oil and pearls wait until you have a swimmer you trust. Crystal waits until you own clothes that answer the cold. The hub page tells you how crowded that continent is right now. The Resource Locations guide is the grammar this page applies.',
          },
          {
            type: 'links',
            items: [
              { href: '/guides/resource-locations', label: 'Resource Locations', note: 'the terrain grammar this continent applies' },
              { href: '/maps/ragnarok', label: 'Live Ragnarok servers', note: 'population, uptime, and versions right now' },
            ],
          },
        ],
      },
    ],
  },
  {
    slug: 'extinction-resources',
    title: 'Extinction Resources Guide — ARK: Survival Ascended',
    shortTitle: 'Extinction Resources',
    description:
      'Terrain-first farming on Extinction: city, wasteland, sunken forest, and the domes — what the ruins pay, and what corruption costs.',
    lastVerified: '2026-08-24',
    related: ['resource-locations', 'extinction-progression', 'aberration-resources', 'genesis-resources'],
    sections: [
      {
        heading: 'What this map is like',
        blocks: [
          {
            type: 'p',
            text: 'Extinction is a city in a wasteland, and the two pay differently. Inside the ruined streets the land is wreckage: poles, vehicles, broken furniture, the leftovers of a civilization that already refined what other maps make you climb for. Outside the shield the old grammar returns — rock, ice, sand, trees — plus wildlife the corruption has already claimed, and Element, the mineral earlier maps locked behind bosses. Farming here is the decision of which side of that fence you are on.',
          },
          {
            type: 'p',
            text: 'The gradient runs outward. Streets and courtyards are the easy read: short loops, wreckage you can see from a bed, nodes that do not require a climate you have not packed for. The open wasteland is the test: distance, packs, and mountain logic under a hostile sky. The sunken forest and the two domes are destinations. You do not commute there for thatch. A survivor who treats the whole map like one quarry will die in the first climate they were not dressed for.',
          },
          {
            type: 'callout',
            text: 'Farm the city like a quarry. Farm the wasteland like a raid. Do not mix the two kits.',
          },
        ],
      },
      {
        heading: 'Where the biomes put resources',
        blocks: [
          {
            type: 'p',
            text: 'The city is the green workshop, except the green is rust. Street wreckage gives up metal, crystal, and electronics without a mountain. Wood is thinner on pavement and thicker in the sunken forest crater, where the map remembers being green. Fiber follows whatever still grows in courtyards and along the shield edge. The starter kit is a scavenging story first and a forestry story second. If it looks like furniture, it is probably a node.',
          },
          {
            type: 'p',
            text: 'Past the shield, stone and metal go back to exposed rock — wasteland shelves, crater walls, the bone of the world showing through. Crystal likes hostile height and the snow dome\'s cold. The desert dome keeps the dry language: cactus, salt, sulfur, heat, the pale crust and cooked stone you already learned to read. Obsidian still wants ground that looks poured. Treat each dome as a compressed climate, not a shortcut. If the air already hurts, the harvest is not a starter loop.',
          },
          {
            type: 'p',
            text: 'Element is this map\'s own node. It sits in the wasteland, and it is not a quiet swing — the ground that pays it also advertises you. Oil and pearls are not the city\'s language; look to cold water and the snow dome when those are the need. Chitin and hide still come from the things with plates, which on this map often means the things that are already hunting you. Corrupted wildlife is not a resource. It is an interruption that never becomes a mount.',
          },
          {
            type: 'list',
            items: [
              'City streets: scrap metal, crystal, electronics, the starter loop without a climb.',
              'Open wasteland rock: the old mineral grammar, and Element if you can keep the ground.',
              'Desert dome and snow dome: compressed climates, packed with what those climates always paid.',
              'Sunken forest: the wood and green the pavement refused to grow.',
            ],
          },
        ],
      },
      {
        heading: 'Tools and what they favor',
        blocks: [
          {
            type: 'p',
            text: 'Picks and hatchets still split a node the same way, including the ones that used to be lamp posts. A pick favors the mineral side of wreckage and rock. A hatchet favors wood, hide, and the organic side of the same swing. Metal tools matter once you leave the streets, because wasteland distance makes a bad yield expensive. A sickle still wins at plant fiber. Hands still gather what is loose on the ground. The city will let you stay on foot longer than your Island habits expect.',
          },
          {
            type: 'p',
            text: 'Tames bias the same directions, then add a fence. A mineral gatherer on wasteland rock is still the metal answer. A wood specialist belongs in the sunken forest, not on the avenue. A weight-focused hauler — especially one that can leave the ground — is how wasteland cargo comes home. A fighter on the same trip is not vanity; the corruption treats a farming swing as a dinner bell. Bring the tool that matches the node, then the animal that matches the side of the shield you are on.',
          },
        ],
      },
      {
        heading: 'Hauling and logistics',
        blocks: [
          {
            type: 'p',
            text: 'The city\'s weight problem is almost polite: short loops, wreckage near a bed, cargo that does not require a climate change. The wasteland\'s is distance plus hunting. Load the tame, not the survivor. Put a bed on the city side of any trip that would drop a naked respawn into packs. Smelt or store near the deposit when the walk home crosses open ground. Walk bars, not rocks.',
          },
          {
            type: 'p',
            text: 'Streets are the easy road. Open waste is a confession when you are slow. Prefer two short loops from a forward bag over one heroic crossing, and do not start a dome run with the city kit still in the saddle. A floating hauler turns wasteland weight into a commute; a grounded one turns it into a siege. Park haulers where a pack cannot pin them against a wall you liked. The harvest is finished when the box at home closes.',
          },
        ],
      },
      {
        heading: 'Hazards while farming',
        blocks: [
          {
            type: 'p',
            text: 'The city is kinder than it looks, not kind. Streets hold gentler wildlife and also hold everyone else who wanted a safe quarry. The shield edge is the line between a gathering problem and a hunting problem. Past it, corrupted packs roam, chew structures, and treat an unescorted gatherer as the day\'s work. Their pressure scales with how far from the city you are. That is the gradient enforcing itself.',
          },
          {
            type: 'p',
            text: 'The domes add climate on a timer: heat in the desert shell, cold in the snow shell, and residents that were waiting in the weather you came to harvest. The sunken forest hides what forests always hide. Element nodes and falling orbital crates are not quiet rocks — they are harvests that call an audience. Falling still kills in craters and on dome walls. If the harvest made you too heavy to run, you are already late to leave. Dress for the side of the fence you are crossing, not the street you woke up on.',
          },
        ],
      },
      {
        heading: 'First-week priorities',
        blocks: [
          {
            type: 'p',
            text: 'Week one on Extinction is the city. Plant a bed deep enough in the streets that the shield edge is a trip, not a backyard. Learn to read wreckage with the pick-and-hatchet split you already own. Get a modest weight-carrying herbivore so scrap and stone stop living in your own inventory. A camp that cannot outlast a bad run into the waste is a respawn timer with extra steps.',
          },
          {
            type: 'p',
            text: 'Once the streets pay, read the nearest exposed rock outside for metal and start the loop you already know: bag at the deposit, tame that carries, short trips, smelt before you stroll. Element and the domes wait until you can leave a body behind and still have a kit at home, and until a pack is a job rather than a surprise. The sunken forest waits until wood is the need, not the tour. The hub page tells you how crowded those ruins are right now. The progression guide is the order of survival; this page is where the rock — and the wreckage — pays. The Resource Locations guide is still the grammar.',
          },
          {
            type: 'links',
            items: [
              { href: '/guides/resource-locations', label: 'Resource Locations', note: 'the terrain grammar this ruined earth applies' },
              { href: '/maps/extinction', label: 'Live Extinction servers', note: 'population, uptime, and versions right now' },
              { href: '/guides/extinction-progression', label: 'Extinction Progression', note: 'city, corruption, and the order that makes the wasteland earnable' },
            ],
          },
        ],
      },
    ],
  },
];

// planned future guides that `related` arrays may reference before they exist.
const PLANNED_SLUGS = ['genesis-resources', 'valguero-resources', 'lost-colony-resources', 'astraeos-resources'];

const BY_SLUG = new Map(GUIDE_REGISTRY.map((g) => [g.slug, g]));

function resolveGuide(slug) {
  if (typeof slug !== 'string' || slug === '') return null;
  return BY_SLUG.get(slug) || null;
}

module.exports = {
  GUIDE_REGISTRY,
  PLANNED_SLUGS,
  resolveGuide,
};
