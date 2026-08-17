'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseRatesIni,
  parseNewsIni,
  parseEntryData,
  parseOnClickedAction,
  fetchInfoFeeds,
  RATE_FEED_URLS,
  NEWS_FEED_URL,
} = require('./info_feeds.js');

// Captured from the live official dynamicconfig.ini on 2026-08-16
// (bonus-rate event: 2.0x taming/harvest/XP). Includes the string
// DisableWorldBuffs line and the bEnable boolean-as-string.
const LIVE_OFFICIAL_RATES = `TributeItemExpirationSeconds=604800 
TributeDinoExpirationSeconds=604800 
TamingSpeedMultiplier=2.0 
HarvestAmountMultiplier=2.0 
XPMultiplier=2.0 
MatingIntervalMultiplier=0.5 
BabyMatureSpeedMultiplier=2.0 
EggHatchSpeedMultiplier=2.0 
BabyCuddleIntervalMultiplier=0.6 
BabyImprintAmountMultiplier=2.0 
HexagonRewardMultiplier=1.0 
DisableWorldBuffs=MATINGINTERVAL_DOWN_HARD,MATINGINTERVAL_DOWN_MEDIUM,MATINGINTERVAL_DOWN_EASY,BABYMATURE_BOON_EASY,BABYMATURE_BOON_MEDIUM,BABYMATURE_BOON_HARD 
bEnableDinoStackingDetection=True
`;

const NEWS_FIXTURE = `news=((EntryWidgetTemplate="CTA",ImagePath="https://cdn2.arkdedicated.com/media/crunch/ASA_Boaratos_NewsCTA_870x450.jpg",OnClickedAction="Link::https://survivetheark.com/index.php?/articles.html/community-crunch-519-tusk-tusk-boom-r2553/"),(EntryWidgetTemplate="CTA",ImagePath="https://cdn2.arkdedicated.com/media/crunch/ASA_Lumina_Umbra_NewsCTA_870x450.jpg",OnClickedAction="DLC::Dragontopia"),(EntryWidgetTemplate="NEWS",ImagePath="https://cdn2.arkdedicated.com/media/keyart/ASA_KeyArt_NewsPost_450x450_low.jpg",EntryData="title=Code of Conduct|body=When playing on our Official Server Network, please be sure to abide by our Code of Conduct available at ark.gg/CoC",OnClickedAction="Link::https://survivetheark.com/index.php?/code-of-conduct/"),(EntryWidgetTemplate="CTA",UnknownField="whatever",NotAPair,OnClickedAction="Warp::Somewhere"))`;

test('parseRatesIni parses live official values, keeps DisableWorldBuffs as a string, and leaves bEnable as a string', () => {
  const rates = parseRatesIni(LIVE_OFFICIAL_RATES);
  assert.equal(rates.TamingSpeedMultiplier, 2);
  assert.equal(rates.HarvestAmountMultiplier, 2);
  assert.equal(rates.XPMultiplier, 2);
  assert.equal(rates.MatingIntervalMultiplier, 0.5);
  assert.equal(rates.BabyCuddleIntervalMultiplier, 0.6);
  assert.equal(rates.HexagonRewardMultiplier, 1);
  assert.equal(rates.TributeItemExpirationSeconds, 604800);
  assert.equal(typeof rates.TamingSpeedMultiplier, 'number');
  assert.equal(typeof rates.DisableWorldBuffs, 'string');
  assert.match(rates.DisableWorldBuffs, /MATINGINTERVAL_DOWN_HARD/);
  assert.equal(rates.bEnableDinoStackingDetection, 'True');
  assert.equal(typeof rates.bEnableDinoStackingDetection, 'string');
});

test('parseRatesIni skips blanks, comments, and malformed lines', () => {
  const rates = parseRatesIni('# comment\n; also\n\n=novalue\nOnlyKey\nGood=3.5\n');
  assert.deepEqual(rates, { Good: 3.5 });
});

test('parseRatesIni returns an empty object for null/empty input', () => {
  assert.deepEqual(parseRatesIni(null), {});
  assert.deepEqual(parseRatesIni(''), {});
});

test('parseNewsIni covers Link::, DLC::, EntryData title/body, and a malformed unknown-field entry', () => {
  const entries = parseNewsIni(NEWS_FIXTURE);
  assert.equal(entries.length, 4);

  assert.equal(entries[0].type, 'CTA');
  assert.match(entries[0].imagePath, /ASA_Boaratos/);
  assert.equal(entries[0].title, null);
  assert.equal(entries[0].body, null);
  assert.equal(entries[0].action, 'Link::https://survivetheark.com/index.php?/articles.html/community-crunch-519-tusk-tusk-boom-r2553/');
  assert.equal(entries[0].url, 'https://survivetheark.com/index.php?/articles.html/community-crunch-519-tusk-tusk-boom-r2553/');

  assert.equal(entries[1].type, 'CTA');
  assert.equal(entries[1].action, 'DLC::Dragontopia');
  assert.equal(entries[1].url, null);
  assert.equal(entries[1].title, null);

  assert.equal(entries[2].type, 'NEWS');
  assert.equal(entries[2].title, 'Code of Conduct');
  assert.match(entries[2].body, /Code of Conduct available at ark\.gg\/CoC/);
  assert.equal(entries[2].action.startsWith('Link::'), true);
  assert.equal(entries[2].url, 'https://survivetheark.com/index.php?/code-of-conduct/');

  assert.equal(entries[3].type, 'CTA');
  assert.equal(entries[3].action, 'Warp::Somewhere');
  assert.equal(entries[3].url, null);
  assert.equal(entries[3].imagePath, null);
});

test('parseNewsIni tolerates a missing-field image-only CTA and empty/malformed input', () => {
  const onlyImage = parseNewsIni(
    'news=((EntryWidgetTemplate="CTA",ImagePath="https://cdn2.arkdedicated.com/media/evo/bonus.jpg"))'
  );
  assert.equal(onlyImage.length, 1);
  assert.equal(onlyImage[0].type, 'CTA');
  assert.equal(onlyImage[0].imagePath, 'https://cdn2.arkdedicated.com/media/evo/bonus.jpg');
  assert.equal(onlyImage[0].action, null);
  assert.equal(onlyImage[0].url, null);
  assert.equal(onlyImage[0].title, null);
  assert.equal(onlyImage[0].body, null);

  assert.deepEqual(parseNewsIni(''), []);
  assert.deepEqual(parseNewsIni('news=()'), []);
  assert.deepEqual(parseNewsIni('not a feed'), []);
});

test('parseEntryData and parseOnClickedAction handle missing pieces', () => {
  assert.deepEqual(parseEntryData(null), { title: null, body: null });
  assert.deepEqual(parseEntryData('title=Hello'), { title: 'Hello', body: null });
  assert.deepEqual(parseOnClickedAction(null), { action: null, url: null });
  assert.deepEqual(parseOnClickedAction('Link::'), { action: 'Link::', url: null });
  assert.deepEqual(parseOnClickedAction('DLC::LostColonyBundle'), { action: 'DLC::LostColonyBundle', url: null });
});

test('fetchInfoFeeds uses the injectable fetch and parses each variant plus news', async () => {
  const seen = [];
  const httpGet = async (url) => {
    seen.push(url);
    if (url === RATE_FEED_URLS.official) return { status: 200, body: LIVE_OFFICIAL_RATES };
    if (url === RATE_FEED_URLS.arkpocalypse) return { status: 200, body: 'TamingSpeedMultiplier=5.0\n' };
    if (url === RATE_FEED_URLS.smalltribes) return { status: 200, body: 'TamingSpeedMultiplier=4.5\n' };
    if (url === RATE_FEED_URLS.conquest) return { status: 200, body: 'TamingSpeedMultiplier=6.0\n' };
    if (url === NEWS_FEED_URL) return { status: 200, body: NEWS_FIXTURE };
    return { status: 404, body: 'nope' };
  };
  const result = await fetchInfoFeeds({ httpGet, sleep: async () => {}, retry: { attempts: 1, baseDelayMs: 0 } });
  assert.equal(result.rates.official.TamingSpeedMultiplier, 2);
  assert.equal(result.rates.arkpocalypse.TamingSpeedMultiplier, 5);
  assert.equal(result.rates.smalltribes.TamingSpeedMultiplier, 4.5);
  assert.equal(result.rates.conquest.TamingSpeedMultiplier, 6);
  assert.equal(result.news.length, 4);
  assert.deepEqual(result.errors, {});
  assert.equal(seen.length, 5);
});

test('fetchInfoFeeds isolates a single variant failure and still returns the rest', async () => {
  const httpGet = async (url) => {
    if (url === RATE_FEED_URLS.conquest) return { status: 500, body: 'nope' };
    if (url === NEWS_FEED_URL) return { status: 200, body: NEWS_FIXTURE };
    return { status: 200, body: 'XPMultiplier=1.0\n' };
  };
  const result = await fetchInfoFeeds({ httpGet, sleep: async () => {}, retry: { attempts: 1, baseDelayMs: 0 } });
  assert.equal(result.rates.official.XPMultiplier, 1);
  assert.equal(result.rates.conquest, undefined);
  assert.equal(result.news.length, 4);
  assert.match(result.errors.conquest, /HTTP 500/);
  assert.equal(result.errors.news, undefined);
});
