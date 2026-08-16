'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  WEIGHTS,
  RANKING_WINDOW_DAYS,
  PING_FULL_MS,
  PING_MID_MS,
  PING_HIGH_MS,
  PING_MID_FRACTION,
  PING_HIGH_FRACTION,
  PING_ABOVE_FRACTION,
  scoreServer,
} = require('./ranking.js');

function round1(n) {
  return Math.round(n * 10) / 10;
}

test('weights sum to 100 so a perfect server can score 100', () => {
  assert.equal(WEIGHTS.RELIABILITY + WEIGHTS.CONNECTION + WEIGHTS.ACTIVITY + WEIGHTS.CONFIDENCE, 100);
});

test('a perfect server scores 100 with full points in every component', () => {
  const result = scoreServer({
    uptimePercent: 100,
    pingMs: 40,
    avgPopulationPercent: 100,
    historyAgeDays: RANKING_WINDOW_DAYS,
  });
  assert.equal(result.rankScore, 100);
  assert.deepEqual(result.components, {
    reliability: WEIGHTS.RELIABILITY,
    connection: WEIGHTS.CONNECTION,
    activity: WEIGHTS.ACTIVITY,
    confidence: WEIGHTS.CONFIDENCE,
  });
});

test('a dead server (no uptime, no ping, empty, no history) scores 0', () => {
  const result = scoreServer({
    uptimePercent: 0,
    pingMs: null,
    avgPopulationPercent: 0,
    historyAgeDays: 0,
  });
  assert.equal(result.rankScore, 0);
  assert.deepEqual(result.components, {
    reliability: 0,
    connection: 0,
    activity: 0,
    confidence: 0,
  });
});

test('missing ping scores 0 for the connection component', () => {
  const withPing = scoreServer({ uptimePercent: 100, pingMs: 50, avgPopulationPercent: 50, historyAgeDays: 7 });
  const withoutPing = scoreServer({ uptimePercent: 100, pingMs: null, avgPopulationPercent: 50, historyAgeDays: 7 });
  assert.equal(withoutPing.components.connection, 0);
  assert.equal(withoutPing.rankScore, round1(withPing.rankScore - WEIGHTS.CONNECTION));
});

test('undefined / non-numeric ping is treated as missing, not as 0ms (which would be a perfect ping)', () => {
  assert.equal(scoreServer({ pingMs: undefined }).components.connection, 0);
  assert.equal(scoreServer({ pingMs: NaN }).components.connection, 0);
  assert.equal(scoreServer({ pingMs: -5 }).components.connection, 0);
  assert.equal(scoreServer({ pingMs: '60' }).components.connection, 0);
});

test('a brand-new server is capped by confidence even if every other input is perfect', () => {
  const result = scoreServer({
    uptimePercent: 100,
    pingMs: 40,
    avgPopulationPercent: 100,
    historyAgeDays: 0,
  });
  assert.equal(result.components.confidence, 0);
  assert.equal(result.rankScore, 100 - WEIGHTS.CONFIDENCE);
  assert.ok(result.rankScore < 100);
});

test('confidence scales linearly from 0 days to a full 7-day window, then caps', () => {
  assert.equal(scoreServer({ historyAgeDays: 0 }).components.confidence, 0);
  assert.equal(scoreServer({ historyAgeDays: RANKING_WINDOW_DAYS / 2 }).components.confidence, WEIGHTS.CONFIDENCE / 2);
  assert.equal(scoreServer({ historyAgeDays: RANKING_WINDOW_DAYS }).components.confidence, WEIGHTS.CONFIDENCE);
  assert.equal(scoreServer({ historyAgeDays: RANKING_WINDOW_DAYS * 2 }).components.confidence, WEIGHTS.CONFIDENCE);
});

test('reliability maps uptime linearly onto its weight (100% = full points, 90% = 36)', () => {
  assert.equal(scoreServer({ uptimePercent: 100 }).components.reliability, 40);
  assert.equal(scoreServer({ uptimePercent: 90 }).components.reliability, 36);
  assert.equal(scoreServer({ uptimePercent: 50 }).components.reliability, 20);
  assert.equal(scoreServer({ uptimePercent: 0 }).components.reliability, 0);
});

test('activity uses mean population percentage, not a peak', () => {
  assert.equal(scoreServer({ avgPopulationPercent: 100 }).components.activity, 25);
  assert.equal(scoreServer({ avgPopulationPercent: 50 }).components.activity, 12.5);
  assert.equal(scoreServer({ avgPopulationPercent: 0 }).components.activity, 0);
});

test('ping <= 60ms is full connection points', () => {
  assert.equal(scoreServer({ pingMs: 0 }).components.connection, WEIGHTS.CONNECTION);
  assert.equal(scoreServer({ pingMs: PING_FULL_MS }).components.connection, WEIGHTS.CONNECTION);
});

test('ping at the 150ms mid-tier boundary is 60% of connection points', () => {
  assert.equal(scoreServer({ pingMs: PING_MID_MS }).components.connection, round1(WEIGHTS.CONNECTION * PING_MID_FRACTION));
});

test('ping at the 300ms high-tier boundary is 20% of connection points', () => {
  assert.equal(scoreServer({ pingMs: PING_HIGH_MS }).components.connection, round1(WEIGHTS.CONNECTION * PING_HIGH_FRACTION));
});

test('ping above 300ms is 10% of connection points', () => {
  assert.equal(scoreServer({ pingMs: PING_HIGH_MS + 1 }).components.connection, round1(WEIGHTS.CONNECTION * PING_ABOVE_FRACTION));
  assert.equal(scoreServer({ pingMs: 999 }).components.connection, round1(WEIGHTS.CONNECTION * PING_ABOVE_FRACTION));
});

test('ping falls off linearly between 60ms and 150ms', () => {
  const mid = (PING_FULL_MS + PING_MID_MS) / 2; // 105ms, halfway, so 80% of points
  assert.equal(scoreServer({ pingMs: mid }).components.connection, round1(WEIGHTS.CONNECTION * 0.8));
  const justAboveFull = scoreServer({ pingMs: PING_FULL_MS + 1 }).components.connection;
  assert.ok(justAboveFull < WEIGHTS.CONNECTION);
  assert.ok(justAboveFull > scoreServer({ pingMs: PING_MID_MS }).components.connection);
});

test('ping falls off linearly between 150ms and 300ms', () => {
  const mid = (PING_MID_MS + PING_HIGH_MS) / 2; // 225ms, halfway from 60% to 20% → 40%
  assert.equal(scoreServer({ pingMs: mid }).components.connection, round1(WEIGHTS.CONNECTION * 0.4));
  const justAboveMid = scoreServer({ pingMs: PING_MID_MS + 1 }).components.connection;
  assert.ok(justAboveMid < scoreServer({ pingMs: PING_MID_MS }).components.connection);
  assert.ok(justAboveMid > scoreServer({ pingMs: PING_HIGH_MS }).components.connection);
});

test('out-of-range percents clamp rather than producing a score above 100 or below 0', () => {
  const high = scoreServer({ uptimePercent: 150, pingMs: 10, avgPopulationPercent: 200, historyAgeDays: 99 });
  assert.equal(high.rankScore, 100);
  const low = scoreServer({ uptimePercent: -10, pingMs: 10, avgPopulationPercent: -50, historyAgeDays: -3 });
  assert.equal(low.components.reliability, 0);
  assert.equal(low.components.activity, 0);
  assert.equal(low.components.confidence, 0);
});
