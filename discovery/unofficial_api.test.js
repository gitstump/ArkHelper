'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const {
  trimUnofficialServer,
  trimUnofficialList,
  parseUnofficialDay,
  fetchUnofficialRoster,
  assertWithinByteCap,
  realHttpGetCapped,
} = require('./unofficial_api.js');

// Real record, captured verbatim from a live fetch of
// unofficialserverlist.json during Phase A (not fabricated).
const REAL_UNOFFICIAL_SAMPLE = {
  SessionName: 'Crookz Ark  Extinction - (v92.41)',
  ModIDs: '928793,947033,927084',
  AllowDownloadItems: 1,
  SessionID: '52e11cd150124d088443b0c37807c724',
  SessionNameUpper: 'CROOKZ ARK  EXTINCTION - (V92.41)',
  IsOfficial: '0',
  MaxPlayers: 20,
  Steelshield: 1,
  ClusterId: 'paEN3tiGfRXYV-r-ZfySGgjPVmPQ94q8L4WJED3xdzY',
  Sandbox: 'MISSING',
  NumPlayers: 0,
  AllowDownloadChars: 1,
  Port: 6280,
  DayTime: '6992',
  SOTFMatchStarted: false,
  Name: 'Crookz Ark  Extinction',
  ModFileIDs: '8542958,6950581,7612862',
  IP: '31.214.216.231',
  Service: 'WinLiveService',
  ServerPing: 128,
  MinorBuildId: 41,
  HasPassword: false,
  Battleye: 0,
  SessionIsPve: 1,
  MapName: 'Extinction_WP',
  LatencyPort: 'WinLiveLatecyCheckPort',
  LastUpdated: 1786919899006,
  BuildId: 92,
  SearchHandle: 'SearchHandle',
  PlatformType: 'PC+PS5+XSX+WINGDK',
  AllowDownloadDinos: 1,
  GameMode: 'TestGameMode_C',
};

const REAL_UNOFFICIAL_PVP_PASSWORD = {
  SessionID: '3f447345141940a69093a87bc3d88c3a',
  Name: 'Dekalb Boys',
  MapName: 'Valguero_WP',
  SessionIsPve: 0,
  NumPlayers: 0,
  MaxPlayers: 26,
  BuildId: 92,
  MinorBuildId: 41,
  PlatformType: 'PC+PS5+XSX+WINGDK',
  ServerPing: 81,
  HasPassword: true,
  IsOfficial: '0',
};

test('trimUnofficialServer maps live unofficial field names onto the trimmed shape', () => {
  const trimmed = trimUnofficialServer(REAL_UNOFFICIAL_SAMPLE);
  assert.equal(trimmed.id, '52e11cd150124d088443b0c37807c724');
  assert.equal(trimmed.name, 'Crookz Ark  Extinction');
  assert.equal(trimmed.map, 'Extinction_WP');
  assert.equal(trimmed.gameMode, 'pve');
  assert.equal(trimmed.playersNow, 0);
  assert.equal(trimmed.maxPlayers, 20);
  assert.equal(trimmed.version, '92.41');
  assert.equal(trimmed.platformType, 'PC+PS5+XSX+WINGDK');
  assert.equal(trimmed.ping, 128);
  assert.equal(trimmed.wildcardReportedPing, 128);
  assert.equal(trimmed.hasPassword, false);
  assert.deepEqual(trimmed.modIds, [928793, 947033, 927084]);
  assert.equal(trimmed.day, 6992);
  assert.equal(trimmed.allowCharTransfers, true);
  assert.equal(trimmed.allowItemTransfers, true);
  assert.equal(trimmed.ModIDs, undefined);
  assert.equal(trimmed.SessionName, undefined);
  assert.equal(trimmed.rawDetails, undefined);
});

test('parseUnofficialDay accepts live numeric strings, numbers, and Day prefixes; omits junk', () => {
  assert.equal(parseUnofficialDay('7081'), 7081);
  assert.equal(parseUnofficialDay('765'), 765);
  assert.equal(parseUnofficialDay('504'), 504);
  assert.equal(parseUnofficialDay('340'), 340);
  assert.equal(parseUnofficialDay('528'), 528);
  assert.equal(parseUnofficialDay('612'), 612);
  assert.equal(parseUnofficialDay('165'), 165);
  assert.equal(parseUnofficialDay('1031'), 1031);
  assert.equal(parseUnofficialDay('2538'), 2538);
  assert.equal(parseUnofficialDay(5709.9), 5709);
  assert.equal(parseUnofficialDay('Day 5023, 12:34'), 5023);
  assert.equal(parseUnofficialDay('0'), undefined);
  assert.equal(parseUnofficialDay(0), undefined);
  assert.equal(parseUnofficialDay('-3'), undefined);
  assert.equal(parseUnofficialDay('noon'), undefined);
  assert.equal(parseUnofficialDay(''), undefined);
  assert.equal(parseUnofficialDay(undefined), undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(trimUnofficialServer({ SessionID: 'x', DayTime: '0' }), 'day'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(trimUnofficialServer({ SessionID: 'x' }), 'day'), false);
});

test('trimUnofficialServer maps live AllowDownload* numbers and omits missing/malformed flags', () => {
  const bothOn = trimUnofficialServer({ AllowDownloadChars: 1, AllowDownloadItems: 1 });
  assert.equal(bothOn.allowCharTransfers, true);
  assert.equal(bothOn.allowItemTransfers, true);

  const bothOff = trimUnofficialServer({ AllowDownloadChars: 0, AllowDownloadItems: 0 });
  assert.equal(bothOff.allowCharTransfers, false);
  assert.equal(bothOff.allowItemTransfers, false);

  const mixed = trimUnofficialServer({ AllowDownloadChars: 0, AllowDownloadItems: 1 });
  assert.equal(mixed.allowCharTransfers, false);
  assert.equal(mixed.allowItemTransfers, true);

  const empty = trimUnofficialServer({ SessionID: 'x' });
  assert.equal(Object.prototype.hasOwnProperty.call(empty, 'allowCharTransfers'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(empty, 'allowItemTransfers'), false);

  const bad = trimUnofficialServer({ AllowDownloadChars: 'False', AllowDownloadItems: null });
  assert.equal(Object.prototype.hasOwnProperty.call(bad, 'allowCharTransfers'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(bad, 'allowItemTransfers'), false);
});

test('trimUnofficialServer maps SessionIsPve 0 and HasPassword true', () => {
  const trimmed = trimUnofficialServer(REAL_UNOFFICIAL_PVP_PASSWORD);
  assert.equal(trimmed.gameMode, 'pvp');
  assert.equal(trimmed.hasPassword, true);
  assert.equal(trimmed.ping, 81);
  assert.equal(Object.prototype.hasOwnProperty.call(trimmed, 'allowCharTransfers'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(trimmed, 'allowItemTransfers'), false);
});

test('trimUnofficialServer falls back to IP:Port when SessionID is missing', () => {
  const trimmed = trimUnofficialServer({ IP: '1.2.3.4', Port: 7777, Name: 'x' });
  assert.equal(trimmed.id, '1.2.3.4:7777');
});

test('trimUnofficialList maps then releases the raw slots', () => {
  const raw = [REAL_UNOFFICIAL_SAMPLE, REAL_UNOFFICIAL_PVP_PASSWORD];
  const trimmed = trimUnofficialList(raw);
  assert.equal(trimmed.length, 2);
  assert.equal(trimmed[0].id, REAL_UNOFFICIAL_SAMPLE.SessionID);
  assert.equal(trimmed[1].gameMode, 'pvp');
  assert.equal(raw.length, 0);
});

test('assertWithinByteCap rejects a body over the cap', () => {
  assert.throws(() => assertWithinByteCap('abcdefghij', 5), /byte cap/);
});

test('assertWithinByteCap accepts a body at or under the cap', () => {
  assert.equal(assertWithinByteCap('abcd', 4), 4);
  assert.equal(assertWithinByteCap('abc', 10), 3);
});

test('fetchUnofficialRoster trims an injected body and does not keep raw fields', async () => {
  const result = await fetchUnofficialRoster({
    httpGet: async () => ({ status: 200, body: JSON.stringify([REAL_UNOFFICIAL_SAMPLE]) }),
    sleep: async () => {},
  });
  assert.equal(result.count, 1);
  assert.equal(result.servers[0].id, REAL_UNOFFICIAL_SAMPLE.SessionID);
  assert.equal(result.servers[0].name, 'Crookz Ark  Extinction');
  assert.equal(result.servers[0].SessionID, undefined);
  assert.equal(result.servers[0].ModIDs, undefined);
  assert.deepEqual(result.servers[0].modIds, [928793, 947033, 927084]);
});

test('fetchUnofficialRoster rejects an injected body over the byte cap', async () => {
  const body = JSON.stringify([REAL_UNOFFICIAL_SAMPLE]);
  await assert.rejects(
    () =>
      fetchUnofficialRoster({
        httpGet: async () => ({ status: 200, body }),
        sleep: async () => {},
        maxBytes: 10,
      }),
    /byte cap/
  );
});

test('trimUnofficialServer normalizes ModIDs arrays, strings, dupes, junk, cap, and absent', () => {
  assert.deepEqual(trimUnofficialServer({ ModIDs: [928793, '947033', 927084] }).modIds, [928793, 947033, 927084]);
  assert.deepEqual(trimUnofficialServer({ ModIDs: '928793,947033,927084' }).modIds, [928793, 947033, 927084]);
  assert.deepEqual(trimUnofficialServer({ ModIDs: [10, '10', 10, ' 10 '] }).modIds, [10]);
  assert.deepEqual(
    trimUnofficialServer({ ModIDs: [0, -3, 1.5, 'abc', '', null, undefined, '12.5', '1e2', Infinity, NaN, 7] }).modIds,
    [7]
  );
  const overCap = Array.from({ length: 60 }, (_, i) => i + 1);
  assert.deepEqual(trimUnofficialServer({ ModIDs: overCap }).modIds, overCap.slice(0, 50));
  assert.deepEqual(trimUnofficialServer({}).modIds, []);
  assert.deepEqual(trimUnofficialServer({ ModIDs: null }).modIds, []);
  assert.deepEqual(trimUnofficialServer({ ModIDs: 'not-ids' }).modIds, []);
  assert.deepEqual(trimUnofficialServer({ ModIDs: 928793 }).modIds, []);
});

test('realHttpGetCapped aborts a streamed body that exceeds the cap', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('x'.repeat(2000));
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  await assert.rejects(
    () => realHttpGetCapped(`http://127.0.0.1:${port}/`, { maxBytes: 100, timeoutMs: 2000 }),
    /byte cap/
  );
  server.close();
});
