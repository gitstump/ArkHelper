#!/usr/bin/env node
'use strict';

/**
 * alert_engine.js
 *
 * Pure evaluation of per-account alert subscriptions against a stamped
 * official roster, plus a thin timer wrapper that loads/persists. The
 * events array is the channel-neutral fire path: the in-page feed
 * stores it; a later Discord dispatcher would consume the same list.
 * This module never makes HTTP itself — fetchRoster is injected.
 */

const {
  listAllAlertSettings,
  listAlertServerStates,
  persistAlertCycle,
} = require('./db.js');

const ALERT_COOLDOWN_MS = 10 * 60 * 1000;
const STATUS_CONFIRM_COUNT = 2;
const DEFAULT_INTERVAL_MS = 75000;

function stateKey(accountId, serverId) {
  return `${accountId}\0${serverId}`;
}

function cloneState(state) {
  return {
    accountId: state.accountId,
    serverId: state.serverId,
    lastStatus: state.lastStatus,
    pendingStatus: state.pendingStatus ?? null,
    pendingCount: state.pendingCount || 0,
    capacityAlerted: Boolean(state.capacityAlerted),
    freeSlotsAlerted: Boolean(state.freeSlotsAlerted),
    lastFiredAt: state.lastFiredAt ?? null,
    updatedAt: state.updatedAt,
  };
}

function occupancyPct(server) {
  if (!server) return null;
  const now = server.playersNow;
  const max = server.maxPlayers;
  if (typeof now !== 'number' || !Number.isFinite(now) || typeof max !== 'number' || !Number.isFinite(max) || max <= 0) {
    return null;
  }
  return (now / max) * 100;
}

function freeSlots(server) {
  if (!server) return null;
  const now = server.playersNow;
  const max = server.maxPlayers;
  if (typeof now !== 'number' || !Number.isFinite(now) || typeof max !== 'number' || !Number.isFinite(max)) {
    return null;
  }
  return max - now;
}

function displayName(server, sub) {
  if (server && typeof server.name === 'string' && server.name) return server.name;
  if (sub && typeof sub.serverName === 'string' && sub.serverName) return sub.serverName;
  return String(sub.serverId);
}

function parseTime(value) {
  if (value == null) return NaN;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : NaN;
}

function toIso(now) {
  if (typeof now === 'string') return now;
  if (typeof now === 'number' && Number.isFinite(now)) return new Date(now).toISOString();
  return new Date().toISOString();
}

function inCooldown(state, nowIso) {
  const last = parseTime(state.lastFiredAt);
  if (!Number.isFinite(last)) return false;
  const current = parseTime(nowIso);
  if (!Number.isFinite(current)) return false;
  return current - last < ALERT_COOLDOWN_MS;
}

function seedState(sub, observed, server, nowIso) {
  const occ = occupancyPct(server);
  const free = freeSlots(server);
  const capThreshold = sub.capacityThresholdPct;
  const minFree = sub.minFreeSlots;
  return {
    accountId: sub.accountId,
    serverId: sub.serverId,
    lastStatus: observed,
    pendingStatus: null,
    pendingCount: 0,
    capacityAlerted:
      capThreshold != null && Number.isFinite(Number(capThreshold)) && occ != null && occ >= Number(capThreshold),
    freeSlotsAlerted: minFree != null && Number.isFinite(Number(minFree)) && free != null && free <= Number(minFree),
    lastFiredAt: null,
    updatedAt: nowIso,
  };
}

function pushEvent(events, state, fired, { sub, server, kind, message, nowIso }) {
  if (fired.thisCycle || inCooldown(state, nowIso)) {
    return false;
  }
  events.push({
    accountId: sub.accountId,
    serverId: sub.serverId,
    serverName: displayName(server, sub),
    kind,
    message,
    createdAt: nowIso,
  });
  state.lastFiredAt = nowIso;
  fired.thisCycle = true;
  return true;
}

function applyStatusHysteresis(state, observed) {
  let confirmed = null;
  if (observed === state.lastStatus) {
    state.pendingStatus = null;
    state.pendingCount = 0;
  } else if (state.pendingStatus === observed) {
    state.pendingCount += 1;
    if (state.pendingCount >= STATUS_CONFIRM_COUNT) {
      confirmed = { from: state.lastStatus, to: observed };
      state.lastStatus = observed;
      state.pendingStatus = null;
      state.pendingCount = 0;
    }
  } else {
    state.pendingStatus = observed;
    state.pendingCount = 1;
  }
  return confirmed;
}

function evaluateOne(sub, live, prev, nowIso, events) {
  const observed = live ? 'online' : 'offline';

  if (!prev) {
    return seedState(sub, observed, live, nowIso);
  }

  const state = cloneState(prev);
  state.updatedAt = nowIso;
  const fired = { thisCycle: false };
  const name = displayName(live, sub);

  const confirmed = applyStatusHysteresis(state, observed);
  if (confirmed) {
    if (confirmed.from === 'online' && confirmed.to === 'offline' && sub.notifyDown) {
      pushEvent(events, state, fired, {
        sub,
        server: live,
        kind: 'down',
        message: `${name} went offline.`,
        nowIso,
      });
    } else if (confirmed.from === 'offline' && confirmed.to === 'online' && sub.notifyOnline) {
      pushEvent(events, state, fired, {
        sub,
        server: live,
        kind: 'online',
        message: `${name} is back online.`,
        nowIso,
      });
    }
  }

  if (live) {
    const occ = occupancyPct(live);
    const capThreshold = sub.capacityThresholdPct;
    if (capThreshold != null && Number.isFinite(Number(capThreshold)) && occ != null) {
      const threshold = Number(capThreshold);
      if (occ >= threshold) {
        if (!state.capacityAlerted) {
          const pct = Math.round(occ);
          pushEvent(events, state, fired, {
            sub,
            server: live,
            kind: 'capacity',
            message: `${name} is at ${pct}% capacity (threshold ${threshold}%).`,
            nowIso,
          });
          state.capacityAlerted = true;
        }
      } else {
        state.capacityAlerted = false;
      }
    }

    const free = freeSlots(live);
    const minFree = sub.minFreeSlots;
    if (minFree != null && Number.isFinite(Number(minFree)) && free != null) {
      const min = Number(minFree);
      if (free <= min) {
        if (!state.freeSlotsAlerted) {
          pushEvent(events, state, fired, {
            sub,
            server: live,
            kind: 'free_slots',
            message: `${name} has ${free} free slots (alert at ${min}).`,
            nowIso,
          });
          state.freeSlotsAlerted = true;
        }
      } else {
        state.freeSlotsAlerted = false;
      }
    }
  }

  return state;
}

function rosterServers(roster) {
  if (!roster) return [];
  if (Array.isArray(roster.servers)) return roster.servers;
  if (Array.isArray(roster)) return roster;
  return [];
}

function evaluateAll({ roster, subscriptions, states, now }) {
  const nowIso = toIso(now);
  const byId = new Map();
  for (const server of rosterServers(roster)) {
    if (server && server.id != null) byId.set(String(server.id), server);
  }

  const prevByKey = new Map();
  for (const state of states || []) {
    if (!state) continue;
    prevByKey.set(stateKey(state.accountId, state.serverId), state);
  }

  const events = [];
  const stateUpdates = [];
  for (const sub of subscriptions || []) {
    if (!sub || sub.serverId == null || sub.accountId == null) continue;
    const live = byId.get(String(sub.serverId)) || null;
    const prev = prevByKey.get(stateKey(sub.accountId, sub.serverId)) || null;
    stateUpdates.push(evaluateOne(sub, live, prev, nowIso, events));
  }
  return { events, stateUpdates };
}

function rosterLooksUsable(roster) {
  return Boolean(roster) && Array.isArray(roster.servers);
}

async function runAlertCycle({
  db,
  fetchRoster,
  now = () => new Date().toISOString(),
  nameCache = new Map(),
  log = console,
} = {}) {
  let roster;
  try {
    roster = await fetchRoster();
  } catch (err) {
    log.error(`[alerts] roster fetch failed, skipping cycle: ${err && err.message ? err.message : err}`);
    return { skipped: true, reason: 'fetch_error' };
  }
  if (!rosterLooksUsable(roster)) {
    log.error('[alerts] roster unavailable, skipping cycle');
    return { skipped: true, reason: 'missing_roster' };
  }

  for (const server of roster.servers) {
    if (server && server.id != null && server.name) nameCache.set(String(server.id), server.name);
  }

  const subscriptions = listAllAlertSettings(db).map((sub) => ({
    ...sub,
    serverName: nameCache.get(String(sub.serverId)) || null,
  }));
  const states = listAlertServerStates(db);
  const nowValue = typeof now === 'function' ? now() : now;
  const result = evaluateAll({ roster, subscriptions, states, now: nowValue });
  persistAlertCycle(db, result);
  return { skipped: false, ...result };
}

function startAlertEngine({
  db,
  fetchRoster,
  intervalMs = DEFAULT_INTERVAL_MS,
  now = () => new Date().toISOString(),
  setIntervalFn = setInterval,
  runImmediately = true,
  log = console,
} = {}) {
  if (!db) throw new Error('startAlertEngine: db is required');
  if (typeof fetchRoster !== 'function') throw new Error('startAlertEngine: fetchRoster is required');

  const nameCache = new Map();
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      await runAlertCycle({ db, fetchRoster, now, nameCache, log });
    } catch (err) {
      log.error(`[alerts] cycle failed: ${err && err.message ? err.message : err}`);
    }
  };

  const timer = setIntervalFn(tick, intervalMs);
  if (runImmediately) tick();
  log.log(`[alerts] engine started, interval ${intervalMs}ms`);

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

function isAlertsEngineEnabled(env = process.env) {
  return env.ALERTS_ENGINE === '1';
}

module.exports = {
  ALERT_COOLDOWN_MS,
  STATUS_CONFIRM_COUNT,
  DEFAULT_INTERVAL_MS,
  evaluateAll,
  runAlertCycle,
  startAlertEngine,
  isAlertsEngineEnabled,
};
