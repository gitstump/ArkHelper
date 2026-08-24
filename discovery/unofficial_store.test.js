'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const {
  openUnofficialDb,
  recordUnofficialCycle,
  recordUnofficialFetchFailure,
  loadServerCycleState,
  getLastCycleServerKeys,
  getUnofficialMeta,
  getUnofficialServer,
  toUnofficialServerView,
  explainUnofficialServerLookup,
  getUnknownModIds,
  getStaleModIds,
  upsertMods,
  markModsFailed,
  getModsSummary,
  getMod,
} = require('./unofficial_store.js');

function tmpDbFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ark-unofficial-')), 'unofficial.sqlite');
}

function indexNames(db) {
  return db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'`)
    .all()
    .map((r) => r.name)
    .sort();
}

function instrumentDb(db) {
  const stats = { deleteKeys: [], insertCount: 0, perServerSelect: 0 };
  const origPrepare = db.prepare.bind(db);
  const origExec = db.exec.bind(db);
  return {
    stats,
    db: {
      prepare(sql) {
        const stmt = origPrepare(sql);
        const text = String(sql);
        if (/DELETE\s+FROM\s+server_mods/i.test(text)) {
          return {
            run(...args) {
              stats.deleteKeys.push(args[0]);
              return stmt.run(...args);
            },
          };
        }
        if (/INSERT\s+OR\s+IGNORE\s+INTO\s+server_mods/i.test(text)) {
          return {
            run(...args) {
              stats.insertCount += 1;
              return stmt.run(...args);
            },
          };
        }
        if (/SELECT\s+cycles_seen\s+FROM\s+unofficial_servers\s+WHERE\s+server_key/i.test(text)) {
          stats.perServerSelect += 1;
        }
        return stmt;
      },
      exec: origExec,
    },
  };
}

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
    allowCharTransfers: extra.allowCharTransfers,
    allowItemTransfers: extra.allowItemTransfers,
  };
}

test('getLastCycleServerKeys returns only servers seen on the latest successful cycle', () => {
  const db = openUnofficialDb(':memory:');
  assert.equal(getLastCycleServerKeys(db).size, 0);
  recordUnofficialCycle(db, [sample('a'), sample('b')], { now: () => '2026-08-16T00:00:00.000Z' });
  recordUnofficialCycle(db, [sample('a'), sample('c')], { now: () => '2026-08-16T00:15:00.000Z' });
  assert.deepEqual([...getLastCycleServerKeys(db)].sort(), ['a', 'c']);
});

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

test('opening a DB created without mods_hash migrates in place and is idempotent', () => {
  const file = tmpDbFile();
  const raw = new DatabaseSync(file);
  raw.exec(`
    CREATE TABLE unofficial_servers (
      server_key TEXT PRIMARY KEY,
      name TEXT,
      map TEXT,
      game_mode TEXT,
      players_now INTEGER,
      max_players INTEGER,
      version TEXT,
      platform TEXT,
      ping INTEGER,
      has_password INTEGER,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      cycles_seen INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE unofficial_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      cycles_total INTEGER NOT NULL DEFAULT 0,
      last_fetch_at TEXT,
      last_fetch_status TEXT
    );
    CREATE TABLE server_mods (
      server_key TEXT NOT NULL,
      mod_id INTEGER NOT NULL,
      PRIMARY KEY (server_key, mod_id)
    );
  `);
  raw.prepare(
    `INSERT INTO unofficial_servers (
      server_key, name, map, game_mode, players_now, max_players,
      version, platform, ping, has_password, first_seen, last_seen, cycles_seen
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'legacy',
    'Legacy Box',
    'TheIsland_WP',
    'pve',
    4,
    20,
    '92.41',
    'PC',
    40,
    0,
    '2026-08-01T00:00:00.000Z',
    '2026-08-18T00:00:00.000Z',
    7
  );
  raw.close();

  const db = openUnofficialDb(file);
  const cols = db.prepare('PRAGMA table_info(unofficial_servers)').all().map((c) => c.name);
  assert.ok(cols.includes('mods_hash'));
  assert.ok(cols.includes('allow_char_transfers'));
  assert.ok(cols.includes('allow_item_transfers'));
  const row = getUnofficialServer(db, 'legacy');
  assert.equal(row.name, 'Legacy Box');
  assert.equal(row.cycles_seen, 7);
  assert.equal(row.first_seen, '2026-08-01T00:00:00.000Z');
  const names = indexNames(db);
  assert.ok(names.includes('idx_server_mods_mod_id'));
  assert.ok(names.includes('idx_unofficial_servers_last_seen'));
  db.close();

  const again = openUnofficialDb(file);
  const colsAgain = again.prepare('PRAGMA table_info(unofficial_servers)').all().map((c) => c.name);
  assert.ok(colsAgain.includes('mods_hash'));
  assert.equal(getUnofficialServer(again, 'legacy').name, 'Legacy Box');
  const namesAgain = indexNames(again);
  assert.ok(namesAgain.includes('idx_server_mods_mod_id'));
  assert.ok(namesAgain.includes('idx_unofficial_servers_last_seen'));
  again.close();
});

test('fresh open creates mods_hash, transfer columns, and adoption indexes', () => {
  const db = openUnofficialDb(':memory:');
  const cols = db.prepare('PRAGMA table_info(unofficial_servers)').all().map((c) => c.name);
  assert.ok(cols.includes('mods_hash'));
  assert.ok(cols.includes('allow_char_transfers'));
  assert.ok(cols.includes('allow_item_transfers'));
  const names = indexNames(db);
  assert.ok(names.includes('idx_server_mods_mod_id'));
  assert.ok(names.includes('idx_unofficial_servers_last_seen'));
  assert.equal(names.some((n) => /char_transfers|item_transfers/.test(n)), false);
});

test('unchanged mod list skips DELETE/INSERT; rowids stay stable; no per-server SELECT', () => {
  const db = openUnofficialDb(':memory:');
  recordUnofficialCycle(
    db,
    [sample('a', { modIds: [20, 10] }), sample('b', { modIds: [30] })],
    { now: () => '2026-08-19T00:00:00.000Z' }
  );
  const before = db.prepare('SELECT rowid, server_key, mod_id FROM server_mods ORDER BY rowid').all();
  assert.equal(before.length, 3);

  const { db: tracked, stats } = instrumentDb(db);
  const listed = [sample('a', { modIds: [10, 20] }), sample('b', { modIds: [30] })];
  recordUnofficialCycle(tracked, listed, { now: () => '2026-08-19T00:15:00.000Z' });

  assert.deepEqual(stats.deleteKeys, []);
  assert.equal(stats.insertCount, 0);
  assert.equal(stats.perServerSelect, 0);
  const after = db.prepare('SELECT rowid, server_key, mod_id FROM server_mods ORDER BY rowid').all();
  assert.deepEqual(after, before);
  assert.equal(listed[0].cycles_seen, 2);
  assert.equal(listed[1].cycles_seen, 2);
});

test('changed mod list rewrites added and removed ids', () => {
  const db = openUnofficialDb(':memory:');
  recordUnofficialCycle(
    db,
    [sample('a', { modIds: [10, 20] })],
    { now: () => '2026-08-19T01:00:00.000Z' }
  );
  const { db: tracked, stats } = instrumentDb(db);
  recordUnofficialCycle(
    tracked,
    [sample('a', { modIds: [20, 40] })],
    { now: () => '2026-08-19T01:15:00.000Z' }
  );
  assert.deepEqual(stats.deleteKeys, ['a']);
  assert.equal(stats.insertCount, 2);
  const rows = db
    .prepare('SELECT mod_id FROM server_mods WHERE server_key = ? ORDER BY mod_id')
    .all('a')
    .map((r) => r.mod_id);
  assert.deepEqual(rows, [20, 40]);
});

test('server with no mods never triggers a DELETE', () => {
  const db = openUnofficialDb(':memory:');
  const { db: tracked, stats } = instrumentDb(db);
  recordUnofficialCycle(tracked, [sample('empty'), sample('also-empty')], {
    now: () => '2026-08-19T02:00:00.000Z',
  });
  recordUnofficialCycle(tracked, [sample('empty'), sample('also-empty')], {
    now: () => '2026-08-19T02:15:00.000Z',
  });
  assert.deepEqual(stats.deleteKeys, []);
  assert.equal(stats.insertCount, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM server_mods').get().n, 0);
});

test('in-memory cycles_seen matches post-upsert count without a per-server SELECT', () => {
  const db = openUnofficialDb(':memory:');
  const { db: tracked, stats } = instrumentDb(db);
  const first = sample('a', { modIds: [1] });
  recordUnofficialCycle(tracked, [first], { now: () => '2026-08-19T03:00:00.000Z' });
  assert.equal(first.cycles_seen, 1);
  assert.equal(getUnofficialServer(db, 'a').cycles_seen, 1);

  const second = sample('a', { modIds: [1] });
  const newbie = sample('b', { modIds: [1] });
  recordUnofficialCycle(tracked, [second, newbie], { now: () => '2026-08-19T03:15:00.000Z' });
  assert.equal(second.cycles_seen, 2);
  assert.equal(newbie.cycles_seen, 1);
  assert.equal(getUnofficialServer(db, 'a').cycles_seen, 2);
  assert.equal(getUnofficialServer(db, 'b').cycles_seen, 1);
  assert.equal(stats.perServerSelect, 0);
});

test('toUnofficialServerView maps persisted columns and omits in-memory-only fields', () => {
  const db = openUnofficialDb(':memory:');
  recordUnofficialCycle(db, [sample('sess-1', { name: 'Community Box', ping: 40, hasPassword: true })], {
    now: () => '2026-08-16T00:00:00.000Z',
  });
  const view = toUnofficialServerView(getUnofficialServer(db, 'sess-1'));
  assert.deepEqual(view, {
    id: 'sess-1',
    name: 'Community Box',
    map: 'TheIsland_WP',
    gameMode: 'pve',
    playersNow: 3,
    maxPlayers: 20,
    version: '92.41',
    platformType: 'PC',
    ping: 40,
    hasPassword: true,
    allowCharTransfers: null,
    allowItemTransfers: null,
    firstSeen: '2026-08-16T00:00:00.000Z',
    lastSeen: '2026-08-16T00:00:00.000Z',
    cyclesSeen: 1,
  });
  assert.equal(Object.prototype.hasOwnProperty.call(view, 'day'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(view, 'country'), false);
});

test('opening a DB created without transfer columns migrates in place', () => {
  const file = tmpDbFile();
  const raw = new DatabaseSync(file);
  raw.exec(`
    CREATE TABLE unofficial_servers (
      server_key TEXT PRIMARY KEY,
      name TEXT,
      map TEXT,
      game_mode TEXT,
      players_now INTEGER,
      max_players INTEGER,
      version TEXT,
      platform TEXT,
      ping INTEGER,
      has_password INTEGER,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      cycles_seen INTEGER NOT NULL DEFAULT 0,
      mods_hash TEXT
    );
    CREATE TABLE unofficial_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      cycles_total INTEGER NOT NULL DEFAULT 0,
      last_fetch_at TEXT,
      last_fetch_status TEXT
    );
    CREATE TABLE server_mods (
      server_key TEXT NOT NULL,
      mod_id INTEGER NOT NULL,
      PRIMARY KEY (server_key, mod_id)
    );
    INSERT INTO unofficial_meta (id, cycles_total) VALUES (1, 0);
  `);
  raw.prepare(
    `INSERT INTO unofficial_servers (
      server_key, name, map, game_mode, players_now, max_players,
      version, platform, ping, has_password, first_seen, last_seen, cycles_seen, mods_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'legacy',
    'Legacy Box',
    'TheIsland_WP',
    'pve',
    4,
    20,
    '92.41',
    'PC',
    40,
    0,
    '2026-08-01T00:00:00.000Z',
    '2026-08-18T00:00:00.000Z',
    7,
    'abc'
  );
  raw.close();

  let db;
  assert.doesNotThrow(() => {
    db = openUnofficialDb(file);
  });
  const cols = db.prepare('PRAGMA table_info(unofficial_servers)').all().map((c) => c.name);
  assert.ok(cols.includes('allow_char_transfers'));
  assert.ok(cols.includes('allow_item_transfers'));
  const info = Object.fromEntries(
    db.prepare('PRAGMA table_info(unofficial_servers)').all().map((c) => [c.name, c])
  );
  assert.equal(info.allow_char_transfers.dflt_value, null);
  assert.equal(info.allow_item_transfers.dflt_value, null);
  assert.equal(info.allow_char_transfers.notnull, 0);
  assert.equal(info.allow_item_transfers.notnull, 0);
  const row = getUnofficialServer(db, 'legacy');
  assert.equal(row.name, 'Legacy Box');
  assert.equal(row.allow_char_transfers, null);
  assert.equal(row.allow_item_transfers, null);
  db.close();
});

test('recordUnofficialCycle persists transfer flags as 1/0 and unknown as NULL', () => {
  const db = openUnofficialDb(':memory:');
  recordUnofficialCycle(
    db,
    [
      sample('on', { allowCharTransfers: true, allowItemTransfers: true }),
      sample('off', { allowCharTransfers: false, allowItemTransfers: false }),
      sample('unknown'),
      sample('partial', { allowCharTransfers: true }),
    ],
    { now: () => '2026-08-23T00:00:00.000Z' }
  );
  const on = getUnofficialServer(db, 'on');
  assert.equal(on.allow_char_transfers, 1);
  assert.equal(on.allow_item_transfers, 1);
  const off = getUnofficialServer(db, 'off');
  assert.equal(off.allow_char_transfers, 0);
  assert.equal(off.allow_item_transfers, 0);
  const unknown = getUnofficialServer(db, 'unknown');
  assert.equal(unknown.allow_char_transfers, null);
  assert.equal(unknown.allow_item_transfers, null);
  const partial = getUnofficialServer(db, 'partial');
  assert.equal(partial.allow_char_transfers, 1);
  assert.equal(partial.allow_item_transfers, null);

  const viewOn = toUnofficialServerView(on);
  assert.equal(viewOn.allowCharTransfers, true);
  assert.equal(viewOn.allowItemTransfers, true);
  const viewUnknown = toUnofficialServerView(unknown);
  assert.equal(viewUnknown.allowCharTransfers, null);
  assert.equal(viewUnknown.allowItemTransfers, null);
});

test('unknown transfer flags overwrite a prior 1/0 with NULL and never coerce to 0', () => {
  const db = openUnofficialDb(':memory:');
  recordUnofficialCycle(
    db,
    [sample('a', { allowCharTransfers: true, allowItemTransfers: false })],
    { now: () => '2026-08-23T00:00:00.000Z' }
  );
  assert.equal(getUnofficialServer(db, 'a').allow_char_transfers, 1);
  assert.equal(getUnofficialServer(db, 'a').allow_item_transfers, 0);

  recordUnofficialCycle(db, [sample('a')], { now: () => '2026-08-23T00:15:00.000Z' });
  const cleared = getUnofficialServer(db, 'a');
  assert.equal(cleared.allow_char_transfers, null);
  assert.equal(cleared.allow_item_transfers, null);

  recordUnofficialCycle(
    db,
    [sample('a', { allowCharTransfers: false, allowItemTransfers: false })],
    { now: () => '2026-08-23T00:30:00.000Z' }
  );
  const disabled = getUnofficialServer(db, 'a');
  assert.equal(disabled.allow_char_transfers, 0);
  assert.equal(disabled.allow_item_transfers, 0);
});

function loadServerCycleStateWholeTable(db) {
  const prevByKey = new Map();
  const rows = db.prepare('SELECT server_key, cycles_seen, mods_hash FROM unofficial_servers').all();
  for (const row of rows) {
    prevByKey.set(row.server_key, {
      cycles_seen: row.cycles_seen,
      mods_hash: row.mods_hash,
    });
  }
  return prevByKey;
}

function sortedMapEntries(map) {
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

test('openUnofficialDb opens a fixture that already has unofficial_prune_state and does not drop it', () => {
  const file = tmpDbFile();
  const raw = new DatabaseSync(file);
  raw.exec(`
    CREATE TABLE unofficial_servers (
      server_key TEXT PRIMARY KEY,
      name TEXT,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      cycles_seen INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE unofficial_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      cycles_total INTEGER NOT NULL DEFAULT 0,
      last_fetch_at TEXT,
      last_fetch_status TEXT
    );
    CREATE TABLE unofficial_prune_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      pruned_at TEXT NOT NULL
    );
    INSERT INTO unofficial_meta (id, cycles_total) VALUES (1, 0);
    INSERT INTO unofficial_prune_state (id, pruned_at) VALUES (1, '2026-08-23T00:00:00.000Z');
  `);
  raw.close();

  let db;
  assert.doesNotThrow(() => {
    db = openUnofficialDb(file);
  });
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'unofficial_prune_state'")
    .get();
  assert.ok(table);
  const row = db.prepare('SELECT pruned_at FROM unofficial_prune_state WHERE id = 1').get();
  assert.equal(row.pruned_at, '2026-08-23T00:00:00.000Z');
  db.close();
});

test('openUnofficialDb opens a fixture without unofficial_prune_state and does not create it', () => {
  const file = tmpDbFile();
  const raw = new DatabaseSync(file);
  raw.exec(`
    CREATE TABLE unofficial_servers (
      server_key TEXT PRIMARY KEY,
      name TEXT,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      cycles_seen INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE unofficial_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      cycles_total INTEGER NOT NULL DEFAULT 0,
      last_fetch_at TEXT,
      last_fetch_status TEXT
    );
    INSERT INTO unofficial_meta (id, cycles_total) VALUES (1, 0);
  `);
  raw.close();

  let db;
  assert.doesNotThrow(() => {
    db = openUnofficialDb(file);
  });
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'unofficial_prune_state'")
    .get();
  assert.equal(table, undefined);
  db.close();
});

test('loadServerCycleState matches whole-table output for payload keys and omits others', () => {
  const db = openUnofficialDb(':memory:');
  recordUnofficialCycle(db, [sample('keep-a', { modIds: [1] }), sample('keep-b'), sample('gone')], {
    now: () => '2026-08-16T00:00:00.000Z',
  });
  const whole = loadServerCycleStateWholeTable(db);
  const payloadKeys = ['keep-a', 'keep-b', 'brand-new'];
  const scoped = loadServerCycleState(db, payloadKeys);
  const expected = new Map();
  for (const key of payloadKeys) {
    if (whole.has(key)) expected.set(key, whole.get(key));
  }
  assert.deepEqual(sortedMapEntries(scoped), sortedMapEntries(expected));
  assert.ok(whole.has('gone'));
  assert.equal(scoped.has('gone'), false);
  assert.deepEqual(
    sortedMapEntries(loadServerCycleState(db, [...whole.keys()])),
    sortedMapEntries(whole)
  );
});

test('a server present in the payload but absent from the table gets cycles_seen 1', () => {
  const db = openUnofficialDb(':memory:');
  recordUnofficialCycle(db, [sample('existing')], { now: () => '2026-08-16T00:00:00.000Z' });
  recordUnofficialCycle(db, [sample('existing'), sample('newbie')], {
    now: () => '2026-08-16T00:15:00.000Z',
  });
  assert.equal(getUnofficialServer(db, 'newbie').cycles_seen, 1);
  assert.equal(getUnofficialServer(db, 'existing').cycles_seen, 2);
});

test('unofficial server lookup uses the primary-key index', () => {
  const db = openUnofficialDb(':memory:');
  recordUnofficialCycle(db, [sample('sess-1')], { now: () => '2026-08-16T00:00:00.000Z' });
  const plan = explainUnofficialServerLookup(db, 'sess-1');
  const detail = plan.map((row) => row.detail).join('\n');
  assert.match(detail, /SEARCH unofficial_servers/);
  assert.doesNotMatch(detail, /SCAN unofficial_servers/);
});
