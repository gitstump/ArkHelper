#!/usr/bin/env node
'use strict';

/**
 * incidents.js
 *
 * Pure incident classifier for the official ARK:SA network. Callers
 * gather offline %, 24h baseline, version-change coverage, and fetch
 * success/failure from history.js; this module decides the state and
 * how the detector's hysteresis / consecutive-failure counters move.
 *
 * Thresholds live here as named constants so they can be retuned in
 * one place. No DB, no network, no clock.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const THRESHOLDS = {
  OUTAGE_OFFLINE_PCT: 25,
  OUTAGE_BASELINE_MULTIPLIER: 3,
  DEGRADED_OFFLINE_PCT: 10,
  DEGRADED_BASELINE_MULTIPLIER: 2,
  UPDATE_ROLLOUT_PCT: 20,
  FETCH_FAILURES_FOR_OUTAGE: 2,
  HYSTERESIS_NORMAL_CYCLES: 3,
  BASELINE_WINDOW_MS: DAY_MS,
  VERSION_ROLLOUT_WINDOW_MS: 6 * HOUR_MS,
  KNOWN_SERVERS_LOOKBACK_MS: 7 * DAY_MS,
};

const STATES = {
  OUTAGE: 'OUTAGE',
  DEGRADED: 'DEGRADED',
  UPDATE_ROLLOUT: 'UPDATE_ROLLOUT',
  NORMAL: 'NORMAL',
  UNREACHABLE: 'UNREACHABLE',
};

const SEVERITY = {
  [STATES.NORMAL]: 0,
  [STATES.UNREACHABLE]: 0,
  [STATES.UPDATE_ROLLOUT]: 1,
  [STATES.DEGRADED]: 2,
  [STATES.OUTAGE]: 3,
};

const VERDICTS = {
  up: 'ARK official servers look UP',
  outage: 'Possible outage in progress',
  update: 'Update appears to be rolling out',
  unreachable: "We can't reach ARK's server list right now",
};

function round1(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

function meetsMultiplier(value, baselinePct, multiplier) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (typeof baselinePct !== 'number' || !Number.isFinite(baselinePct) || baselinePct <= 0) return true;
  return value >= multiplier * baselinePct;
}

function classifyState({ rosterFetchFailed, consecutiveFetchFailures, offlinePct, baselinePct, versionRolloutPct }) {
  if (rosterFetchFailed) {
    if (consecutiveFetchFailures >= THRESHOLDS.FETCH_FAILURES_FOR_OUTAGE) return STATES.OUTAGE;
    return STATES.UNREACHABLE;
  }

  if (
    typeof offlinePct === 'number' &&
    offlinePct >= THRESHOLDS.OUTAGE_OFFLINE_PCT &&
    meetsMultiplier(offlinePct, baselinePct, THRESHOLDS.OUTAGE_BASELINE_MULTIPLIER)
  ) {
    return STATES.OUTAGE;
  }

  if (
    typeof offlinePct === 'number' &&
    offlinePct >= THRESHOLDS.DEGRADED_OFFLINE_PCT &&
    meetsMultiplier(offlinePct, baselinePct, THRESHOLDS.DEGRADED_BASELINE_MULTIPLIER)
  ) {
    return STATES.DEGRADED;
  }

  if (typeof versionRolloutPct === 'number' && versionRolloutPct >= THRESHOLDS.UPDATE_ROLLOUT_PCT) {
    return STATES.UPDATE_ROLLOUT;
  }

  return STATES.NORMAL;
}

function computeOfflineStats(knownIds, presentIds) {
  const present = new Set((presentIds || []).filter(Boolean));
  const known = [...new Set((knownIds || []).filter(Boolean))];
  let offline = 0;
  for (const id of known) {
    if (!present.has(id)) offline += 1;
  }
  const totalKnown = known.length;
  const offlinePct = totalKnown === 0 ? 0 : (offline / totalKnown) * 100;
  return {
    offlinePct: round1(offlinePct),
    onlineCount: present.size,
    totalKnown,
    serversAffected: offline,
  };
}

function advanceDetector({
  consecutiveFetchFailures = 0,
  consecutiveNormalCycles = 0,
  activeIncident = null,
  rosterFetchFailed = false,
  offlinePct = null,
  baselinePct = 0,
  versionRolloutPct = 0,
  serversAffected = 0,
} = {}) {
  const failures = rosterFetchFailed ? consecutiveFetchFailures + 1 : 0;
  const rawState = classifyState({
    rosterFetchFailed,
    consecutiveFetchFailures: failures,
    offlinePct: rosterFetchFailed ? null : offlinePct,
    baselinePct,
    versionRolloutPct,
  });

  const isNormal = rawState === STATES.NORMAL;
  const consecutiveNormal = isNormal ? consecutiveNormalCycles + 1 : 0;

  let incident = activeIncident ? { ...activeIncident } : null;
  let closeIncident = false;
  let openNew = false;

  if (rawState !== STATES.NORMAL && rawState !== STATES.UNREACHABLE) {
    if (!incident) {
      incident = {
        type: rawState,
        peakOfflinePct: typeof offlinePct === 'number' ? offlinePct : null,
        serversAffected: typeof serversAffected === 'number' ? serversAffected : 0,
      };
      openNew = true;
    } else {
      if ((SEVERITY[rawState] || 0) > (SEVERITY[incident.type] || 0)) incident.type = rawState;
      if (typeof offlinePct === 'number' && (incident.peakOfflinePct == null || offlinePct > incident.peakOfflinePct)) {
        incident.peakOfflinePct = offlinePct;
      }
      if (typeof serversAffected === 'number' && (incident.serversAffected == null || serversAffected > incident.serversAffected)) {
        incident.serversAffected = serversAffected;
      }
    }
  } else if (isNormal && incident && consecutiveNormal >= THRESHOLDS.HYSTERESIS_NORMAL_CYCLES) {
    closeIncident = true;
    incident = null;
  }

  // During hysteresis the headline stays on the open incident so a
  // single recovered cycle doesn't flap the public verdict.
  const displayedState = incident && rawState === STATES.NORMAL ? incident.type : rawState;

  return {
    consecutiveFetchFailures: failures,
    consecutiveNormalCycles: consecutiveNormal,
    rawState,
    displayedState,
    incident,
    openNew,
    closeIncident,
  };
}

function verdictKeyForState(state, rosterFetchFailed) {
  if (rosterFetchFailed || state === STATES.UNREACHABLE) return 'unreachable';
  if (state === STATES.OUTAGE || state === STATES.DEGRADED) return 'outage';
  if (state === STATES.UPDATE_ROLLOUT) return 'update';
  return 'up';
}

function verdictText(verdictKey) {
  return VERDICTS[verdictKey] || VERDICTS.up;
}

module.exports = {
  DAY_MS,
  HOUR_MS,
  THRESHOLDS,
  STATES,
  SEVERITY,
  VERDICTS,
  round1,
  meetsMultiplier,
  classifyState,
  computeOfflineStats,
  advanceDetector,
  verdictKeyForState,
  verdictText,
};
