'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GUIDE_REGISTRY, resolveGuide } = require('./guides.js');
const { getListDef } = require('./server_lists.js');
const { MAP_REGISTRY } = require('./maps.js');

const REQUIRED_FIELDS = ['slug', 'title', 'shortTitle', 'description', 'lastVerified', 'related', 'sections'];
const BLOCK_TYPES = new Set(['p', 'list', 'callout', 'links', 'table']);
const KNOWN_EXACT_ROUTES = new Set([
  '/',
  '/servers',
  '/maps',
  '/stats',
  '/rankings',
  '/leaderboards',
  '/is-ark-down',
  '/status',
  '/rates',
  '/news',
  '/favorites',
]);
const MAP_SLUGS = new Set(MAP_REGISTRY.map((m) => m.slug));

function isKnownAppHref(href) {
  if (typeof href !== 'string' || href === '') return false;
  if (/^https?:/i.test(href) || href.startsWith('//') || href.startsWith('mailto:')) return false;
  if (href.startsWith('/guides/')) return true;
  if (KNOWN_EXACT_ROUTES.has(href)) return true;
  if (href.startsWith('/lists/')) {
    const slug = href.slice('/lists/'.length);
    return Boolean(getListDef(slug));
  }
  if (href.startsWith('/maps/')) {
    return MAP_SLUGS.has(href.slice('/maps/'.length));
  }
  if (href.startsWith('/leaderboards/')) return true;
  if (href.startsWith('/servers/')) return true;
  return false;
}

test('registry slugs are unique and every entry has the required fields', () => {
  const slugs = GUIDE_REGISTRY.map((g) => g.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  assert.equal(GUIDE_REGISTRY.length, 7);
  assert.ok(slugs.includes('beginners'));
  assert.ok(slugs.includes('taming'));
  assert.ok(slugs.includes('resource-locations'));
  assert.ok(slugs.includes('settings-performance'));
  assert.ok(slugs.includes('breeding-mutations'));
  assert.ok(slugs.includes('boss-strategies'));
  assert.ok(slugs.includes('scorched-earth-progression'));
  for (const g of GUIDE_REGISTRY) {
    for (const field of REQUIRED_FIELDS) {
      assert.ok(g[field] != null, `missing ${field} on ${g.slug}`);
    }
    assert.match(g.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(g.title);
    assert.ok(g.shortTitle);
    assert.ok(typeof g.description === 'string' && g.description.length > 0 && g.description.length <= 160);
    assert.match(g.lastVerified, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(Array.isArray(g.related));
    assert.ok(Array.isArray(g.sections));
    for (const section of g.sections) {
      assert.ok(section.heading);
      assert.ok(Array.isArray(section.blocks));
      for (const block of section.blocks) {
        assert.ok(BLOCK_TYPES.has(block.type), `unknown block type ${block.type} in ${g.slug}`);
        if (block.type === 'table') {
          assert.ok(typeof block.caption === 'string' && block.caption.length > 0, `table missing caption in ${g.slug}`);
          assert.ok(Array.isArray(block.headers) && block.headers.length > 0, `table missing headers in ${g.slug}`);
          assert.ok(block.headers.every((h) => typeof h === 'string'));
          assert.ok(Array.isArray(block.rows), `table missing rows in ${g.slug}`);
          for (const row of block.rows) {
            assert.ok(Array.isArray(row));
            assert.equal(row.length, block.headers.length, `table row width mismatch in ${g.slug}`);
            assert.ok(row.every((cell) => typeof cell === 'string'));
          }
        }
      }
    }
  }
});

test('resolveGuide returns the beginners record and null (not throw) for unknown input', () => {
  const beginners = resolveGuide('beginners');
  assert.ok(beginners);
  assert.equal(beginners.slug, 'beginners');
  assert.equal(beginners.shortTitle, "Beginner's Guide");
  const taming = resolveGuide('taming');
  assert.ok(taming);
  assert.equal(taming.slug, 'taming');
  assert.equal(taming.shortTitle, 'Taming Guide');
  const resources = resolveGuide('resource-locations');
  assert.ok(resources);
  assert.equal(resources.slug, 'resource-locations');
  assert.equal(resources.shortTitle, 'Resource Locations');
  const settings = resolveGuide('settings-performance');
  assert.ok(settings);
  assert.equal(settings.slug, 'settings-performance');
  assert.equal(settings.shortTitle, 'Settings & Performance');
  const breeding = resolveGuide('breeding-mutations');
  assert.ok(breeding);
  assert.equal(breeding.slug, 'breeding-mutations');
  assert.equal(breeding.shortTitle, 'Breeding & Mutations');
  const bosses = resolveGuide('boss-strategies');
  assert.ok(bosses);
  assert.equal(bosses.slug, 'boss-strategies');
  assert.equal(bosses.shortTitle, 'Boss Strategies');
  const scorched = resolveGuide('scorched-earth-progression');
  assert.ok(scorched);
  assert.equal(scorched.slug, 'scorched-earth-progression');
  assert.equal(scorched.shortTitle, 'Scorched Earth Progression');
  assert.equal(resolveGuide('nope'), null);
  assert.equal(resolveGuide(''), null);
  assert.equal(resolveGuide(undefined), null);
  assert.equal(resolveGuide(null), null);
  assert.equal(resolveGuide(12), null);
  assert.doesNotThrow(() => resolveGuide('not-a-guide'));
});

test('every links-block href is an internal known route or a /guides/ path', () => {
  for (const g of GUIDE_REGISTRY) {
    for (const section of g.sections) {
      for (const block of section.blocks) {
        if (block.type !== 'links') continue;
        for (const item of block.items) {
          assert.ok(
            isKnownAppHref(item.href),
            `unknown or external href ${item.href} in ${g.slug}`
          );
        }
      }
    }
  }
});

test('beginners guide ships the brief prose verbatim', () => {
  const g = resolveGuide('beginners');
  assert.equal(g.title, "Beginner's Guide — ARK: Survival Ascended");
  assert.equal(g.lastVerified, '2026-08-16');
  assert.equal(g.sections.length, 8);
  assert.equal(g.related.join(','), 'taming,resource-locations,settings-performance');
  const first = g.sections[0].blocks[0];
  assert.equal(
    first.text,
    'Your first decision happens before the character screen. On a PvE server, other players cannot hurt you or your buildings, which makes it the sensible default for learning the game. PvP is a different hobby: everything you build can be raided, usually while you sleep. Start PvE; switch later if the quiet bothers you.'
  );
  const callout = g.sections[1].blocks.find((b) => b.type === 'callout');
  assert.equal(
    callout.text,
    'If a spawn goes badly, dying and re-rolling in the first ten minutes costs you nothing. It is faster to restart on a good beach than to rescue a bad start.'
  );
  const tameLink = g.sections[5].blocks.find((b) => b.type === 'links').items[0];
  assert.equal(tameLink.href, '/guides/taming');
  assert.equal(tameLink.note, 'methods and preparation in depth');
  assert.doesNotMatch(tameLink.note, /coming soon/);
});

test('taming guide ships the brief prose verbatim', () => {
  const g = resolveGuide('taming');
  assert.equal(g.title, 'Taming Guide — ARK: Survival Ascended');
  assert.equal(g.lastVerified, '2026-08-16');
  assert.equal(g.sections.length, 8);
  assert.equal(g.related.join(','), 'beginners,breeding-mutations,resource-locations');
  assert.equal(
    g.description,
    'Knockout and passive taming from first bola to first mount: preparation, torpor, feeding, traps, and keeping your target alive.'
  );
  assert.equal(
    g.sections[0].blocks[0].text,
    "Every tame is a timer, and the server's taming multiplier sets how long that timer runs. During bonus-rate events the same animal can take a fraction of the usual time, so a five-minute check before you leave home can save you an afternoon. Then pack as if the tame will take twice as long as you hope: food for the animal, food for you, more sedatives than the plan requires, and something to fight with that you are not using to tame."
  );
  const callout = g.sections[0].blocks.find((b) => b.type === 'callout');
  assert.equal(
    callout.text,
    'The most common taming failure is not the animal waking up — it is the tamer arriving unprepared and improvising.'
  );
  const rates = g.sections[0].blocks.find((b) => b.type === 'links').items[0];
  assert.equal(rates.href, '/rates');
  assert.equal(g.sections[7].heading, 'After the tame');
  const resourceLink = g.sections[7].blocks.find((b) => b.type === 'links').items.find((i) => i.href === '/guides/resource-locations');
  assert.ok(resourceLink);
  assert.equal(resourceLink.note, 'where your new hauler earns its keep');
  assert.doesNotMatch(resourceLink.note, /coming soon/);
});

test('resource-locations guide ships the brief prose and table verbatim', () => {
  const g = resolveGuide('resource-locations');
  assert.equal(g.title, 'Resource Locations — ARK: Survival Ascended');
  assert.equal(g.shortTitle, 'Resource Locations');
  assert.equal(g.lastVerified, '2026-08-16');
  assert.equal(g.sections.length, 8);
  assert.equal(g.related.join(','), 'taming,beginners,boss-strategies');
  assert.equal(
    g.description,
    'Where metal, crystal, obsidian, oil, and pearls actually live: reading terrain, picking the right tool and tame, and hauling it all home.'
  );
  assert.equal(
    g.sections[0].blocks[0].text,
    'Every official map dresses the same underlying logic in different scenery: dense metal collects on mountains and in caves, crystal favors peaks and cold heights, obsidian hugs volcanic and geothermal ground, oil pools underwater and in polar biomes, and pearls hide in the deepest, least friendly water. Learn to read terrain once and you can farm a map you have never visited. Guides that hand you exact pin coordinates go stale with every spawn change; the terrain rules do not.'
  );
  const callout = g.sections[0].blocks.find((b) => b.type === 'callout');
  assert.equal(
    callout.text,
    "The question is never 'where is the metal on this map' — it is 'where are this map's mountains, and how do I survive them.'"
  );
  const table = g.sections[1].blocks.find((b) => b.type === 'table');
  assert.equal(table.caption, 'Resource to terrain, tool, and hauling companion');
  assert.deepEqual(table.headers, ['Resource', 'Terrain to read for', 'Best tool', 'Classic gatherer']);
  assert.equal(table.rows.length, 7);
  assert.deepEqual(table.rows[0], ['Metal', 'Mountain slopes, cave interiors, rocky spires', 'Metal pick', 'Ankylosaurus']);
  assert.deepEqual(table.rows[6], ['Wood and thatch', 'Any forest; denser trees, better yield', 'Hatchet for wood, pick for thatch', 'Castoroides or Therizinosaur']);
  const links = g.sections[7].blocks.find((b) => b.type === 'links').items;
  assert.equal(links[0].href, '/maps');
  assert.equal(links[1].href, '/rates');
  assert.equal(links[2].href, '/guides/taming');
  assert.equal(links[2].note, 'the gatherers in the table above start here');
});

test('settings-performance guide ships the brief prose and table verbatim', () => {
  const g = resolveGuide('settings-performance');
  assert.equal(g.title, 'Settings & Performance — ARK: Survival Ascended');
  assert.equal(g.shortTitle, 'Settings & Performance');
  assert.equal(g.lastVerified, '2026-08-16');
  assert.equal(g.sections.length, 8);
  assert.equal(g.related.join(','), 'beginners,resource-locations,taming');
  assert.equal(
    g.description,
    "Getting playable performance out of ASA: presets, upscaling, the settings that matter, and how to tell your hardware's problems from the server's."
  );
  assert.equal(
    g.sections[0].blocks[0].text,
    "ASA performance complaints bundle two unrelated problems: frames and lag. Low framerate is your machine rendering slowly — choppy motion even standing alone in a quiet base. Lag is the network — rubber-banding, delayed hits, creatures teleporting — and no graphics setting on Earth fixes it. Before you tune anything, spend one minute diagnosing: check whether the whole network is having an incident, look at your server's ping, and if the ping is the problem, the fix is picking a closer server, not lowering your shadows."
  );
  const callout = g.sections[0].blocks.find((b) => b.type === 'callout');
  assert.equal(
    callout.text,
    'Choppy alone in a quiet base: your hardware. Smooth frames but delayed hits and rubber-banding: the connection.'
  );
  const table = g.sections[3].blocks.find((b) => b.type === 'table');
  assert.equal(table.caption, 'Symptoms to first suspects');
  assert.deepEqual(table.headers, ['Symptom', 'Likely culprit', 'First move']);
  assert.equal(table.rows.length, 5);
  assert.deepEqual(table.rows[0], [
    'Low frames everywhere, all the time',
    'Overall preset above your hardware',
    'Drop one full preset',
  ]);
  assert.deepEqual(table.rows[4], [
    'Smooth frames, delayed actions',
    'Network, not graphics',
    'Check ping and the network status page',
  ]);
  const links = g.sections[7].blocks.find((b) => b.type === 'links').items;
  assert.equal(links[0].href, '/servers');
  assert.equal(links[1].href, '/is-ark-down');
  assert.equal(links[2].href, '/guides/beginners');
  assert.equal(links[2].note, 'now that it runs, here is how to survive it');
});

test('breeding-mutations guide ships the brief prose verbatim', () => {
  const g = resolveGuide('breeding-mutations');
  assert.equal(g.title, 'Breeding & Mutations — ARK: Survival Ascended');
  assert.equal(g.shortTitle, 'Breeding & Mutations');
  assert.equal(g.lastVerified, '2026-08-16');
  assert.equal(g.sections.length, 8);
  assert.equal(g.related.join(','), 'taming,boss-strategies,beginners');
  assert.equal(
    g.description,
    'From first egg to a bred line: the breeding loop, imprinting, how inheritance works, and what mutations really are — without the spreadsheet.'
  );
  assert.equal(
    g.sections[0].blocks[0].text,
    'A wild tame is a lottery ticket you already scratched; a bred creature is a design. Breeding lets you combine the best qualities of two parents, raise the baby under your protection, and imprint it to fight harder for you specifically. It is how tribes produce the animals that clear bosses and win wars — and it is the longest time investment in the game, so check the current breeding and maturation rates before you start a line. A bonus-rate weekend can compress days of raising into an evening.'
  );
  const rates = g.sections[0].blocks.find((b) => b.type === 'links').items[0];
  assert.equal(rates.href, '/rates');
  assert.equal(rates.note, 'maturation and imprint multipliers decide your calendar');
  const callout = g.sections[1].blocks.find((b) => b.type === 'callout');
  assert.equal(
    callout.text,
    'The first hour after hatching is the commitment. Clear your schedule before you clear the incubation.'
  );
  assert.equal(g.sections[3].heading, 'Inheritance: each stat flips its own coin');
  const list = g.sections[3].blocks.find((b) => b.type === 'list');
  assert.deepEqual(list.items, [
    'Tame widely first: wild stats are the raw material of a line.',
    'Track which parent carries which prize stat before pairing.',
    'Keep the best offspring as breeders; the rest are boss fodder.',
  ]);
  assert.equal(g.sections[6].heading, "When is a line 'done'?");
  const links = g.sections[7].blocks.find((b) => b.type === 'links').items;
  assert.equal(links[0].href, '/guides/taming');
  assert.equal(links[0].note, 'every line starts with wild-caught parents');
  assert.equal(links[1].href, '/guides/boss-strategies');
  assert.equal(links[1].note, 'what all this breeding is for');
  assert.equal(links[2].href, '/rates');
  assert.equal(links[2].note, 'time any serious hatch around the multipliers');
});

function isUnpublishedGuideHref(href, liveSlugs) {
  if (typeof href !== 'string') return false;
  const match = /^\/guides\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(href);
  return Boolean(match && !liveSlugs.has(match[1]));
}

test('coming-soon notes are allowed iff they point at an unpublished /guides slug', () => {
  const liveSlugs = new Set(GUIDE_REGISTRY.map((g) => g.slug));

  assert.equal(isUnpublishedGuideHref('/guides/beginners', liveSlugs), false);
  assert.equal(isUnpublishedGuideHref('/guides/boss-strategies', liveSlugs), false);
  assert.equal(isUnpublishedGuideHref('/guides/not-yet-a-guide', liveSlugs), true);
  assert.equal(isUnpublishedGuideHref('/maps', liveSlugs), false);
  assert.equal(isUnpublishedGuideHref('/rates', liveSlugs), false);
  assert.equal(isUnpublishedGuideHref('/guides/', liveSlugs), false);

  const comingSoonOnLive = [];
  const comingSoonViolations = [];
  for (const g of GUIDE_REGISTRY) {
    for (const section of g.sections) {
      for (const block of section.blocks) {
        if (block.type !== 'links') continue;
        for (const item of block.items) {
          if (typeof item.note !== 'string' || !/\(coming soon\)/.test(item.note)) continue;
          const slugMatch = typeof item.href === 'string' ? /^\/guides\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(item.href) : null;
          if (slugMatch && liveSlugs.has(slugMatch[1])) {
            comingSoonOnLive.push(`${g.slug}:${item.href}`);
          }
          if (!isUnpublishedGuideHref(item.href, liveSlugs)) {
            comingSoonViolations.push(`${g.slug}:${item.href}`);
          }
        }
      }
    }
  }
  assert.deepEqual(comingSoonOnLive, [], 'coming-soon note must not point at a live slug');
  assert.deepEqual(comingSoonViolations, [], 'coming-soon is allowed only on unpublished /guides/<slug>');
});

test('every related slug across the registry resolves or is skipped silently', () => {
  for (const g of GUIDE_REGISTRY) {
    assert.ok(Array.isArray(g.related));
    for (const slug of g.related) {
      assert.doesNotThrow(() => resolveGuide(slug));
    }
  }
});

test('boss-strategies guide ships the brief prose verbatim', () => {
  const g = resolveGuide('boss-strategies');
  assert.equal(g.title, 'Boss Strategies — ARK: Survival Ascended');
  assert.equal(g.shortTitle, 'Boss Strategies');
  assert.equal(g.lastVerified, '2026-08-16');
  assert.equal(g.sections.length, 8);
  assert.equal(g.related.join(','), 'breeding-mutations,taming,resource-locations');
  assert.equal(
    g.description,
    "Preparing for and surviving ARK's boss arenas: the summoning ritual, army composition, fight roles, and why the preparation is the fight."
  );
  assert.equal(
    g.sections[0].blocks[0].text,
    "ARK's bosses are the exam at the end of the course. The arena itself lasts minutes; everything that decides it — the bred creatures, the imprints, the saddles, the gear — happened at your base over the preceding weeks. If a boss attempt fails, the lesson is almost never 'fight better.' It is that the army was underbred, the saddles were thin, or the team walked in unrehearsed. This guide is mostly about the weeks, because the weeks are the fight."
  );
  const callout = g.sections[0].blocks.find((b) => b.type === 'callout');
  assert.equal(
    callout.text,
    'You do not lose a boss fight in the arena. You lose it in the breeding pen, and the arena delivers the news.'
  );
  assert.equal(g.sections[1].heading, 'How a fight actually happens');
  assert.equal(g.sections[2].heading, 'Choose your tier honestly');
  assert.equal(g.sections[3].heading, 'The army: bred, imprinted, and saddled');
  const list = g.sections[3].blocks.find((b) => b.type === 'list');
  assert.deepEqual(list.items, [
    'Health and melee win arenas; hauling stats stay home.',
    'Imprint to the rider who will actually be in the arena.',
    'Farm and craft for saddle quality like the fight depends on it, because it does.',
  ]);
  assert.equal(g.sections[4].heading, 'Roles in the arena');
  assert.equal(g.sections[5].heading, 'Gear for the minutes that matter');
  assert.equal(g.sections[6].heading, 'After the victory');
  assert.equal(
    g.sections[6].blocks[0].text,
    "A won fight pays in three currencies: element, the endgame resource that powers the technology tier; engrams, unlocking that tier's crafting; and progression toward the map's ascension — the story climb that raises your level ceiling and leads to the next chapter. Element is why boss fights become routine rather than milestones: the technology it powers is consumed with use, so the arena becomes a farm. That is the endgame loop — breed, fight, spend, repeat — and it is exactly why the breeding guide ends with 'the best breeders ship.'"
  );
  const links = g.sections[7].blocks.find((b) => b.type === 'links').items;
  assert.equal(links[0].href, '/guides/breeding-mutations');
  assert.equal(links[0].note, 'the army does not tame itself into existence');
  assert.equal(links[1].href, '/maps');
  assert.equal(links[1].note, 'pick the map whose endgame you are gearing for');
  assert.equal(links[2].href, '/rates');
  assert.equal(links[2].note, 'breed and farm the army on the right weekend');
});

test('scorched-earth-progression guide ships the brief prose verbatim', () => {
  const g = resolveGuide('scorched-earth-progression');
  assert.ok(g);
  assert.equal(g.title, 'Scorched Earth Progression Guide — ARK: Survival Ascended');
  assert.equal(g.shortTitle, 'Scorched Earth Progression');
  assert.equal(g.lastVerified, '2026-08-17');
  assert.equal(g.sections.length, 8);
  assert.equal(g.related.join(','), 'boss-strategies,resource-locations,aberration-progression,beginners');
  assert.equal(
    g.description,
    'Surviving the desert from first canteen to the Manticore: water, heat, sandstorms, wyverns, and the order that makes the map beatable.'
  );
  assert.ok(resolveGuide('boss-strategies'));
  assert.ok(resolveGuide('resource-locations'));
  assert.ok(resolveGuide('beginners'));
  assert.equal(resolveGuide('aberration-progression'), null);
  assert.doesNotThrow(() => resolveGuide('aberration-progression'));
  assert.equal(
    g.sections[0].blocks[0].text,
    'Scorched Earth is the first story expansion, and it teaches by subtraction. There are no forgiving coastlines, no easy freshwater, and no gentle starter biome — the whole map is desert, and the desert is the antagonist. Everything you learned on The Island still applies; the map just adds a second clock. On The Island you managed food and safety. Here you also manage water and temperature, all the time, everywhere.'
  );
  const callout = g.sections[0].blocks.find((b) => b.type === 'callout');
  assert.equal(
    callout.text,
    'The map has a difficulty gradient like any other: the outer dunes and lowlands are the easy zone, the central canyons and mountains are not. Progression on this map is mostly the story of earning your way inward.'
  );
  assert.equal(g.sections[1].heading, 'Water is the real tutorial');
  const waterList = g.sections[1].blocks.find((b) => b.type === 'list');
  assert.deepEqual(waterList.items, [
    'Never leave base without more water than you think the trip needs.',
    'Build your first real base within reach of a reliable water source, then engineer your way to independence from it.',
    'Heat multiplies thirst: the hotter the hour, the shorter your range.',
  ]);
  assert.equal(g.sections[5].heading, 'Wyverns and the scar in the world');
  for (const section of g.sections) {
    for (const block of section.blocks) {
      assert.ok(BLOCK_TYPES.has(block.type), `unknown block type ${block.type}`);
      if (block.type === 'links') {
        for (const item of block.items) {
          assert.ok(item.href.startsWith('/'), `links href must start with /: ${item.href}`);
        }
      }
    }
  }
  const tameLinks = g.sections[3].blocks.find((b) => b.type === 'links').items;
  assert.equal(tameLinks[0].href, '/guides/taming');
  assert.equal(tameLinks[0].label, 'Taming Guide');
  assert.equal(tameLinks[0].note, 'knockout and passive methods that all transfer to the desert');
  assert.equal(tameLinks[1].href, '/guides/resource-locations');
  assert.equal(tameLinks[1].note, 'terrain-first farming logic that applies on every map');
  const endLinks = g.sections[7].blocks.find((b) => b.type === 'links').items;
  assert.equal(endLinks[0].href, '/guides/boss-strategies');
  assert.equal(endLinks[0].note, 'army composition, arena roles, and why preparation is the fight');
  assert.equal(endLinks[1].href, '/guides/beginners');
  assert.equal(endLinks[1].note, 'the fundamentals the desert assumes you know');
  assert.doesNotMatch(endLinks[0].note, /coming soon/);
  assert.doesNotMatch(endLinks[1].note, /coming soon/);
});
