'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveGuide } = require('./guides.js');
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
  assert.equal((html.match(/class="guide-card"/g) || []).length, 3);
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

test('related footer with unknown slugs renders without error and omits missing guides', () => {
  const html = renderGuidePage({ guide: resolveGuide('beginners') });
  assert.match(html, /Related guides/);
  const beginnersRelated = html.match(/class="guide-related"[\s\S]*?<\/nav>/);
  assert.ok(beginnersRelated);
  assert.match(beginnersRelated[0], /href="\/guides\/taming"/);
  assert.match(beginnersRelated[0], /href="\/guides\/resource-locations"/);
  assert.doesNotMatch(beginnersRelated[0], /settings-performance/);

  const tamingHtml = renderGuidePage({ guide: resolveGuide('taming') });
  assert.match(tamingHtml, /Related guides/);
  const tamingRelated = tamingHtml.match(/class="guide-related"[\s\S]*?<\/nav>/);
  assert.ok(tamingRelated);
  assert.match(tamingRelated[0], /href="\/guides\/beginners"/);
  assert.match(tamingRelated[0], /href="\/guides\/resource-locations"/);
  assert.doesNotMatch(tamingRelated[0], /breeding-mutations/);

  const resourceHtml = renderGuidePage({ guide: resolveGuide('resource-locations') });
  assert.match(resourceHtml, /Related guides/);
  const resourceRelated = resourceHtml.match(/class="guide-related"[\s\S]*?<\/nav>/);
  assert.ok(resourceRelated);
  assert.match(resourceRelated[0], /href="\/guides\/taming"/);
  assert.match(resourceRelated[0], /href="\/guides\/beginners"/);
  assert.doesNotMatch(resourceRelated[0], /boss-strategies/);

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
  assert.match(html, /href="\/guides"/);
});
