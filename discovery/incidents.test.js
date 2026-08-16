'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  THRESHOLDS,
  STATES,
  classifyState,
  computeOfflineStats,
  advanceDetector,
  verdictKeyForState,
  verdictText,
} = require('./incidents.js');

// ---------------------------------------------------------------------
// classifyState — triggers and boundaries
// ---------------------------------------------------------------------
test('classifyState is NORMAL when nothing is elevated', () => {
  assert.equal(
    classifyState({ rosterFetchFailed: false, consecutiveFetchFailures: 0, offlinePct: 2, baselinePct: 3, versionRolloutPct: 0 }),
    STATES.NORMAL
  );
});

test('classifyState OUTAGE at exactly 25% offline when 3x baseline is also met', () => {
  assert.equal(
    classifyState({
      rosterFetchFailed: false,
      consecutiveFetchFailures: 0,
      offlinePct: THRESHOLDS.OUTAGE_OFFLINE_PCT,
      baselinePct: 5, // 3x = 15, so 25% binds
      versionRolloutPct: 0,
    }),
    STATES.OUTAGE
  );
});

test('classifyState does not OUTAGE just below 25%', () => {
  assert.equal(
    classifyState({
      rosterFetchFailed: false,
      consecutiveFetchFailures: 0,
      offlinePct: THRESHOLDS.OUTAGE_OFFLINE_PCT - 0.1,
      baselinePct: 1,
      versionRolloutPct: 0,
    }),
    STATES.DEGRADED
  );
});

test('classifyState does not OUTAGE at 25% when 3x baseline is higher', () => {
  // 25% >= 25, but 3x of 10% is 30% — not OUTAGE. 25% is DEGRADED (2x of 10% = 20).
  assert.equal(
    classifyState({
      rosterFetchFailed: false,
      consecutiveFetchFailures: 0,
      offlinePct: 25,
      baselinePct: 10,
      versionRolloutPct: 0,
    }),
    STATES.DEGRADED
  );
});

test('classifyState OUTAGE when 25% also clears a higher 3x baseline', () => {
  assert.equal(
    classifyState({
      rosterFetchFailed: false,
      consecutiveFetchFailures: 0,
      offlinePct: 30,
      baselinePct: 10, // 3x = 30
      versionRolloutPct: 0,
    }),
    STATES.OUTAGE
  );
});

test('classifyState DEGRADED at exactly 10% when 2x baseline is also met', () => {
  assert.equal(
    classifyState({
      rosterFetchFailed: false,
      consecutiveFetchFailures: 0,
      offlinePct: THRESHOLDS.DEGRADED_OFFLINE_PCT,
      baselinePct: 4, // 2x = 8
      versionRolloutPct: 0,
    }),
    STATES.DEGRADED
  );
});

test('classifyState does not DEGRADED just below 10%', () => {
  assert.equal(
    classifyState({
      rosterFetchFailed: false,
      consecutiveFetchFailures: 0,
      offlinePct: THRESHOLDS.DEGRADED_OFFLINE_PCT - 0.1,
      baselinePct: 1,
      versionRolloutPct: 0,
    }),
    STATES.NORMAL
  );
});

test('classifyState does not DEGRADED at 10% when 2x baseline is higher', () => {
  assert.equal(
    classifyState({
      rosterFetchFailed: false,
      consecutiveFetchFailures: 0,
      offlinePct: 10,
      baselinePct: 6, // 2x = 12
      versionRolloutPct: 0,
    }),
    STATES.NORMAL
  );
});

test('classifyState treats a zero/missing baseline as "absolute threshold only"', () => {
  assert.equal(
    classifyState({ rosterFetchFailed: false, consecutiveFetchFailures: 0, offlinePct: 25, baselinePct: 0, versionRolloutPct: 0 }),
    STATES.OUTAGE
  );
  assert.equal(
    classifyState({ rosterFetchFailed: false, consecutiveFetchFailures: 0, offlinePct: 10, baselinePct: null, versionRolloutPct: 0 }),
    STATES.DEGRADED
  );
});

test('classifyState UPDATE_ROLLOUT at exactly 20% version coverage', () => {
  assert.equal(
    classifyState({
      rosterFetchFailed: false,
      consecutiveFetchFailures: 0,
      offlinePct: 1,
      baselinePct: 1,
      versionRolloutPct: THRESHOLDS.UPDATE_ROLLOUT_PCT,
    }),
    STATES.UPDATE_ROLLOUT
  );
});

test('classifyState does not UPDATE_ROLLOUT just below 20%', () => {
  assert.equal(
    classifyState({
      rosterFetchFailed: false,
      consecutiveFetchFailures: 0,
      offlinePct: 1,
      baselinePct: 1,
      versionRolloutPct: THRESHOLDS.UPDATE_ROLLOUT_PCT - 0.1,
    }),
    STATES.NORMAL
  );
});

test('classifyState prefers OUTAGE over UPDATE_ROLLOUT when both would fire', () => {
  assert.equal(
    classifyState({
      rosterFetchFailed: false,
      consecutiveFetchFailures: 0,
      offlinePct: 40,
      baselinePct: 5,
      versionRolloutPct: 50,
    }),
    STATES.OUTAGE
  );
});

test('classifyState OUTAGE after 2 consecutive fetch failures, not after 1', () => {
  assert.equal(
    classifyState({ rosterFetchFailed: true, consecutiveFetchFailures: 1, offlinePct: null, baselinePct: 0, versionRolloutPct: 0 }),
    STATES.UNREACHABLE
  );
  assert.equal(
    classifyState({ rosterFetchFailed: true, consecutiveFetchFailures: 2, offlinePct: null, baselinePct: 0, versionRolloutPct: 0 }),
    STATES.OUTAGE
  );
  assert.equal(
    classifyState({ rosterFetchFailed: true, consecutiveFetchFailures: 3, offlinePct: null, baselinePct: 0, versionRolloutPct: 0 }),
    STATES.OUTAGE
  );
});

// ---------------------------------------------------------------------
// computeOfflineStats
// ---------------------------------------------------------------------
test('computeOfflineStats counts known servers missing from the current roster', () => {
  const stats = computeOfflineStats(['a', 'b', 'c', 'd'], ['a', 'b', 'c']);
  assert.equal(stats.totalKnown, 4);
  assert.equal(stats.onlineCount, 3);
  assert.equal(stats.serversAffected, 1);
  assert.equal(stats.offlinePct, 25);
});

test('computeOfflineStats is 0% when every known server is present', () => {
  const stats = computeOfflineStats(['a', 'b'], ['a', 'b']);
  assert.equal(stats.offlinePct, 0);
  assert.equal(stats.serversAffected, 0);
});

test('computeOfflineStats handles an empty known set without dividing by zero', () => {
  const stats = computeOfflineStats([], ['a']);
  assert.equal(stats.offlinePct, 0);
  assert.equal(stats.totalKnown, 0);
  assert.equal(stats.onlineCount, 1);
});

// ---------------------------------------------------------------------
// advanceDetector — hysteresis, fetch-failure reset, incident open/close
// ---------------------------------------------------------------------
test('advanceDetector does not end an incident until 3 consecutive NORMAL cycles', () => {
  let state = {
    consecutiveFetchFailures: 0,
    consecutiveNormalCycles: 0,
    activeIncident: { id: 1, type: STATES.OUTAGE, peakOfflinePct: 40, serversAffected: 100 },
  };

  for (let i = 1; i <= 2; i += 1) {
    const next = advanceDetector({
      ...state,
      rosterFetchFailed: false,
      offlinePct: 2,
      baselinePct: 3,
      versionRolloutPct: 0,
    });
    assert.equal(next.closeIncident, false, `cycle ${i} should not close`);
    assert.equal(next.displayedState, STATES.OUTAGE);
    assert.equal(next.consecutiveNormalCycles, i);
    state = { ...state, consecutiveNormalCycles: next.consecutiveNormalCycles, activeIncident: next.incident };
  }

  const third = advanceDetector({
    ...state,
    rosterFetchFailed: false,
    offlinePct: 2,
    baselinePct: 3,
    versionRolloutPct: 0,
  });
  assert.equal(third.closeIncident, true);
  assert.equal(third.incident, null);
  assert.equal(third.displayedState, STATES.NORMAL);
  assert.equal(third.consecutiveNormalCycles, 3);
});

test('advanceDetector resets the NORMAL streak if a non-NORMAL cycle interrupts it', () => {
  const afterOneNormal = advanceDetector({
    consecutiveNormalCycles: 0,
    activeIncident: { id: 1, type: STATES.DEGRADED, peakOfflinePct: 15, serversAffected: 10 },
    rosterFetchFailed: false,
    offlinePct: 1,
    baselinePct: 2,
    versionRolloutPct: 0,
  });
  assert.equal(afterOneNormal.consecutiveNormalCycles, 1);
  assert.equal(afterOneNormal.closeIncident, false);

  const interrupted = advanceDetector({
    consecutiveNormalCycles: afterOneNormal.consecutiveNormalCycles,
    activeIncident: afterOneNormal.incident,
    rosterFetchFailed: false,
    offlinePct: 12,
    baselinePct: 2,
    versionRolloutPct: 0,
  });
  assert.equal(interrupted.consecutiveNormalCycles, 0);
  assert.equal(interrupted.closeIncident, false);
  assert.equal(interrupted.displayedState, STATES.DEGRADED);
});

test('advanceDetector consecutive fetch-failure count resets on a successful cycle', () => {
  const firstFail = advanceDetector({ consecutiveFetchFailures: 0, rosterFetchFailed: true });
  assert.equal(firstFail.consecutiveFetchFailures, 1);
  assert.equal(firstFail.rawState, STATES.UNREACHABLE);
  assert.equal(firstFail.openNew, false);

  const secondFail = advanceDetector({ consecutiveFetchFailures: firstFail.consecutiveFetchFailures, rosterFetchFailed: true });
  assert.equal(secondFail.consecutiveFetchFailures, 2);
  assert.equal(secondFail.rawState, STATES.OUTAGE);
  assert.equal(secondFail.openNew, true);

  const recovered = advanceDetector({
    consecutiveFetchFailures: secondFail.consecutiveFetchFailures,
    activeIncident: secondFail.incident,
    rosterFetchFailed: false,
    offlinePct: 1,
    baselinePct: 2,
    versionRolloutPct: 0,
  });
  assert.equal(recovered.consecutiveFetchFailures, 0);
  assert.equal(recovered.rawState, STATES.NORMAL);
  assert.equal(recovered.closeIncident, false); // hysteresis still holding
});

test('advanceDetector opens a new incident on the first non-NORMAL classified state', () => {
  const next = advanceDetector({
    rosterFetchFailed: false,
    offlinePct: 40,
    baselinePct: 5,
    versionRolloutPct: 0,
    serversAffected: 80,
  });
  assert.equal(next.openNew, true);
  assert.equal(next.incident.type, STATES.OUTAGE);
  assert.equal(next.incident.peakOfflinePct, 40);
  assert.equal(next.incident.serversAffected, 80);
});

test('advanceDetector upgrades an open incident and tracks peak offlinePct', () => {
  const next = advanceDetector({
    activeIncident: { id: 4, type: STATES.DEGRADED, peakOfflinePct: 12, serversAffected: 20 },
    rosterFetchFailed: false,
    offlinePct: 40,
    baselinePct: 5,
    versionRolloutPct: 0,
    serversAffected: 90,
  });
  assert.equal(next.openNew, false);
  assert.equal(next.incident.type, STATES.OUTAGE);
  assert.equal(next.incident.peakOfflinePct, 40);
  assert.equal(next.incident.serversAffected, 90);
});

test('verdictKeyForState maps the four public headlines', () => {
  assert.equal(verdictKeyForState(STATES.NORMAL, false), 'up');
  assert.equal(verdictKeyForState(STATES.OUTAGE, false), 'outage');
  assert.equal(verdictKeyForState(STATES.DEGRADED, false), 'outage');
  assert.equal(verdictKeyForState(STATES.UPDATE_ROLLOUT, false), 'update');
  assert.equal(verdictKeyForState(STATES.UNREACHABLE, true), 'unreachable');
  assert.equal(verdictKeyForState(STATES.OUTAGE, true), 'unreachable');
  assert.equal(verdictText('up'), 'ARK official servers look UP');
  assert.equal(verdictText('outage'), 'Possible outage in progress');
  assert.equal(verdictText('update'), 'Update appears to be rolling out');
  assert.equal(verdictText('unreachable'), "We can't reach ARK's server list right now");
});
