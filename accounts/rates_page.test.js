'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderRatesPage, hasBonusRates, formatRateValue } = require('./rates_page.js');

function liveBonusFeed() {
  return {
    variants: {
      official: {
        TamingSpeedMultiplier: 2,
        HarvestAmountMultiplier: 2,
        XPMultiplier: 2,
        MatingIntervalMultiplier: 0.5,
        HexagonRewardMultiplier: 1,
        DisableWorldBuffs: 'MATINGINTERVAL_DOWN_HARD',
        bEnableDinoStackingDetection: 'True',
      },
      arkpocalypse: { TamingSpeedMultiplier: 5, XPMultiplier: 5 },
      smalltribes: { TamingSpeedMultiplier: 4.5, XPMultiplier: 4.5 },
      conquest: { TamingSpeedMultiplier: 6, XPMultiplier: 6 },
    },
    changes: [
      {
        variant: 'official',
        key: 'TamingSpeedMultiplier',
        old: 1,
        new: 2,
        changedAt: '2026-08-14T00:00:00.000Z',
      },
    ],
    lastFetchAt: '2026-08-16T12:00:00.000Z',
  };
}

test('hasBonusRates is true when any official multiplier is not 1.0', () => {
  assert.equal(hasBonusRates({ TamingSpeedMultiplier: 2, HexagonRewardMultiplier: 1 }), true);
  assert.equal(hasBonusRates({ TamingSpeedMultiplier: 1, XPMultiplier: 1 }), false);
  assert.equal(hasBonusRates({ DisableWorldBuffs: 'x' }), false);
  assert.equal(hasBonusRates(null), false);
});

test('formatRateValue uses a multiply sign for multiplier keys', () => {
  assert.equal(formatRateValue('TamingSpeedMultiplier', 2), '2\u00d7');
  assert.equal(formatRateValue('TributeItemExpirationSeconds', 604800), '604800');
  assert.equal(formatRateValue('bEnableDinoStackingDetection', 'True'), 'True');
});

test('renderRatesPage shows the live bonus-rate banner, variant cards, and change history', () => {
  const html = renderRatesPage({ feedAvailable: true, feed: liveBonusFeed() });
  assert.match(html, /Bonus rates active/);
  assert.match(html, /Official/);
  assert.match(html, /Arkpocalypse/);
  assert.match(html, /Small Tribes/);
  assert.match(html, /Conquest/);
  assert.match(html, /2\u00d7/);
  assert.match(html, /5\u00d7/);
  assert.match(html, /4\.5\u00d7/);
  assert.match(html, /6\u00d7/);
  assert.match(html, /TamingSpeedMultiplier/);
  assert.match(html, /1 \u2192 2/);
  assert.match(html, /2026-08-14 00:00:00 UTC/);
  assert.doesNotMatch(html, /<img\b/i);
});

test('renderRatesPage falls back when the feed is unavailable', () => {
  const html = renderRatesPage({ feedAvailable: false });
  assert.match(html, /Rate data isn't available right now/);
  assert.doesNotMatch(html, /Bonus rates active/);
});
