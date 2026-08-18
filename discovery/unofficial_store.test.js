'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  openUnofficialDb,
  recordUnofficialCycle,
  recordUnofficialFetchFailure,
  getUnofficialMeta,
  getUnofficialServer,
  getUnknownModIds,
  getStaleModIds,
  upsertMods,
  markModsFailed,
  getModsSummary,
  getMod,
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
    modIds: extra.modIds || [],
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

test('recordUnofficialCycle replaces server_mods each cycle including clearing', () => {
  const db = openUnofficialDb(':memory:');
  recordUnofficialCycle(
    db,
    [sample('a', { modIds: [10, 20] }), sample('b', { modIds: [20] })],
    { now: () => '2026-08-18T00:00:00.000Z' }
  );
  const first = db
    .prepare('SELECT server_key, mod_id FROM server_mods ORDER BY server_key, mod_id')
    .all()
    .map((r) => ({ server_key: r.server_key, mod_id: r.mod_id }));
  assert.deepEqual(first, [
    { server_key: 'a', mod_id: 10 },
    { server_key: 'a', mod_id: 20 },
    { server_key: 'b', mod_id: 20 },
  ]);

  recordUnofficialCycle(
    db,
    [sample('a', { modIds: [30] }), sample('b', { modIds: [] })],
    { now: () => '2026-08-18T00:15:00.000Z' }
  );
  const second = db
    .prepare('SELECT server_key, mod_id FROM server_mods ORDER BY server_key, mod_id')
    .all()
    .map((r) => ({ server_key: r.server_key, mod_id: r.mod_id }));
  assert.deepEqual(second, [{ server_key: 'a', mod_id: 30 }]);
});

test('getUnknownModIds orders by how many servers run the mod', () => {
  const db = openUnofficialDb(':memory:');
  recordUnofficialCycle(
    db,
    [
      sample('a', { modIds: [1, 2] }),
      sample('b', { modIds: [1] }),
      sample('c', { modIds: [1, 3] }),
    ],
    { now: () => '2026-08-18T01:00:00.000Z' }
  );
  upsertMods(db, [{ id: 2, name: 'known' }], { now: () => '2026-08-18T01:00:00.000Z' });
  assert.deepEqual(getUnknownModIds(db, 10), [1, 3]);
  assert.deepEqual(getUnknownModIds(db, 1), [1]);
});

test('getStaleModIds returns resolved mods older than the cutoff', () => {
  const db = openUnofficialDb(':memory:');
  upsertMods(db, [{ id: 1, name: 'old' }], { now: () => '2026-08-01T00:00:00.000Z' });
  upsertMods(db, [{ id: 2, name: 'fresh' }], { now: () => '2026-08-18T00:00:00.000Z' });
  markModsFailed(db, [3], { now: () => '2026-08-02T00:00:00.000Z' });
  assert.deepEqual(getStaleModIds(db, '2026-08-10T00:00:00.000Z', 10), [1, 3]);
  assert.deepEqual(getStaleModIds(db, '2026-08-10T00:00:00.000Z', 1), [1]);
});

test('getModsSummary counts only currently-listed servers for adoption', () => {
  const db = openUnofficialDb(':memory:');
  recordUnofficialCycle(
    db,
    [
      sample('listed-a', { playersNow: 10, modIds: [100, 200] }),
      sample('listed-b', { playersNow: 5, modIds: [100] }),
      sample('listed-c', { playersNow: 2, modIds: [300] }),
    ],
    { now: () => '2026-08-18T10:00:00.000Z' }
  );
  recordUnofficialCycle(
    db,
    [
      sample('listed-a', { playersNow: 8, modIds: [100, 200] }),
      sample('listed-b', { playersNow: 4, modIds: [100] }),
    ],
    { now: () => '2026-08-18T10:15:00.000Z' }
  );
  upsertMods(
    db,
    [
      { id: 100, name: 'S+', author: 'A', downloadCount: 1000 },
      { id: 200, name: 'Awesome', author: 'B', downloadCount: 50 },
    ],
    { now: () => '2026-08-18T10:16:00.000Z' }
  );

  const rows = getModsSummary(db, { lastFetchAt: '2026-08-18T10:15:00.000Z' });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].mod_id, 100);
  assert.equal(rows[0].name, 'S+');
  assert.equal(rows[0].server_count, 2);
  assert.equal(rows[0].players_now, 12);
  assert.equal(rows[1].mod_id, 200);
  assert.equal(rows[1].server_count, 1);
  assert.equal(rows[1].players_now, 8);
  assert.equal(rows.some((r) => r.mod_id === 300), false);
});

test('getMod returns currently-listed servers and null when unknown', () => {
  const db = openUnofficialDb(':memory:');
  recordUnofficialCycle(
    db,
    [
      sample('hot', { name: 'Hot Box', map: 'Extinction_WP', playersNow: 12, modIds: [50] }),
      sample('quiet', { name: 'Quiet', map: 'TheIsland_WP', playersNow: 1, modIds: [50] }),
    ],
    { now: () => '2026-08-18T11:00:00.000Z' }
  );
  upsertMods(db, [{ id: 50, name: 'Stack', author: 'Modder', summary: 'yes' }], {
    now: () => '2026-08-18T11:01:00.000Z',
  });

  const found = getMod(db, 50, { lastFetchAt: '2026-08-18T11:00:00.000Z', serverLimit: 200 });
  assert.equal(found.name, 'Stack');
  assert.equal(found.author, 'Modder');
  assert.equal(found.servers.length, 2);
  assert.equal(found.servers[0].server_key, 'hot');
  assert.equal(found.servers[0].name, 'Hot Box');
  assert.equal(found.servers[0].players_now, 12);
  assert.equal(found.servers[1].server_key, 'quiet');

  const unknown = getMod(db, 999, { lastFetchAt: '2026-08-18T11:00:00.000Z' });
  assert.equal(unknown, null);

  const unresolved = getMod(db, 50, { lastFetchAt: '2026-08-18T11:00:00.000Z', serverLimit: 1 });
  assert.equal(unresolved.servers.length, 1);
});
