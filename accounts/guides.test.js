'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GUIDE_REGISTRY, resolveGuide } = require('./guides.js');
const { getListDef } = require('./server_lists.js');
const { MAP_REGISTRY } = require('./maps.js');

const REQUIRED_FIELDS = ['slug', 'title', 'shortTitle', 'description', 'lastVerified', 'related', 'sections'];
const BLOCK_TYPES = new Set(['p', 'list', 'callout', 'links']);
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
  assert.equal(GUIDE_REGISTRY.length, 2);
  assert.ok(slugs.includes('beginners'));
  assert.ok(slugs.includes('taming'));
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
});
