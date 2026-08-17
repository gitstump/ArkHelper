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
