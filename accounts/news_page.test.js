'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderNewsPage, displayTitle, humanizeArticleSlug, humanizeDlcName } = require('./news_page.js');

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
  assert.doesNotMatch(html, /<img\b/i);
  assert.doesNotMatch(html, /cdn2\.arkdedicated\.com\/media/);
});

test('renderNewsPage falls back when the feed is unavailable', () => {
  const html = renderNewsPage({ feedAvailable: false });
  assert.match(html, /News data isn't available right now/);
  assert.doesNotMatch(html, /Community Crunch/);
});
