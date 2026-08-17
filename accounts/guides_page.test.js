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

test('renderGuidesIndexPage lists the beginners card with a link and last-verified date', () => {
  const html = renderGuidesIndexPage({});
  assert.match(html, /<title>Guides \u2014 ArkHelper<\/title>/);
  assert.match(html, /meta name="description"/);
  assert.match(html, /href="\/guides\/beginners"/);
  assert.match(html, /Beginner&#39;s Guide/);
  assert.match(html, /Last verified 2026-08-16/);
  assert.match(html, /class="guide-card"/);
  assert.match(html, /First spawn to first tame/);
});

test('renderGuidePage renders the h1, all 8 headings, the callout, and escaped content', () => {
  const html = renderGuidePage({ guide: resolveGuide('beginners') });
  assert.match(html, /<h1>Beginner&#39;s Guide \u2014 ARK: Survival Ascended<\/h1>/);
  assert.match(html, /Last verified 2026-08-16/);
  for (const heading of SECTION_HEADINGS) {
    assert.match(html, new RegExp(`<h2>${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</h2>`));
  }
  assert.match(html, /class="callout"/);
  assert.match(html, /If a spawn goes badly/);
  assert.match(html, /href="\/lists\/official-pve"/);
  assert.match(html, /href="\/guides\/taming"/);
  assert.match(html, /Start PvE; switch later if the quiet bothers you\./);

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

test('related footer with unknown slugs renders without error and omits missing guides', () => {
  const html = renderGuidePage({ guide: resolveGuide('beginners') });
  assert.doesNotMatch(html, /Related guides/);
  assert.doesNotMatch(html, /href="\/guides\/taming".*Related/);
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
  assert.match(html, /href="\/guides"/);
});
