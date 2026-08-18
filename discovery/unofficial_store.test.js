'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  openUnofficialDb,
  recordUnofficialCycle,
  recordUnofficialFetchFailure,
  getUnofficialMeta,
  getUnofficialServer,
} = require('./unofficial_store.js');

function sample(id, extra = {}) {
  return {
    id,
    name: extra.name || `Server ${id}`,
    map: extra.map || 'TheIsland_WP',
    gameMode: extra.gameMode || 'pve',
    playersNow: extra.playersNow ?? 3,
    maxPlayers: extra.maxPlayers ?? 20,
    version: extra.version || '92.41',
    platformType: extra.platformType || 'PC',
    ping: extra.ping ?? 40,
    hasPassword: extra.hasPassword ?? false,
  };
}

test('recordUnofficialCycle upserts latest fields and sets first_seen / last_seen', () => {
  const db = openUnofficialDb(':memory:');
  const meta = recordUnofficialCycle(db, [sample('a')], { now: () => '2026-08-16T00:00:00.000Z' });
  const row = getUnofficialServer(db, 'a');
  assert.equal(row.name, 'Server a');
  assert.equal(row.map, 'TheIsland_WP');
  assert.equal(row.game_mode, 'pve');
  assert.equal(row.players_now, 3);
  assert.equal(row.cycles_seen, 1);
  assert.equal(row.first_seen, '2026-08-16T00:00:00.000Z');
  assert.equal(row.last_seen, '2026-08-16T00:00:00.000Z');
  assert.equal(meta.cycles_total, 1);
  assert.equal(meta.last_fetch_status, 'ok');
});

test('first_seen survives disappearance and reappearance; cycles_seen increments', () => {
  const db = openUnofficialDb(':memory:');
  recordUnofficialCycle(db, [sample('a', { name: 'First' })], { now: () => '2026-08-16T00:00:00.000Z' });
  recordUnofficialCycle(db, [sample('b')], { now: () => '2026-08-16T00:15:00.000Z' });
  const gone = getUnofficialServer(db, 'a');
  assert.equal(gone.cycles_seen, 1);
  assert.equal(gone.last_seen, '2026-08-16T00:00:00.000Z');
  assert.equal(gone.name, 'First');

  recordUnofficialCycle(db, [sample('a', { name: 'Back', playersNow: 9 })], { now: () => '2026-08-16T00:30:00.000Z' });
  const back = getUnofficialServer(db, 'a');
  assert.equal(back.first_seen, '2026-08-16T00:00:00.000Z');
  assert.equal(back.last_seen, '2026-08-16T00:30:00.000Z');
  assert.equal(back.cycles_seen, 2);
  assert.equal(back.name, 'Back');
  assert.equal(back.players_now, 9);
  assert.equal(getUnofficialMeta(db).cycles_total, 3);
});

test('cycles_total bumps once per cycle, not once per server', () => {
  const db = openUnofficialDb(':memory:');
  recordUnofficialCycle(db, [sample('a'), sample('b'), sample('c')], { now: () => '2026-08-16T01:00:00.000Z' });
  assert.equal(getUnofficialMeta(db).cycles_total, 1);
  recordUnofficialCycle(db, [sample('a'), sample('b')], { now: () => '2026-08-16T01:15:00.000Z' });
  assert.equal(getUnofficialMeta(db).cycles_total, 2);
  assert.equal(getUnofficialServer(db, 'a').cycles_seen, 2);
  assert.equal(getUnofficialServer(db, 'c').cycles_seen, 1);
});

test('absent servers are left untouched during a cycle', () => {
  const db = openUnofficialDb(':memory:');
  recordUnofficialCycle(db, [sample('keep'), sample('drop')], { now: () => '2026-08-16T02:00:00.000Z' });
  recordUnofficialCycle(db, [sample('keep', { playersNow: 7 })], { now: () => '2026-08-16T02:15:00.000Z' });
  const dropped = getUnofficialServer(db, 'drop');
  assert.equal(dropped.cycles_seen, 1);
  assert.equal(dropped.last_seen, '2026-08-16T02:00:00.000Z');
  assert.equal(dropped.players_now, 3);
  assert.equal(getUnofficialServer(db, 'keep').players_now, 7);
});

test('recordUnofficialFetchFailure updates status without bumping cycles_total', () => {
  const db = openUnofficialDb(':memory:');
  recordUnofficialCycle(db, [sample('a')], { now: () => '2026-08-16T03:00:00.000Z' });
  const meta = recordUnofficialFetchFailure(db, { now: () => '2026-08-16T03:15:00.000Z', error: 'cdn down' });
  assert.equal(meta.cycles_total, 1);
  assert.equal(meta.last_fetch_at, '2026-08-16T03:15:00.000Z');
  assert.match(meta.last_fetch_status, /cdn down/);
  assert.equal(getUnofficialServer(db, 'a').cycles_seen, 1);
});

test('servers without an id are skipped', () => {
  const db = openUnofficialDb(':memory:');
  recordUnofficialCycle(db, [{ name: 'no-id' }, sample('ok')], { now: () => '2026-08-16T04:00:00.000Z' });
  assert.equal(getUnofficialServer(db, 'ok').cycles_seen, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM unofficial_servers').get().n, 1);
});

test('tracked_total reflects unofficial_servers row count after cycles', () => {
  const db = openUnofficialDb(':memory:');
  assert.equal(getUnofficialMeta(db).tracked_total, 0);
  recordUnofficialCycle(db, [sample('a'), sample('b')], { now: () => '2026-08-16T05:00:00.000Z' });
  assert.equal(getUnofficialMeta(db).tracked_total, 2);
  recordUnofficialCycle(db, [sample('a'), sample('c')], { now: () => '2026-08-16T05:15:00.000Z' });
  assert.equal(getUnofficialMeta(db).tracked_total, 3);
});
