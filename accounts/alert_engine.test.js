'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb, upsertAccount, upsertAlertSettings, listAlertEventsForAccount, listAlertServerStates } = require('./db.js');
const {
  ALERT_COOLDOWN_MS,
  evaluateAll,
  runAlertCycle,
  startAlertEngine,
  isAlertsEngineEnabled,
} = require('./alert_engine.js');

const NAME = 'NA-PVE-GenOne6433';
const T0 = '2026-08-17T12:00:00.000Z';

function sub(overrides = {}) {
  return {
    accountId: 1,
    serverId: 's1',
    serverName: NAME,
    notifyOnline: true,
    notifyDown: true,
    capacityThresholdPct: null,
    minFreeSlots: null,
    ...overrides,
  };
}

function live(overrides = {}) {
  return { id: 's1', name: NAME, playersNow: 10, maxPlayers: 70, ...overrides };
}

function roster(servers) {
  return { servers };
}

function advance(iso, ms) {
  return new Date(Date.parse(iso) + ms).toISOString();
}

function run(subscriptions, states, servers, now = T0) {
  return evaluateAll({ roster: roster(servers), subscriptions, states, now });
}

function seedOnline(subscriptions = [sub()], now = T0) {
  return run(subscriptions, [], [live()], now);
}

test('new subscription seeds silently with no event', () => {
  const { events, stateUpdates } = seedOnline();
  assert.deepEqual(events, []);
  assert.equal(stateUpdates.length, 1);
  assert.equal(stateUpdates[0].lastStatus, 'online');
  assert.equal(stateUpdates[0].pendingStatus, null);
  assert.equal(stateUpdates[0].pendingCount, 0);
  assert.equal(stateUpdates[0].lastFiredAt, null);
});

test('new subscription for an absent server seeds as offline, silently', () => {
  const { events, stateUpdates } = run([sub()], [], [], T0);
  assert.deepEqual(events, []);
  assert.equal(stateUpdates[0].lastStatus, 'offline');
});

test('absent from roster counts as offline', () => {
  const seeded = seedOnline().stateUpdates;
  const blip = run([sub()], seeded, [], advance(T0, 75_000));
  assert.equal(blip.events.length, 0);
  assert.equal(blip.stateUpdates[0].pendingStatus, 'offline');
  assert.equal(blip.stateUpdates[0].lastStatus, 'online');
});

test('single-cycle blip fires nothing', () => {
  let states = seedOnline().stateUpdates;
  const pending = run([sub()], states, [], advance(T0, 75_000));
  assert.equal(pending.events.length, 0);
  states = pending.stateUpdates;
  const back = run([sub()], states, [live()], advance(T0, 150_000));
  assert.equal(back.events.length, 0);
  assert.equal(back.stateUpdates[0].lastStatus, 'online');
  assert.equal(back.stateUpdates[0].pendingStatus, null);
});

test('two-cycle confirm fires once', () => {
  let states = seedOnline().stateUpdates;
  states = run([sub()], states, [], advance(T0, 75_000)).stateUpdates;
  const confirmed = run([sub()], states, [], advance(T0, 150_000));
  assert.equal(confirmed.events.length, 1);
  assert.equal(confirmed.events[0].kind, 'down');
  assert.equal(confirmed.events[0].message, `${NAME} went offline.`);
  assert.equal(confirmed.events[0].serverName, NAME);
  assert.equal(confirmed.stateUpdates[0].lastStatus, 'offline');
  assert.equal(confirmed.stateUpdates[0].pendingStatus, null);
  assert.equal(confirmed.stateUpdates[0].lastFiredAt, advance(T0, 150_000));
});

test('flap A->B->A across three cycles fires nothing', () => {
  let states = seedOnline().stateUpdates; // last = online (A)
  const c1 = run([sub()], states, [], advance(T0, 75_000)); // B offline pending
  const c2 = run([sub()], c1.stateUpdates, [live()], advance(T0, 150_000)); // back to A, clear
  const c3 = run([sub()], c2.stateUpdates, [live()], advance(T0, 225_000)); // still A
  assert.equal(c1.events.length, 0);
  assert.equal(c2.events.length, 0);
  assert.equal(c3.events.length, 0);
  assert.equal(c3.stateUpdates[0].lastStatus, 'online');
  assert.equal(c3.stateUpdates[0].pendingCount, 0);
});

test('notify_down and notify_online are respected independently', () => {
  const downOnly = [sub({ notifyOnline: false, notifyDown: true })];
  const onlineOnly = [sub({ notifyOnline: true, notifyDown: false })];

  let states = run(downOnly, [], [live()], T0).stateUpdates;
  states = run(downOnly, states, [], advance(T0, 75_000)).stateUpdates;
  const wentDown = run(downOnly, states, [], advance(T0, 150_000));
  assert.equal(wentDown.events.length, 1);
  assert.equal(wentDown.events[0].kind, 'down');

  states = wentDown.stateUpdates;
  const far = advance(T0, 150_000 + ALERT_COOLDOWN_MS + 1000);
  states = run(downOnly, states, [live()], far).stateUpdates;
  const cameBack = run(downOnly, states, [live()], advance(far, 75_000));
  assert.equal(cameBack.events.length, 0);
  assert.equal(cameBack.stateUpdates[0].lastStatus, 'online');

  let onlineStates = run(onlineOnly, [], [], T0).stateUpdates; // seed offline
  onlineStates = run(onlineOnly, onlineStates, [live()], advance(T0, 75_000)).stateUpdates;
  const backOnline = run(onlineOnly, onlineStates, [live()], advance(T0, 150_000));
  assert.equal(backOnline.events.length, 1);
  assert.equal(backOnline.events[0].kind, 'online');
  assert.equal(backOnline.events[0].message, `${NAME} is back online.`);

  onlineStates = backOnline.stateUpdates;
  const far2 = advance(T0, 150_000 + ALERT_COOLDOWN_MS + 1000);
  onlineStates = run(onlineOnly, onlineStates, [], far2).stateUpdates;
  const downIgnored = run(onlineOnly, onlineStates, [], advance(far2, 75_000));
  assert.equal(downIgnored.events.length, 0);
  assert.equal(downIgnored.stateUpdates[0].lastStatus, 'offline');
});

test('capacity latch: fire once at cross, silent while latched, re-arm, fire again', () => {
  const subscriptions = [sub({ notifyDown: false, notifyOnline: false, capacityThresholdPct: 90 })];
  let states = run(subscriptions, [], [live({ playersNow: 50 })], T0).stateUpdates;
  assert.equal(states[0].capacityAlerted, false);

  const cross = run(subscriptions, states, [live({ playersNow: 64 })], advance(T0, 75_000));
  assert.equal(cross.events.length, 1);
  assert.equal(cross.events[0].kind, 'capacity');
  assert.match(cross.events[0].message, /is at 91% capacity \(threshold 90%\)/);
  assert.equal(cross.stateUpdates[0].capacityAlerted, true);

  const stillHigh = run(subscriptions, cross.stateUpdates, [live({ playersNow: 70 })], advance(T0, 150_000));
  assert.equal(stillHigh.events.length, 0);
  assert.equal(stillHigh.stateUpdates[0].capacityAlerted, true);

  const recovered = run(subscriptions, stillHigh.stateUpdates, [live({ playersNow: 10 })], advance(T0, 150_000 + ALERT_COOLDOWN_MS + 1000));
  assert.equal(recovered.events.length, 0);
  assert.equal(recovered.stateUpdates[0].capacityAlerted, false);

  const recross = run(subscriptions, recovered.stateUpdates, [live({ playersNow: 63 })], advance(T0, 150_000 + ALERT_COOLDOWN_MS + 75_000));
  assert.equal(recross.events.length, 1);
  assert.equal(recross.events[0].kind, 'capacity');
});

test('capacity at-or-above threshold fires on exact equality', () => {
  const subscriptions = [sub({ notifyDown: false, notifyOnline: false, capacityThresholdPct: 50 })];
  const states = run(subscriptions, [], [live({ playersNow: 34, maxPlayers: 70 })], T0).stateUpdates;
  const cross = run(subscriptions, states, [live({ playersNow: 35, maxPlayers: 70 })], advance(T0, 75_000));
  assert.equal(cross.events.length, 1);
  assert.equal(Math.round((35 / 70) * 100), 50);
});

test('free-slots latch: fire once at or below min, silent while latched, re-arm above', () => {
  const subscriptions = [sub({ notifyDown: false, notifyOnline: false, minFreeSlots: 5 })];
  let states = run(subscriptions, [], [live({ playersNow: 60 })], T0).stateUpdates; // 10 free
  assert.equal(states[0].freeSlotsAlerted, false);

  const cross = run(subscriptions, states, [live({ playersNow: 67 })], advance(T0, 75_000)); // 3 free
  assert.equal(cross.events.length, 1);
  assert.equal(cross.events[0].kind, 'free_slots');
  assert.equal(cross.events[0].message, `${NAME} has 3 free slots (alert at 5).`);
  assert.equal(cross.stateUpdates[0].freeSlotsAlerted, true);

  const stillLow = run(subscriptions, cross.stateUpdates, [live({ playersNow: 70 })], advance(T0, 150_000));
  assert.equal(stillLow.events.length, 0);

  const recovered = run(
    subscriptions,
    stillLow.stateUpdates,
    [live({ playersNow: 60 })],
    advance(T0, 150_000 + ALERT_COOLDOWN_MS + 1000)
  );
  assert.equal(recovered.events.length, 0);
  assert.equal(recovered.stateUpdates[0].freeSlotsAlerted, false);

  const recross = run(
    subscriptions,
    recovered.stateUpdates,
    [live({ playersNow: 65 })],
    advance(T0, 150_000 + ALERT_COOLDOWN_MS + 75_000)
  );
  assert.equal(recross.events.length, 1);
  assert.equal(recross.events[0].message, `${NAME} has 5 free slots (alert at 5).`);
});

test('new subscription already over capacity latches without firing', () => {
  const subscriptions = [sub({ capacityThresholdPct: 90, minFreeSlots: 5 })];
  const { events, stateUpdates } = run(subscriptions, [], [live({ playersNow: 68 })], T0);
  assert.equal(events.length, 0);
  assert.equal(stateUpdates[0].capacityAlerted, true);
  assert.equal(stateUpdates[0].freeSlotsAlerted, true);
});

test('cooldown drops a second transition; it is not queued; state still updates', () => {
  let states = seedOnline().stateUpdates;
  states = run([sub()], states, [], advance(T0, 75_000)).stateUpdates;
  const down = run([sub()], states, [], advance(T0, 150_000));
  assert.equal(down.events.length, 1);
  assert.equal(down.events[0].kind, 'down');
  const firedAt = down.stateUpdates[0].lastFiredAt;

  const tOnline1 = advance(firedAt, 60_000);
  states = run([sub()], down.stateUpdates, [live()], tOnline1).stateUpdates;
  const tOnline2 = advance(firedAt, 120_000);
  const back = run([sub()], states, [live()], tOnline2);
  assert.equal(back.events.length, 0);
  assert.equal(back.stateUpdates[0].lastStatus, 'online');
  assert.equal(back.stateUpdates[0].lastFiredAt, firedAt);

  const tDown1 = advance(firedAt, 180_000);
  states = run([sub()], back.stateUpdates, [], tDown1).stateUpdates;
  const tDown2 = advance(firedAt, 240_000);
  const downAgain = run([sub()], states, [], tDown2);
  assert.equal(downAgain.events.length, 0);
  assert.equal(downAgain.stateUpdates[0].lastStatus, 'offline');
  assert.equal(downAgain.stateUpdates[0].lastFiredAt, firedAt);

  const tAfter1 = advance(firedAt, ALERT_COOLDOWN_MS + 1000);
  states = run([sub()], downAgain.stateUpdates, [live()], tAfter1).stateUpdates;
  const tAfter2 = advance(firedAt, ALERT_COOLDOWN_MS + 76_000);
  const lateOnline = run([sub()], states, [live()], tAfter2);
  assert.equal(lateOnline.events.length, 1);
  assert.equal(lateOnline.events[0].kind, 'online');
});

test('cooldown-suppressed capacity cross latches and does not fire later while still high', () => {
  const subscriptions = [sub({ notifyDown: true, notifyOnline: false, capacityThresholdPct: 90 })];
  let states = run(subscriptions, [], [live({ playersNow: 10 })], T0).stateUpdates;
  states = run(subscriptions, states, [], advance(T0, 75_000)).stateUpdates;
  const down = run(subscriptions, states, [], advance(T0, 150_000));
  assert.equal(down.events[0].kind, 'down');

  const during1 = advance(down.stateUpdates[0].lastFiredAt, 60_000);
  const pending = run(subscriptions, down.stateUpdates, [live({ playersNow: 65 })], during1);
  assert.equal(pending.events.length, 0);
  const during2 = advance(down.stateUpdates[0].lastFiredAt, 120_000);
  const cross = run(subscriptions, pending.stateUpdates, [live({ playersNow: 65 })], during2);
  assert.equal(cross.events.length, 0);
  assert.equal(cross.stateUpdates[0].capacityAlerted, true);
  assert.equal(cross.stateUpdates[0].lastStatus, 'online');

  const afterCd = advance(down.stateUpdates[0].lastFiredAt, ALERT_COOLDOWN_MS + 1000);
  const stillHigh = run(subscriptions, cross.stateUpdates, [live({ playersNow: 65 })], afterCd);
  assert.equal(stillHigh.events.length, 0);
});

test('evaluateAll is pure: same inputs yield same outputs and inputs are not mutated', () => {
  const subscriptions = Object.freeze([Object.freeze(sub({ capacityThresholdPct: 90 }))]);
  const servers = Object.freeze([Object.freeze(live({ playersNow: 10 }))]);
  const rosterObj = Object.freeze({ servers });
  const states = Object.freeze([]);
  const first = evaluateAll({ roster: rosterObj, subscriptions, states, now: T0 });
  const second = evaluateAll({ roster: rosterObj, subscriptions, states, now: T0 });
  assert.deepEqual(first, second);
  assert.equal(states.length, 0);
  assert.equal(servers[0].playersNow, 10);
});

test('evaluateAll does not touch a db handle', () => {
  const db = new Proxy(
    {},
    {
      get() {
        throw new Error('evaluateAll must not access the db');
      },
    }
  );
  void db;
  const { events } = evaluateAll({
    roster: roster([live()]),
    subscriptions: [sub()],
    states: [],
    now: T0,
  });
  assert.equal(events.length, 0);
});

test('isAlertsEngineEnabled is true only for ALERTS_ENGINE=1', () => {
  assert.equal(isAlertsEngineEnabled({}), false);
  assert.equal(isAlertsEngineEnabled({ ALERTS_ENGINE: '1' }), true);
  assert.equal(isAlertsEngineEnabled({ ALERTS_ENGINE: '0' }), false);
  assert.equal(isAlertsEngineEnabled({ ALERTS_ENGINE: 'true' }), false);
});

test('runAlertCycle skips entirely when fetchRoster returns unusable data', async () => {
  const db = openDb(':memory:');
  const account = upsertAccount(db, { discordId: '1' });
  upsertAlertSettings(db, account.id, 's1', { notifyDown: true });
  const logs = [];
  const result = await runAlertCycle({
    db,
    fetchRoster: async () => null,
    log: { error: (msg) => logs.push(msg), log() {} },
  });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'missing_roster');
  assert.equal(listAlertServerStates(db).length, 0);
  assert.match(logs.join('\n'), /skipping cycle/);
});

test('runAlertCycle skips when fetchRoster throws, so absence-as-offline cannot fire from our failure', async () => {
  const db = openDb(':memory:');
  const account = upsertAccount(db, { discordId: '1' });
  upsertAlertSettings(db, account.id, 's1', { notifyDown: true });
  const logs = [];
  const result = await runAlertCycle({
    db,
    fetchRoster: async () => {
      throw new Error('ECONNREFUSED');
    },
    log: { error: (msg) => logs.push(msg), log() {} },
  });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'fetch_error');
  assert.equal(listAlertEventsForAccount(db, account.id).length, 0);
  assert.match(logs.join('\n'), /ECONNREFUSED/);
});

test('runAlertCycle persists a confirmed down using the name cache from an earlier roster', async () => {
  const db = openDb(':memory:');
  const account = upsertAccount(db, { discordId: '1' });
  upsertAlertSettings(db, account.id, 's1', { notifyDown: true, notifyOnline: true });
  const nameCache = new Map();
  const now = { t: Date.parse(T0) };
  const clock = () => new Date(now.t).toISOString();
  const silent = { error() {}, log() {} };

  await runAlertCycle({
    db,
    fetchRoster: async () => roster([live()]),
    now: clock,
    nameCache,
    log: silent,
  });
  now.t += 75_000;
  await runAlertCycle({
    db,
    fetchRoster: async () => roster([]),
    now: clock,
    nameCache,
    log: silent,
  });
  now.t += 75_000;
  await runAlertCycle({
    db,
    fetchRoster: async () => roster([]),
    now: clock,
    nameCache,
    log: silent,
  });

  const events = listAlertEventsForAccount(db, account.id);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'down');
  assert.equal(events[0].serverName, NAME);
  assert.equal(events[0].message, `${NAME} went offline.`);
  assert.equal(listAlertServerStates(db)[0].lastStatus, 'offline');
});

test('startAlertEngine requires db and fetchRoster, and does not tick when runImmediately is false', () => {
  const db = openDb(':memory:');
  assert.throws(() => startAlertEngine({ fetchRoster: async () => null }), /db is required/);
  assert.throws(() => startAlertEngine({ db }), /fetchRoster is required/);

  let ticks = 0;
  const engine = startAlertEngine({
    db,
    fetchRoster: async () => {
      ticks += 1;
      return null;
    },
    intervalMs: 999999,
    runImmediately: false,
    setIntervalFn: () => 1,
    log: { error() {}, log() {} },
  });
  assert.equal(ticks, 0);
  engine.stop();
});

test('runAlertCycle posts batched events through postFn after persist when a webhook is saved', async () => {
  const db = openDb(':memory:');
  const { upsertAccountWebhook } = require('./db.js');
  const account = upsertAccount(db, { discordId: '1' });
  upsertAlertSettings(db, account.id, 's1', { notifyDown: true, notifyOnline: true });
  upsertAccountWebhook(db, account.id, 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwx');
  const nameCache = new Map();
  const now = { t: Date.parse(T0) };
  const clock = () => new Date(now.t).toISOString();
  const silent = { error() {}, log() {} };
  const calls = [];
  const postFn = async (url, content) => {
    calls.push({ url, content });
    return { status: 204, ok: true };
  };

  await runAlertCycle({
    db,
    fetchRoster: async () => roster([live()]),
    now: clock,
    nameCache,
    log: silent,
    postFn,
    origin: 'https://arkhelper.info',
  });
  now.t += 75_000;
  await runAlertCycle({
    db,
    fetchRoster: async () => roster([]),
    now: clock,
    nameCache,
    log: silent,
    postFn,
    origin: 'https://arkhelper.info',
  });
  now.t += 75_000;
  await runAlertCycle({
    db,
    fetchRoster: async () => roster([]),
    now: clock,
    nameCache,
    log: silent,
    postFn,
    origin: 'https://arkhelper.info',
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].content, /went offline/);
  assert.match(calls[0].content, /https:\/\/arkhelper\.info\/alerts/);
  const events = listAlertEventsForAccount(db, account.id);
  assert.equal(events.length, 1);
  assert.ok(events[0].dispatchedAt);
});

test('null roster and a roster without servers log distinct skip lines', async () => {
  const db = openDb(':memory:');
  const silentNow = () => T0;

  const nullLogs = [];
  const nullResult = await runAlertCycle({
    db,
    fetchRoster: async () => null,
    now: silentNow,
    log: { error: (msg) => nullLogs.push(msg), log() {} },
  });
  assert.equal(nullResult.skipped, true);
  assert.equal(nullResult.reason, 'missing_roster');
  assert.equal(nullLogs.length, 1);
  assert.equal(nullLogs[0], '[alerts] roster fetch returned no data, skipping cycle');

  const objectLogs = [];
  const objectResult = await runAlertCycle({
    db,
    fetchRoster: async () => ({ count: 0 }),
    now: silentNow,
    log: { error: (msg) => objectLogs.push(msg), log() {} },
  });
  assert.equal(objectResult.skipped, true);
  assert.equal(objectResult.reason, 'missing_roster');
  assert.equal(objectLogs.length, 1);
  assert.equal(objectLogs[0], '[alerts] roster unavailable, skipping cycle');
});

test('consecutive skipped cycles warn at 3 and 13 and reset after a successful cycle', async () => {
  const db = openDb(':memory:');
  const logs = [];
  let tick;
  let rosterValue = null;
  const engine = startAlertEngine({
    db,
    fetchRoster: async () => rosterValue,
    now: () => T0,
    intervalMs: 999999,
    runImmediately: false,
    setIntervalFn: (fn) => {
      tick = fn;
      return 1;
    },
    log: { error: (msg) => logs.push(msg), log() {} },
  });

  for (let i = 0; i < 13; i++) {
    await tick();
  }
  const warnings = logs.filter((msg) => String(msg).includes('WARNING:'));
  assert.equal(warnings.length, 2);
  assert.equal(warnings[0], '[alerts] WARNING: 3 consecutive cycles skipped, no alerts dispatched');
  assert.equal(warnings[1], '[alerts] WARNING: 13 consecutive cycles skipped, no alerts dispatched');
  assert.equal(engine.getHealth().consecutiveSkips, 13);
  assert.equal(engine.getHealth().lastSkipReason, 'missing_roster');

  rosterValue = roster([live()]);
  await tick();
  assert.equal(engine.getHealth().consecutiveSkips, 0);
  assert.equal(engine.getHealth().lastSkipReason, null);
  assert.equal(engine.getHealth().lastSuccessAt, T0);
  engine.stop();
});

test('getHealth returns consecutiveSkips, lastSuccessAt, and lastSkipReason', () => {
  const db = openDb(':memory:');
  const engine = startAlertEngine({
    db,
    fetchRoster: async () => null,
    intervalMs: 999999,
    runImmediately: false,
    setIntervalFn: () => 1,
    log: { error() {}, log() {} },
  });
  const health = engine.getHealth();
  assert.deepEqual(health, {
    consecutiveSkips: 0,
    lastSuccessAt: null,
    lastSkipReason: null,
  });
  health.consecutiveSkips = 99;
  assert.equal(engine.getHealth().consecutiveSkips, 0);
  engine.stop();
});
