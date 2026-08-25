'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GUIDE_REGISTRY, resolveGuide } = require('./guides.js');
const { renderGuidesIndexPage, renderGuidePage, renderGuideNotFoundPage } = require('./guides_page.js');

const SECTION_HEADINGS = [
  'Pick the right server before you spawn',
  'Choose an easy spawn, then commit to it',
  'The first hour: tools, fire, and a full stomach',
  'A bed is your save point — place one immediately',
  'Spend levels on survival, not comfort',
  'Your first tame changes everything',
  'Habits that keep your progress',
  'Where to go next',
];

const TAMING_HEADINGS = [
  'Check the rates, then pack for the whole job',
  'Two families: knockout and passive',
  'The knockout: control first, torpor second',
  'Keeping it down and getting it fed',
  'Taming effectiveness is the hidden score',
  'Passive taming: patience under pressure',
  'Traps pay for themselves',
  'After the tame',
];

const RESOURCE_HEADINGS = [
  'Resources follow terrain, not maps',
  'Quick pick: what you need, where it lives',
  'Metal: the economy runs on it',
  'Crystal and obsidian: the high, cold, and hostile',
  'Oil: two very different trips',
  'Pearls and paste: the patience resources',
  'Hauling is half the job',
  'Match the map to the shopping list',
];

const SETTINGS_HEADINGS = [
  'First, establish whose problem it is',
  'Why this game is heavy',
  'Presets first, pride later',
  'The settings that actually move the needle',
  'Upscaling is the biggest single lever',
  'About those launch-option lists',
  'Consoles and the settings you cannot touch',
  'Where to go next',
];

const BREEDING_HEADINGS = [
  'Why breed at all',
  'The loop: pair, wait, raise, repeat',
  'Imprinting: raising it yourself pays',
  'Inheritance: each stat flips its own coin',
  'Mutations: rare, random, and stacked with care',
  'Logistics: the part that actually defeats people',
  "When is a line 'done'?",
  'Where to go next',
];

const BOSS_HEADINGS = [
  'The boss fight starts weeks earlier',
  'How a fight actually happens',
  'Choose your tier honestly',
  'The army: bred, imprinted, and saddled',
  'Roles in the arena',
  'Gear for the minutes that matter',
  'After the victory',
  'Where to go next',
];

const SCORCHED_HEADINGS = [
  'What Scorched Earth asks of you',
  'Water is the real tutorial',
  'Heat, insulation, and the adobe answer',
  'The desert food chain, and your first tames',
  'Sandstorms and the weather that fights back',
  'Wyverns and the scar in the world',
  'Deathworms and the deep desert',
  'The Manticore, and where the story goes next',
];

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('renderGuidesIndexPage lists the beginners card with a link and last-verified date', () => {
  const html = renderGuidesIndexPage({});
  assert.match(html, /<title>Guides \u2014 ArkHelper<\/title>/);
  assert.match(html, /meta name="description"/);
  assert.match(html, /href="\/guides\/beginners"/);
  assert.match(html, /Beginner&#39;s Guide/);
  assert.match(html, /Last verified 2026-08-16/);
  assert.match(html, /class="guide-card"/);
  assert.match(html, /First spawn to first tame/);
  assert.match(html, /href="\/guides\/taming"/);
  assert.match(html, /Taming Guide/);
  assert.match(html, /Knockout and passive taming from first bola to first mount/);
  assert.match(html, /href="\/guides\/resource-locations"/);
  assert.match(html, /Resource Locations/);
  assert.match(html, /Where metal, crystal, obsidian, oil, and pearls/);
  assert.match(html, /href="\/guides\/settings-performance"/);
  assert.match(html, /Settings &amp; Performance/);
  assert.match(html, /Getting playable performance out of ASA/);
  assert.match(html, /href="\/guides\/breeding-mutations"/);
  assert.match(html, /Breeding &amp; Mutations/);
  assert.match(html, /From first egg to a bred line/);
  assert.match(html, /href="\/guides\/boss-strategies"/);
  assert.match(html, /Boss Strategies/);
  assert.match(html, /Preparing for and surviving ARK&#39;s boss arenas/);
  assert.match(html, /href="\/guides\/scorched-earth-progression"/);
  assert.match(html, /Scorched Earth Progression/);
  assert.match(html, /Surviving the desert from first canteen to the Manticore/);
  assert.match(html, /href="\/guides\/aberration-progression"/);
  assert.match(html, /Aberration Progression/);
  assert.match(html, /The underground ARK from first Bulbdog to Rockwell/);
  assert.match(html, /href="\/guides\/the-island-resources"/);
  assert.match(html, /The Island Resources/);
  assert.match(html, /href="\/guides\/scorched-earth-resources"/);
  assert.match(html, /Scorched Earth Resources/);
  assert.match(html, /href="\/guides\/aberration-resources"/);
  assert.match(html, /Aberration Resources/);
  assert.match(html, /href="\/guides\/the-center-resources"/);
  assert.match(html, /The Center Resources/);
  assert.match(html, /href="\/guides\/ragnarok-resources"/);
  assert.match(html, /Ragnarok Resources/);
  assert.match(html, /href="\/guides\/extinction-resources"/);
  assert.match(html, /Extinction Resources/);
  assert.equal((html.match(/class="guide-card"/g) || []).length, 16);
});

test('renderGuidePage renders the h1, all 8 headings, the callout, and escaped content', () => {
  const html = renderGuidePage({ guide: resolveGuide('beginners') });
  assert.match(html, /<h1>Beginner&#39;s Guide \u2014 ARK: Survival Ascended<\/h1>/);
  assert.match(html, /Last verified 2026-08-16/);
  for (const heading of SECTION_HEADINGS) {
    assert.match(html, new RegExp(`<h2>${escapeRegExp(heading)}</h2>`));
  }
  assert.match(html, /class="callout"/);
  assert.match(html, /If a spawn goes badly/);
  assert.match(html, /href="\/lists\/official-pve"/);
  assert.match(html, /href="\/guides\/taming"/);
  assert.match(html, /Start PvE; switch later if the quiet bothers you\./);
  assert.match(html, /methods and preparation in depth/);
  assert.doesNotMatch(html, /\(coming soon\)/);

  const hostile = renderGuidePage({
    guide: {
      slug: 'x',
      title: '<script>evil()</script>',
      shortTitle: 'x',
      description: 'desc',
      lastVerified: '2026-08-16',
      related: [],
      sections: [{ heading: 'H', blocks: [{ type: 'p', text: '<img onerror=1>' }] }],
    },
  });
  assert.doesNotMatch(hostile, /<script>evil\(\)<\/script>/);
  assert.match(hostile, /&lt;script&gt;evil\(\)&lt;\/script&gt;/);
  assert.match(hostile, /&lt;img onerror=1&gt;/);
});

test('renderGuidePage renders the taming guide h1, all 8 headings, callout, and rates link', () => {
  const html = renderGuidePage({ guide: resolveGuide('taming') });
  assert.match(html, /<h1>Taming Guide \u2014 ARK: Survival Ascended<\/h1>/);
  assert.match(html, /Last verified 2026-08-16/);
  for (const heading of TAMING_HEADINGS) {
    assert.match(html, new RegExp(`<h2>${escapeRegExp(heading)}</h2>`));
  }
  assert.match(html, /class="callout"/);
  assert.match(
    html,
    /The most common taming failure is not the animal waking up \u2014 it is the tamer arriving unprepared and improvising\./
  );
  assert.match(html, /href="\/rates"/);
  assert.match(html, /see the live taming multiplier before you commit/);
  assert.match(html, /where your new hauler earns its keep/);
  assert.doesNotMatch(html, /\(coming soon\)/);
});

test('renderGuidePage renders the resource-locations guide h1, 8 headings, table, and callout', () => {
  const html = renderGuidePage({ guide: resolveGuide('resource-locations') });
  assert.match(html, /<h1>Resource Locations \u2014 ARK: Survival Ascended<\/h1>/);
  assert.match(html, /Last verified 2026-08-16/);
  for (const heading of RESOURCE_HEADINGS) {
    assert.match(html, new RegExp(`<h2>${escapeRegExp(heading)}</h2>`));
  }
  assert.match(html, /class="callout"/);
  assert.match(html, /The question is never &#39;where is the metal on this map&#39;/);
  assert.match(html, /<table class="guide-table">/);
  assert.match(html, /<caption>Resource to terrain, tool, and hauling companion<\/caption>/);
  assert.match(html, /<th scope="row">Metal<\/th>/);
  assert.match(html, /href="\/maps"/);
  assert.match(html, /href="\/rates"/);
  assert.match(html, /href="\/guides\/taming"/);
  assert.doesNotMatch(html, /\(coming soon\)/);
});

test('renderGuidePage renders the settings-performance guide h1, 8 headings, table, and callout', () => {
  const html = renderGuidePage({ guide: resolveGuide('settings-performance') });
  assert.match(html, /<h1>Settings &amp; Performance \u2014 ARK: Survival Ascended<\/h1>/);
  assert.match(html, /Last verified 2026-08-16/);
  for (const heading of SETTINGS_HEADINGS) {
    assert.match(html, new RegExp(`<h2>${escapeRegExp(heading)}</h2>`));
  }
  assert.match(html, /class="callout"/);
  assert.match(
    html,
    /Choppy alone in a quiet base: your hardware. Smooth frames but delayed hits and rubber-banding: the connection./
  );
  assert.match(html, /<table class="guide-table">/);
  assert.match(html, /<caption>Symptoms to first suspects<\/caption>/);
  assert.match(html, /<th scope="row">Low frames everywhere, all the time<\/th>/);
  assert.match(html, /href="\/is-ark-down"/);
  assert.match(html, /href="\/lists\/low-ping"/);
  assert.match(html, /href="\/guides\/beginners"/);
  assert.doesNotMatch(html, /\(coming soon\)/);
});

test('renderGuidePage renders the breeding-mutations guide h1, 8 headings, and callout', () => {
  const html = renderGuidePage({ guide: resolveGuide('breeding-mutations') });
  assert.match(html, /<h1>Breeding &amp; Mutations \u2014 ARK: Survival Ascended<\/h1>/);
  assert.match(html, /Last verified 2026-08-16/);
  for (const heading of BREEDING_HEADINGS) {
    const htmlHeading = heading.replace(/'/g, '&#39;');
    assert.match(html, new RegExp(`<h2>${escapeRegExp(htmlHeading)}</h2>`));
  }
  assert.match(html, /class="callout"/);
  assert.match(
    html,
    /The first hour after hatching is the commitment. Clear your schedule before you clear the incubation./
  );
  assert.match(html, /href="\/rates"/);
  assert.match(html, /href="\/guides\/taming"/);
  assert.match(html, /every line starts with wild-caught parents/);
  assert.match(html, /what all this breeding is for/);
  assert.doesNotMatch(html, /\(coming soon\)/);
});

test('renderGuidePage renders the boss-strategies guide h1, 8 headings, and callout', () => {
  const html = renderGuidePage({ guide: resolveGuide('boss-strategies') });
  assert.match(html, /<h1>Boss Strategies \u2014 ARK: Survival Ascended<\/h1>/);
  assert.match(html, /Last verified 2026-08-16/);
  for (const heading of BOSS_HEADINGS) {
    assert.match(html, new RegExp(`<h2>${escapeRegExp(heading)}</h2>`));
  }
  assert.match(html, /class="callout"/);
  assert.match(
    html,
    /You do not lose a boss fight in the arena. You lose it in the breeding pen, and the arena delivers the news./
  );
  assert.match(html, /href="\/guides\/breeding-mutations"/);
  assert.match(html, /the army does not tame itself into existence/);
  assert.match(html, /href="\/maps"/);
  assert.match(html, /href="\/rates"/);
  assert.doesNotMatch(html, /\(coming soon\)/);
});

test('renderGuidePage renders the scorched-earth-progression guide h1, 8 headings, and callout', () => {
  const html = renderGuidePage({ guide: resolveGuide('scorched-earth-progression') });
  assert.match(html, /<h1>Scorched Earth Progression Guide \u2014 ARK: Survival Ascended<\/h1>/);
  assert.match(html, /Last verified 2026-08-17/);
  for (const heading of SCORCHED_HEADINGS) {
    assert.match(html, new RegExp(`<h2>${escapeRegExp(heading)}</h2>`));
  }
  assert.match(html, /class="callout"/);
  assert.match(
    html,
    /The map has a difficulty gradient like any other: the outer dunes and lowlands are the easy zone/
  );
  assert.match(html, /href="\/guides\/taming"/);
  assert.match(html, /knockout and passive methods that all transfer to the desert/);
  assert.match(html, /href="\/guides\/resource-locations"/);
  assert.match(html, /href="\/guides\/boss-strategies"/);
  assert.match(html, /href="\/guides\/beginners"/);
  assert.match(html, /href="\/guides\/aberration-progression"/);
  assert.doesNotMatch(html, /\(coming soon\)/);
});

test('renderGuidePage table cells and caption are escaped; first column is th scope=row', () => {
  const html = renderGuidePage({
    guide: {
      slug: 'x',
      title: 'X',
      shortTitle: 'X',
      description: 'd',
      lastVerified: '2026-08-16',
      related: [],
      sections: [
        {
          heading: 'H',
          blocks: [
            {
              type: 'table',
              caption: 'Cap <script>x</script>',
              headers: ['A', 'B'],
              rows: [['<script>evil()</script>', 'ok <b>x</b>']],
            },
          ],
        },
      ],
    },
  });
  assert.match(html, /<table class="guide-table">/);
  assert.match(html, /<caption>Cap &lt;script&gt;x&lt;\/script&gt;<\/caption>/);
  assert.match(html, /<thead><tr><th>A<\/th><th>B<\/th><\/tr><\/thead>/);
  assert.match(html, /<th scope="row">&lt;script&gt;evil\(\)&lt;\/script&gt;<\/th>/);
  assert.match(html, /<td>ok &lt;b&gt;x&lt;\/b&gt;<\/td>/);
  assert.doesNotMatch(html, /<script>evil\(\)<\/script>/);
  assert.doesNotMatch(html, /<script>x<\/script>/);
});

test('every related list across the registry fully resolves in the footer', () => {
  assert.equal(GUIDE_REGISTRY.length, 16);
  for (const g of GUIDE_REGISTRY) {
    const html = renderGuidePage({ guide: g });
    const related = html.match(/class="guide-related"[\s\S]*?<\/nav>/);
    assert.ok(related, `missing related footer on ${g.slug}`);
    const liveRelated = g.related.filter((slug) => resolveGuide(slug));
    for (const slug of liveRelated) {
      assert.match(related[0], new RegExp(`href="/guides/${slug}"`));
    }
    for (const slug of g.related.filter((s) => !resolveGuide(s))) {
      assert.doesNotMatch(related[0], new RegExp(slug));
    }
    assert.equal(
      (related[0].match(/href="\/guides\//g) || []).length,
      liveRelated.length,
      `related footer link count mismatch on ${g.slug}`
    );
  }
});

test('related footer with unknown slugs renders without error and omits missing guides', () => {
  const html = renderGuidePage({ guide: resolveGuide('beginners') });
  assert.match(html, /Related guides/);
  const beginnersRelated = html.match(/class="guide-related"[\s\S]*?<\/nav>/);
  assert.ok(beginnersRelated);
  assert.match(beginnersRelated[0], /href="\/guides\/taming"/);
  assert.match(beginnersRelated[0], /href="\/guides\/resource-locations"/);
  assert.match(beginnersRelated[0], /href="\/guides\/settings-performance"/);
  assert.equal((beginnersRelated[0].match(/href="\/guides\//g) || []).length, 3);

  const tamingHtml = renderGuidePage({ guide: resolveGuide('taming') });
  assert.match(tamingHtml, /Related guides/);
  const tamingRelated = tamingHtml.match(/class="guide-related"[\s\S]*?<\/nav>/);
  assert.ok(tamingRelated);
  assert.match(tamingRelated[0], /href="\/guides\/beginners"/);
  assert.match(tamingRelated[0], /href="\/guides\/breeding-mutations"/);
  assert.match(tamingRelated[0], /href="\/guides\/resource-locations"/);
  assert.equal((tamingRelated[0].match(/href="\/guides\//g) || []).length, 3);

  const breedingHtml = renderGuidePage({ guide: resolveGuide('breeding-mutations') });
  assert.match(breedingHtml, /Related guides/);
  const breedingRelated = breedingHtml.match(/class="guide-related"[\s\S]*?<\/nav>/);
  assert.ok(breedingRelated);
  assert.match(breedingRelated[0], /href="\/guides\/taming"/);
  assert.match(breedingRelated[0], /href="\/guides\/beginners"/);
  assert.match(breedingRelated[0], /href="\/guides\/boss-strategies"/);
  assert.equal((breedingRelated[0].match(/href="\/guides\//g) || []).length, 3);

  const resourceHtml = renderGuidePage({ guide: resolveGuide('resource-locations') });
  assert.match(resourceHtml, /Related guides/);
  const resourceRelated = resourceHtml.match(/class="guide-related"[\s\S]*?<\/nav>/);
  assert.ok(resourceRelated);
  assert.match(resourceRelated[0], /href="\/guides\/taming"/);
  assert.match(resourceRelated[0], /href="\/guides\/beginners"/);
  assert.match(resourceRelated[0], /href="\/guides\/boss-strategies"/);
  assert.equal((resourceRelated[0].match(/href="\/guides\//g) || []).length, 3);

  const bossHtml = renderGuidePage({ guide: resolveGuide('boss-strategies') });
  assert.match(bossHtml, /Related guides/);
  const bossRelated = bossHtml.match(/class="guide-related"[\s\S]*?<\/nav>/);
  assert.ok(bossRelated);
  assert.match(bossRelated[0], /href="\/guides\/breeding-mutations"/);
  assert.match(bossRelated[0], /href="\/guides\/taming"/);
  assert.match(bossRelated[0], /href="\/guides\/resource-locations"/);
  assert.equal((bossRelated[0].match(/href="\/guides\//g) || []).length, 3);

  const scorchedHtml = renderGuidePage({ guide: resolveGuide('scorched-earth-progression') });
  assert.match(scorchedHtml, /Related guides/);
  const scorchedRelated = scorchedHtml.match(/class="guide-related"[\s\S]*?<\/nav>/);
  assert.ok(scorchedRelated);
  assert.match(scorchedRelated[0], /href="\/guides\/boss-strategies"/);
  assert.match(scorchedRelated[0], /href="\/guides\/resource-locations"/);
  assert.match(scorchedRelated[0], /href="\/guides\/beginners"/);
  assert.match(scorchedRelated[0], /href="\/guides\/aberration-progression"/);
  assert.equal((scorchedRelated[0].match(/href="\/guides\//g) || []).length, 4);

  const withKnown = renderGuidePage({
    guide: {
      slug: 'x',
      title: 'X',
      shortTitle: 'X',
      description: 'd',
      lastVerified: '2026-08-16',
      related: ['nope', 'beginners', 'also-missing'],
      sections: [],
    },
  });
  assert.match(withKnown, /Related guides/);
  assert.match(withKnown, /href="\/guides\/beginners"/);
  assert.doesNotMatch(withKnown, /href="\/guides\/nope"/);
});

test('renderGuideNotFoundPage is a shell-wrapped 404 that escapes the slug and lists guides', () => {
  const html = renderGuideNotFoundPage({ slug: '<script>nope</script>' });
  assert.match(html, /Guide not found/);
  assert.doesNotMatch(html, /<script>nope<\/script>/);
  assert.match(html, /&lt;script&gt;nope&lt;\/script&gt;/);
  assert.match(html, /href="\/guides\/beginners"/);
  assert.match(html, /href="\/guides\/taming"/);
  assert.match(html, /href="\/guides\/resource-locations"/);
  assert.match(html, /href="\/guides\/settings-performance"/);
  assert.match(html, /href="\/guides\/breeding-mutations"/);
  assert.match(html, /href="\/guides\/boss-strategies"/);
  assert.match(html, /href="\/guides\/scorched-earth-progression"/);
  assert.match(html, /href="\/guides"/);
});

const MAP_RESOURCE_HEADINGS = [
  'What this map is like',
  'Where the biomes put resources',
  'Tools and what they favor',
  'Hauling and logistics',
  'Hazards while farming',
  'First-week priorities',
];

test('renderGuidePage renders the-island-resources h1, headings, and cross-links', () => {
  const html = renderGuidePage({ guide: resolveGuide('the-island-resources') });
  assert.match(html, /<h1>The Island Resources Guide \u2014 ARK: Survival Ascended<\/h1>/);
  assert.match(html, /Last verified 2026-08-23/);
  for (const heading of MAP_RESOURCE_HEADINGS) {
    assert.match(html, new RegExp(`<h2>${escapeRegExp(heading)}</h2>`));
  }
  assert.match(html, /href="\/guides\/resource-locations"/);
  assert.match(html, /href="\/maps\/the-island"/);
  assert.match(html, /href="\/guides\/scorched-earth-resources"/);
  assert.match(html, /href="\/guides\/aberration-resources"/);
  assert.match(html, /href="\/guides\/the-center-resources"/);
});

test('renderGuidePage renders scorched-earth-resources h1, headings, and cross-links', () => {
  const html = renderGuidePage({ guide: resolveGuide('scorched-earth-resources') });
  assert.match(html, /<h1>Scorched Earth Resources Guide \u2014 ARK: Survival Ascended<\/h1>/);
  for (const heading of MAP_RESOURCE_HEADINGS) {
    assert.match(html, new RegExp(`<h2>${escapeRegExp(heading)}</h2>`));
  }
  assert.match(html, /href="\/guides\/resource-locations"/);
  assert.match(html, /href="\/maps\/scorched-earth"/);
  assert.match(html, /href="\/guides\/scorched-earth-progression"/);
});

test('renderGuidePage renders aberration-resources h1, headings, and cross-links', () => {
  const html = renderGuidePage({ guide: resolveGuide('aberration-resources') });
  assert.match(html, /<h1>Aberration Resources Guide \u2014 ARK: Survival Ascended<\/h1>/);
  for (const heading of MAP_RESOURCE_HEADINGS) {
    assert.match(html, new RegExp(`<h2>${escapeRegExp(heading)}</h2>`));
  }
  assert.match(html, /href="\/guides\/resource-locations"/);
  assert.match(html, /href="\/maps\/aberration"/);
  assert.match(html, /href="\/guides\/aberration-progression"/);
});

test('renderGuidePage renders the-center-resources h1, headings, and cross-links', () => {
  const html = renderGuidePage({ guide: resolveGuide('the-center-resources') });
  assert.match(html, /<h1>The Center Resources Guide \u2014 ARK: Survival Ascended<\/h1>/);
  for (const heading of MAP_RESOURCE_HEADINGS) {
    assert.match(html, new RegExp(`<h2>${escapeRegExp(heading)}</h2>`));
  }
  assert.match(html, /href="\/guides\/resource-locations"/);
  assert.match(html, /href="\/maps\/the-center"/);
  assert.match(html, /href="\/guides\/the-island-resources"/);
  assert.match(html, /href="\/guides\/ragnarok-resources"/);
});

test('renderGuidePage renders ragnarok-resources h1, headings, and cross-links', () => {
  const html = renderGuidePage({ guide: resolveGuide('ragnarok-resources') });
  assert.match(html, /<h1>Ragnarok Resources Guide \u2014 ARK: Survival Ascended<\/h1>/);
  for (const heading of MAP_RESOURCE_HEADINGS) {
    assert.match(html, new RegExp(`<h2>${escapeRegExp(heading)}</h2>`));
  }
  assert.match(html, /href="\/guides\/resource-locations"/);
  assert.match(html, /href="\/maps\/ragnarok"/);
  assert.match(html, /href="\/guides\/scorched-earth-resources"/);
});

test('renderGuidePage renders extinction-resources h1, headings, and cross-links', () => {
  const html = renderGuidePage({ guide: resolveGuide('extinction-resources') });
  assert.match(html, /<h1>Extinction Resources Guide \u2014 ARK: Survival Ascended<\/h1>/);
  for (const heading of MAP_RESOURCE_HEADINGS) {
    assert.match(html, new RegExp(`<h2>${escapeRegExp(heading)}</h2>`));
  }
  assert.match(html, /href="\/guides\/resource-locations"/);
  assert.match(html, /href="\/maps\/extinction"/);
  assert.match(html, /href="\/guides\/extinction-progression"/);
  assert.doesNotMatch(html, /href="\/guides\/genesis-resources"/);
});
