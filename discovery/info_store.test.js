'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  openInfoDb,
  newsEntryHash,
  recordInfoCycle,
  recordInfoFetchFailure,
  getFeedsMeta,
  getCurrentRates,
  getRecentRateChanges,
  getNewsEntries,
  getNewsEntry,
  hasRateData,
  hasNewsData,
} = require('./info_store.js');

function officialRates(extra = {}) {
  return {
    official: {
      TamingSpeedMultiplier: 2,
      HarvestAmountMultiplier: 2,
      XPMultiplier: 2,
      DisableWorldBuffs: 'MATINGINTERVAL_DOWN_HARD',
      bEnableDinoStackingDetection: 'True',
      ...extra,
    },
  };
}

function newsList(extra = []) {
  return [
    {
      type: 'CTA',
      imagePath: 'https://cdn.example/a.jpg',
      title: null,
      body: null,
      action: 'Link::https://survivetheark.com/index.php?/articles.html/community-crunch-519-tusk-tusk-boom-r2553/',
      url: 'https://survivetheark.com/index.php?/articles.html/community-crunch-519-tusk-tusk-boom-r2553/',
    },
    {
      type: 'DLC',
      imagePath: 'https://cdn.example/b.jpg',
      title: null,
      body: null,
      action: 'DLC::Dragontopia',
      url: null,
    },
    ...extra,
  ];
}

test('recordInfoCycle writes a current snapshot and no change log on the first poll', () => {
  const db = openInfoDb(':memory:');
  recordInfoCycle(db, { rates: officialRates() }, { now: () => '2026-08-16T00:00:00.000Z' });
  const snap = getCurrentRates(db);
  assert.equal(snap.official.TamingSpeedMultiplier, 2);
  assert.equal(snap.official.bEnableDinoStackingDetection, 'True');
  assert.equal(getRecentRateChanges(db).length, 0);
  assert.equal(getFeedsMeta(db).cycles_total, 1);
  assert.equal(getFeedsMeta(db).last_fetch_status, 'ok');
  assert.equal(hasRateData(db), true);
});

test('change log is written only when a value actually changes', () => {
  const db = openInfoDb(':memory:');
  recordInfoCycle(db, { rates: officialRates() }, { now: () => '2026-08-16T00:00:00.000Z' });
  recordInfoCycle(db, { rates: officialRates() }, { now: () => '2026-08-16T00:10:00.000Z' });
  assert.equal(getRecentRateChanges(db).length, 0);

  recordInfoCycle(
    db,
    { rates: officialRates({ TamingSpeedMultiplier: 3, XPMultiplier: 2 }) },
    { now: () => '2026-08-16T00:20:00.000Z' }
  );
  const changes = getRecentRateChanges(db);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].variant, 'official');
  assert.equal(changes[0].key, 'TamingSpeedMultiplier');
  assert.equal(changes[0].old, 2);
  assert.equal(changes[0].new, 3);
  assert.equal(changes[0].changedAt, '2026-08-16T00:20:00.000Z');
  assert.equal(getCurrentRates(db).official.TamingSpeedMultiplier, 3);
});

test('a new key on a later poll is logged; a dropped key leaves the snapshot', () => {
  const db = openInfoDb(':memory:');
  recordInfoCycle(db, { rates: officialRates() }, { now: () => '2026-08-16T01:00:00.000Z' });
  recordInfoCycle(
    db,
    { rates: { official: { TamingSpeedMultiplier: 2, HexagonRewardMultiplier: 1 } } },
    { now: () => '2026-08-16T01:10:00.000Z' }
  );
  const snap = getCurrentRates(db).official;
  assert.equal(snap.TamingSpeedMultiplier, 2);
  assert.equal(snap.HexagonRewardMultiplier, 1);
  assert.equal(snap.XPMultiplier, undefined);
  const keys = getRecentRateChanges(db).map((c) => c.key).sort();
  assert.ok(keys.includes('HexagonRewardMultiplier'));
  assert.ok(keys.includes('XPMultiplier'));
});

test('news first_seen is stable across polls and last_seen updates', () => {
  const db = openInfoDb(':memory:');
  const entries = newsList();
  const hash = newsEntryHash(entries[0]);
  recordInfoCycle(db, { news: entries }, { now: () => '2026-08-16T02:00:00.000Z' });
  recordInfoCycle(
    db,
    { news: [{ ...entries[0], title: 'ignored for identity' }, entries[1]] },
    { now: () => '2026-08-16T02:10:00.000Z' }
  );
  const row = getNewsEntry(db, hash);
  assert.equal(row.firstSeen, '2026-08-16T02:00:00.000Z');
  assert.equal(row.lastSeen, '2026-08-16T02:10:00.000Z');
  assert.equal(row.active, true);
  assert.equal(getNewsEntries(db)[0].firstSeen >= getNewsEntries(db)[1].firstSeen, true);
});

test('entries absent from a later poll are kept and flagged inactive', () => {
  const db = openInfoDb(':memory:');
  const entries = newsList();
  const droppedHash = newsEntryHash(entries[1]);
  recordInfoCycle(db, { news: entries }, { now: () => '2026-08-16T03:00:00.000Z' });
  recordInfoCycle(db, { news: [entries[0]] }, { now: () => '2026-08-16T03:10:00.000Z' });
  const dropped = getNewsEntry(db, droppedHash);
  assert.equal(dropped.active, false);
  assert.equal(dropped.firstSeen, '2026-08-16T03:00:00.000Z');
  assert.equal(dropped.lastSeen, '2026-08-16T03:00:00.000Z');
  assert.equal(getNewsEntry(db, newsEntryHash(entries[0])).active, true);
  assert.equal(hasNewsData(db), true);
  assert.equal(getNewsEntries(db).length, 2);
});

test('a failed news fetch does not flag existing entries inactive', () => {
  const db = openInfoDb(':memory:');
  recordInfoCycle(db, { news: newsList() }, { now: () => '2026-08-16T04:00:00.000Z' });
  recordInfoCycle(
    db,
    { rates: officialRates(), news: null, errors: { news: 'HTTP 500' } },
    { now: () => '2026-08-16T04:10:00.000Z' }
  );
  assert.equal(getNewsEntries(db).every((e) => e.active), true);
  assert.match(getFeedsMeta(db).last_fetch_status, /partial/);
});

test('recordInfoFetchFailure updates status without bumping cycles_total', () => {
  const db = openInfoDb(':memory:');
  recordInfoCycle(db, { rates: officialRates() }, { now: () => '2026-08-16T05:00:00.000Z' });
  const meta = recordInfoFetchFailure(db, { now: () => '2026-08-16T05:10:00.000Z', error: 'cdn down' });
  assert.equal(meta.cycles_total, 1);
  assert.match(meta.last_fetch_status, /cdn down/);
  assert.equal(getCurrentRates(db).official.TamingSpeedMultiplier, 2);
});
