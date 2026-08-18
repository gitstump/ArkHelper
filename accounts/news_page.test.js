'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderNewsPage, resolveNewsImageUrl, displayTitle, humanizeArticleSlug, humanizeDlcName } = require('./news_page.js');
const { renderRatesPage } = require('./rates_page.js');

function liveNewsFeed() {
  return {
    entries: [
      {
        type: 'CTA',
        imagePath: 'https://cdn2.arkdedicated.com/media/crunch/ASA_Boaratos_NewsCTA_870x450.jpg',
        title: null,
        body: null,
        action: 'Link::https://survivetheark.com/index.php?/articles.html/community-crunch-519-tusk-tusk-boom-r2553/',
        url: 'https://survivetheark.com/index.php?/articles.html/community-crunch-519-tusk-tusk-boom-r2553/',
        firstSeen: '2026-08-16T10:00:00.000Z',
        lastSeen: '2026-08-16T12:00:00.000Z',
        active: true,
      },
      {
        type: 'NEWS',
        imagePath: 'https://cdn2.arkdedicated.com/media/keyart/ASA_KeyArt_NewsPost_450x450_low.jpg',
        title: 'Code of Conduct',
        body: 'When playing on our Official Server Network, please be sure to abide by our Code of Conduct available at ark.gg/CoC',
        action: 'Link::https://survivetheark.com/index.php?/code-of-conduct/',
        url: 'https://survivetheark.com/index.php?/code-of-conduct/',
        firstSeen: '2026-08-15T00:00:00.000Z',
        lastSeen: '2026-08-16T12:00:00.000Z',
        active: true,
      },
      {
        type: 'CTA',
        imagePath: 'https://cdn2.arkdedicated.com/media/crunch/ASA_Dragontopia_Available_Now_NewsCTA_870x450.jpg',
        title: null,
        body: null,
        action: 'DLC::Dragontopia',
        url: null,
        firstSeen: '2026-08-10T00:00:00.000Z',
        lastSeen: '2026-08-16T12:00:00.000Z',
        active: true,
      },
      {
        type: 'CTA',
        imagePath: 'https://cdn2.arkdedicated.com/media/crunch/ASA_LostColony_NewsCTA_870x450_low.jpg',
        title: null,
        body: null,
        action: 'DLC::LostColonyBundle',
        url: null,
        firstSeen: '2026-08-01T00:00:00.000Z',
        lastSeen: '2026-08-01T00:00:00.000Z',
        active: false,
      },
    ],
  };
}

test('humanizeArticleSlug turns a survivetheark crunch slug into a title', () => {
  assert.equal(humanizeArticleSlug('community-crunch-519-tusk-tusk-boom'), 'Community Crunch 519: Tusk Tusk Boom');
  assert.equal(humanizeArticleSlug('community-crunch-518-long-live-the-king'), 'Community Crunch 518: Long Live The King');
});

test('humanizeDlcName splits camel-case DLC identifiers', () => {
  assert.equal(humanizeDlcName('LostColonyBundle'), 'Lost Colony Bundle');
  assert.equal(humanizeDlcName('Dragontopia'), 'Dragontopia');
  assert.equal(humanizeDlcName('Genesis'), 'Genesis');
});

test('displayTitle prefers EntryData, then the article slug, then the DLC name', () => {
  assert.equal(displayTitle({ title: 'Code of Conduct' }), 'Code of Conduct');
  assert.equal(
    displayTitle({
      title: null,
      url: 'https://survivetheark.com/index.php?/articles.html/community-crunch-519-tusk-tusk-boom-r2553/',
    }),
    'Community Crunch 519: Tusk Tusk Boom'
  );
  assert.equal(displayTitle({ title: null, action: 'DLC::Dragontopia' }), 'Dragontopia');
  assert.equal(displayTitle({ title: null, action: 'DLC::LostColonyBundle' }), 'Lost Colony Bundle');
  assert.equal(displayTitle({ title: null, action: null, url: null }), 'Announcement');
});

test('renderNewsPage lists titles, bodies, outbound Link:: URLs, and first-seen stamps', () => {
  const html = renderNewsPage({ feedAvailable: true, feed: liveNewsFeed() });
  assert.match(html, /Community Crunch 519: Tusk Tusk Boom/);
  assert.match(html, /href="https:\/\/survivetheark\.com\/index\.php\?\/articles\.html\/community-crunch-519-tusk-tusk-boom-r2553\/"/);
  assert.match(html, /Code of Conduct/);
  assert.match(html, /abide by our Code of Conduct/);
  assert.match(html, /Dragontopia/);
  assert.match(html, /Lost Colony Bundle/);
  assert.match(html, /first seen 2026-08-16/);
});

test('renderNewsPage falls back when the feed is unavailable', () => {
  const html = renderNewsPage({ feedAvailable: false });
  assert.match(html, /News data isn't available right now/);
  assert.doesNotMatch(html, /Community Crunch/);
});

test('resolveNewsImageUrl resolves a relative path against the official CDN', () => {
  assert.equal(
    resolveNewsImageUrl('media/crunch/ASA_Boaratos_NewsCTA_870x450.jpg'),
    'https://cdn2.arkdedicated.com/media/crunch/ASA_Boaratos_NewsCTA_870x450.jpg'
  );
  assert.equal(
    resolveNewsImageUrl('/media/crunch/ASA_Boaratos_NewsCTA_870x450.jpg'),
    'https://cdn2.arkdedicated.com/media/crunch/ASA_Boaratos_NewsCTA_870x450.jpg'
  );
});

test('resolveNewsImageUrl passes an absolute https URL on an allowed host', () => {
  assert.equal(
    resolveNewsImageUrl('https://cdn2.arkdedicated.com/media/crunch/ASA_Boaratos_NewsCTA_870x450.jpg'),
    'https://cdn2.arkdedicated.com/media/crunch/ASA_Boaratos_NewsCTA_870x450.jpg'
  );
  assert.equal(
    resolveNewsImageUrl('https://media.arkdedicated.com/promo.jpg'),
    'https://media.arkdedicated.com/promo.jpg'
  );
});

test('resolveNewsImageUrl rejects empty, http, other-host, lookalike, and traversal paths', () => {
  assert.equal(resolveNewsImageUrl(null), null);
  assert.equal(resolveNewsImageUrl(''), null);
  assert.equal(resolveNewsImageUrl('   '), null);
  assert.equal(resolveNewsImageUrl('http://cdn2.arkdedicated.com/media/foo.jpg'), null);
  assert.equal(resolveNewsImageUrl('https://evil.example/pwn.jpg'), null);
  assert.equal(resolveNewsImageUrl('https://arkdedicated.com.evil.com/foo.jpg'), null);
  assert.equal(resolveNewsImageUrl('https://cdn2.arkdedicated.com.evil.com/foo.jpg'), null);
  assert.equal(resolveNewsImageUrl('https://cdn2.arkdedicated.com/media/../secret.jpg'), null);
  assert.equal(resolveNewsImageUrl('../../etc/passwd'), null);
  assert.equal(resolveNewsImageUrl('/media/../foo.jpg'), null);
});

test('an entry with a resolvable imagePath renders a lazy thumbnail', () => {
  const html = renderNewsPage({
    feedAvailable: true,
    feed: {
      entries: [
        {
          type: 'CTA',
          imagePath: 'https://cdn2.arkdedicated.com/media/crunch/ASA_Boaratos_NewsCTA_870x450.jpg',
          title: null,
          body: null,
          action: 'Link::https://survivetheark.com/index.php?/articles.html/community-crunch-519-tusk-tusk-boom-r2553/',
          url: 'https://survivetheark.com/index.php?/articles.html/community-crunch-519-tusk-tusk-boom-r2553/',
          firstSeen: '2026-08-16T10:00:00.000Z',
          active: true,
        },
      ],
    },
  });
  assert.match(
    html,
    /<img src="https:\/\/cdn2\.arkdedicated\.com\/media\/crunch\/ASA_Boaratos_NewsCTA_870x450\.jpg"/
  );
  assert.match(html, /<img [^>]*loading="lazy"/);
  assert.match(html, /<img [^>]*decoding="async"/);
  assert.match(html, /alt="Community Crunch 519: Tusk Tusk Boom"/);
  assert.match(html, /class="news-item has-image"/);
});

test('an entry without imagePath keeps the text-only row', () => {
  const html = renderNewsPage({
    feedAvailable: true,
    feed: {
      entries: [
        {
          type: 'NEWS',
          title: 'Code of Conduct',
          body: 'Please abide by our Code of Conduct.',
          action: 'Link::https://survivetheark.com/index.php?/code-of-conduct/',
          url: 'https://survivetheark.com/index.php?/code-of-conduct/',
          firstSeen: '2026-08-15T00:00:00.000Z',
          active: true,
        },
      ],
    },
  });
  assert.match(html, /Code of Conduct/);
  assert.match(html, /class="news-item"/);
  assert.doesNotMatch(html, /class="news-item has-image"/);
  const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
  assert.doesNotMatch(main, /<img\b/i);
});

test('a hostile imagePath renders the text-only row', () => {
  const html = renderNewsPage({
    feedAvailable: true,
    feed: {
      entries: [
        {
          type: 'CTA',
          imagePath: 'https://evil.example/pwn.jpg',
          title: 'Bonus rates',
          body: null,
          action: 'DLC::Dragontopia',
          url: null,
          firstSeen: '2026-08-10T00:00:00.000Z',
          active: true,
        },
      ],
    },
  });
  assert.match(html, /Bonus rates/);
  const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
  assert.doesNotMatch(main, /<img\b/i);
  assert.doesNotMatch(html, /evil\.example/);
  assert.doesNotMatch(html, /class="news-item has-image"/);
});

test('news imagery attribution is on /news and not on /rates', () => {
  const news = renderNewsPage({ feedAvailable: true, feed: liveNewsFeed() });
  const rates = renderRatesPage({
    feedAvailable: true,
    feed: { variants: { official: { TamingSpeedMultiplier: 1 } }, changes: [] },
  });
  assert.match(news, /Game imagery is from Studio Wildcard/);
  assert.match(news, /This site is unaffiliated/);
  assert.doesNotMatch(rates, /Game imagery is from Studio Wildcard/);
});
