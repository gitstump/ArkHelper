'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  OFFICIAL_SERVER_LIST_URL,
  parseServerListBody,
  truthyFlag,
  parseTransferFlag,
  parseVersion,
  normalizeServer,
  discoverFullRoster,
  filterOfficial,
  splitByGameMode,
  diffRoster,
} = require('./ark_official_api.js');

// A real record, captured verbatim from a live fetch of
// officialserverlist.json during this build (not fabricated).
const REAL_SAMPLE_PVE = {
  SessionName: 'EU-PVE-TheIsland5313 - (v92.41)',
  AllowDownloadItems: 1,
  SessionID: 'ba8031024542429bb38fee3491e78ec3',
  SessionNameUpper: 'EU-PVE-THEISLAND5313 - (V92.41)',
  IsOfficial: '1',
  MaxPlayers: 70,
  Steelshield: 1,
  ClusterId: 'PVECrossplay',
  Sandbox: 'MISSING',
  AllowDownloadChars: 1,
  NumPlayers: 0,
  Port: 7779,
  DayTime: '12182',
  SOTFMatchStarted: false,
  Name: 'EU-PVE-TheIsland5313',
  IP: '5.62.112.69',
  Service: 'WinLiveService',
  MinorBuildId: 41,
  ServerPing: 180,
  HasPassword: false,
  Battleye: 1,
  SessionIsPve: 1,
  MapName: 'TheIsland_WP',
  LatencyPort: 'WinLiveLatecyCheckPort',
  LastUpdated: 1786781953702,
  BuildId: 92,
  SearchHandle: 'SearchHandle',
  PlatformType: 'PC+XSX+WINGDK+PS5',
  AllowDownloadDinos: 1,
  GameMode: 'TestGameMode_C',
};

function REAL_SAMPLE_PVO_BASE() {
  return {
    SessionName: 'Asia-PVP-LostColony2859 - (v92.41)',
    SessionID: '4a3a710aebb8487aa6d252d991556e1f',
    IsOfficial: '1',
    MaxPlayers: 70,
    ClusterId: 'PVPCrossplay',
    NumPlayers: 2,
    Port: 7777,
    DayTime: '3095',
    Name: 'Asia-PVP-LostColony2859',
    IP: '69.41.165.58',
    MinorBuildId: 41,
    ServerPing: 252,
    HasPassword: false,
    Battleye: 1,
    MapName: 'LostColony_WP',
    SessionIsPve: 0,
    LastUpdated: 1786781995861,
    BuildId: 92,
    PlatformType: 'PC+PS5+XSX',
  };
}

const REAL_SAMPLE_MODDED = {
  ModIDs: '1027407,900062,927131',
  SessionName: 'EU-PVP-Modded-Nyrandil148 - (v92.41)',
  SessionID: '09bffbf7fc184dfdb34f5482f1bd5eeb',
  IsOfficial: '1',
  MaxPlayers: 70,
  ClusterId: 'PVPModdedCrossplay',
  NumPlayers: 0,
  Port: 7781,
  DayTime: '3253',
  Name: 'EU-PVP-Modded-Nyrandil148',
  ModFileIDs: '7783652,6570445,7459121',
  IP: '5.62.112.18',
  MinorBuildId: 41,
  ServerPing: 81,
  HasPassword: false,
  SessionIsPve: 0,
  MapName: 'Nyrandil',
  BuildId: 92,
  PlatformType: 'PC+PS5+XSX',
};

// ---------------------------------------------------------------------
// parseServerListBody
// ---------------------------------------------------------------------
test('parseServerListBody parses a real-shaped array response', () => {
  const body = JSON.stringify([REAL_SAMPLE_PVE]);
  const parsed = parseServerListBody(body);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].Name, 'EU-PVE-TheIsland5313');
});

test('parseServerListBody throws clearly on malformed JSON', () => {
  assert.throws(() => parseServerListBody('not json'), /Failed to parse/);
});

test('parseServerListBody throws clearly if the top level is not an array', () => {
  assert.throws(() => parseServerListBody('{"not":"an array"}'), /expected.*JSON array/i);
});

// ---------------------------------------------------------------------
// truthyFlag
// ---------------------------------------------------------------------
test('truthyFlag handles the real mixed-type flags this API actually returns', () => {
  assert.equal(truthyFlag('1'), true); // IsOfficial comes as a string
  assert.equal(truthyFlag('0'), false);
  assert.equal(truthyFlag(1), true); // SessionIsPve comes as a number
  assert.equal(truthyFlag(0), false);
  assert.equal(truthyFlag(true), true);
  assert.equal(truthyFlag(false), false);
  assert.equal(truthyFlag(undefined), false);
  assert.equal(truthyFlag(null), false);
});

// ---------------------------------------------------------------------
// parseVersion
// ---------------------------------------------------------------------
test('parseVersion combines BuildId and MinorBuildId (matches the (vXX.XX) in real names)', () => {
  assert.equal(parseVersion(REAL_SAMPLE_PVE), '92.41');
});

test('parseVersion falls back to parsing the session name when BuildId fields are missing', () => {
  assert.equal(parseVersion({ SessionName: 'Some-Server - (v50.5)' }), '50.5');
});

test('parseVersion returns null when nothing is available', () => {
  assert.equal(parseVersion({}), null);
});

// ---------------------------------------------------------------------
// normalizeServer — using the real captured samples
// ---------------------------------------------------------------------
test('normalizeServer correctly reads a real official PvE server record', () => {
  const server = normalizeServer(REAL_SAMPLE_PVE);
  assert.equal(server.id, '5.62.112.69:7779');
  assert.equal(server.name, 'EU-PVE-TheIsland5313');
  assert.equal(server.ip, '5.62.112.69');
  assert.equal(server.port, 7779);
  assert.equal(server.map, 'TheIsland_WP');
  assert.equal(server.version, '92.41');
  assert.equal(server.day, 12182);
  assert.equal(server.playersNow, 0);
  assert.equal(server.maxPlayers, 70);
  assert.equal(server.clusterId, 'PVECrossplay');
  assert.equal(server.hasPassword, false);
  assert.equal(server.official, true);
  assert.equal(server.gameMode, 'pve');
  assert.deepEqual(server.modIds, []);
  assert.equal(server.allowCharTransfers, true);
  assert.equal(server.allowItemTransfers, true);
});

test('normalizeServer correctly reads a real official PvP server record', () => {
  const server = normalizeServer(REAL_SAMPLE_PVO_BASE());
  assert.equal(server.gameMode, 'pvp');
  assert.equal(server.official, true);
  assert.equal(server.map, 'LostColony_WP');
});

test('normalizeServer parses ModIDs into an array for a modded official server', () => {
  const server = normalizeServer(REAL_SAMPLE_MODDED);
  assert.deepEqual(server.modIds, ['1027407', '900062', '927131']);
  assert.equal(server.map, 'Nyrandil'); // custom map, not a stock one
});

test('normalizeServer converts LastUpdated epoch ms to an ISO string', () => {
  const server = normalizeServer(REAL_SAMPLE_PVE);
  assert.equal(server.lastUpdated, new Date(1786781953702).toISOString());
});

test('normalizeServer is defensive on a mostly-empty record', () => {
  const server = normalizeServer({});
  assert.equal(server.id, null);
  assert.equal(server.official, false);
  assert.equal(server.gameMode, 'unknown');
  assert.equal(server.day, null);
  assert.equal(server.playersNow, null);
});

test('normalizeServer never throws, even on null/undefined input', () => {
  assert.doesNotThrow(() => normalizeServer(null));
  assert.doesNotThrow(() => normalizeServer(undefined));
});

test('normalizeServer keys id by IP:Port when address is present', () => {
  const withSession = normalizeServer({
    SessionID: 'ba8031024542429bb38fee3491e78ec3',
    IP: '5.62.112.69',
    Port: 7779,
  });
  assert.equal(withSession.id, '5.62.112.69:7779');

  const addressOnly = normalizeServer({ IP: '1.2.3.4', Port: 7777 });
  assert.equal(addressOnly.id, '1.2.3.4:7777');
});

test('normalizeServer yields null when SessionID is present but address is missing', () => {
  const server = normalizeServer({ SessionID: 'ba8031024542429bb38fee3491e78ec3' });
  assert.equal(server.id, null);
  assert.notEqual(server.id, 'ba8031024542429bb38fee3491e78ec3');
});

test('normalizeServer yields null when both SessionID and address are missing', () => {
  assert.equal(normalizeServer({}).id, null);
  assert.equal(normalizeServer({ Name: 'no-address' }).id, null);
});

test('parseTransferFlag converts live 0/1 numbers and sibling boolean/digit-string forms', () => {
  assert.equal(parseTransferFlag(1), true);
  assert.equal(parseTransferFlag(0), false);
  assert.equal(parseTransferFlag(true), true);
  assert.equal(parseTransferFlag(false), false);
  assert.equal(parseTransferFlag('1'), true);
  assert.equal(parseTransferFlag('0'), false);
});

test('parseTransferFlag omits missing, malformed, and unrecognized values', () => {
  assert.equal(parseTransferFlag(undefined), undefined);
  assert.equal(parseTransferFlag(null), undefined);
  assert.equal(parseTransferFlag(''), undefined);
  assert.equal(parseTransferFlag('True'), undefined);
  assert.equal(parseTransferFlag('False'), undefined);
  assert.equal(parseTransferFlag('true'), undefined);
  assert.equal(parseTransferFlag('false'), undefined);
  assert.equal(parseTransferFlag(2), undefined);
  assert.equal(parseTransferFlag('yes'), undefined);
});

test('normalizeServer maps live AllowDownload* numbers and omits missing/malformed flags', () => {
  const bothOn = normalizeServer({ AllowDownloadChars: 1, AllowDownloadItems: 1 });
  assert.equal(bothOn.allowCharTransfers, true);
  assert.equal(bothOn.allowItemTransfers, true);

  const bothOff = normalizeServer({ AllowDownloadChars: 0, AllowDownloadItems: 0 });
  assert.equal(bothOff.allowCharTransfers, false);
  assert.equal(bothOff.allowItemTransfers, false);

  const mixed = normalizeServer({ AllowDownloadChars: 1, AllowDownloadItems: 0 });
  assert.equal(mixed.allowCharTransfers, true);
  assert.equal(mixed.allowItemTransfers, false);

  const empty = normalizeServer({});
  assert.equal(Object.prototype.hasOwnProperty.call(empty, 'allowCharTransfers'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(empty, 'allowItemTransfers'), false);

  const bad = normalizeServer({ AllowDownloadChars: 'True', AllowDownloadItems: 2 });
  assert.equal(Object.prototype.hasOwnProperty.call(bad, 'allowCharTransfers'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(bad, 'allowItemTransfers'), false);

  const oneMissing = normalizeServer({ AllowDownloadChars: 1 });
  assert.equal(oneMissing.allowCharTransfers, true);
  assert.equal(Object.prototype.hasOwnProperty.call(oneMissing, 'allowItemTransfers'), false);
});

// ---------------------------------------------------------------------
// discoverFullRoster (mocked HTTP, real-shaped payload)
// ---------------------------------------------------------------------
test('discoverFullRoster fetches and normalizes the real-shaped array in one pass', async () => {
  const fakeGet = async () => ({
    status: 200,
    body: JSON.stringify([REAL_SAMPLE_PVE, REAL_SAMPLE_PVO_BASE(), REAL_SAMPLE_MODDED]),
  });
  const { servers, pages, debug } = await discoverFullRoster({ httpGet: fakeGet, sleep: async () => {} });
  assert.equal(servers.length, 3);
  assert.equal(pages, 1);
  assert.equal(debug.httpStatus, 200);
  assert.equal(debug.rawServerCount, 3);
  assert.equal(debug.urlUsed, OFFICIAL_SERVER_LIST_URL);
});

test('discoverFullRoster calls onPage once with the right count', async () => {
  const fakeGet = async () => ({ status: 200, body: JSON.stringify([REAL_SAMPLE_PVE]) });
  const seen = [];
  await discoverFullRoster({ httpGet: fakeGet, sleep: async () => {}, onPage: (info) => seen.push(info) });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].count, 1);
});

test('discoverFullRoster retries on a 5xx then succeeds', async () => {
  let call = 0;
  const fakeGet = async () => {
    call += 1;
    if (call === 1) return { status: 503, body: '' };
    return { status: 200, body: JSON.stringify([]) };
  };
  const { servers } = await discoverFullRoster({
    httpGet: fakeGet,
    sleep: async () => {},
    retry: { attempts: 3, baseDelayMs: 1 },
  });
  assert.deepEqual(servers, []);
  assert.equal(call, 2);
});

test('discoverFullRoster throws with a clear message on a non-retryable error', async () => {
  const fakeGet = async () => ({ status: 404, body: 'not found' });
  await assert.rejects(
    () => discoverFullRoster({ httpGet: fakeGet, sleep: async () => {} }),
    /HTTP 404 from ARK official server list/
  );
});

test('discoverFullRoster surfaces a clear error if the CDN ever returns non-JSON (e.g. an HTML error page)', async () => {
  const fakeGet = async () => ({ status: 200, body: '<html>error</html>' });
  await assert.rejects(
    () => discoverFullRoster({ httpGet: fakeGet, sleep: async () => {} }),
    /Failed to parse/
  );
});

// ---------------------------------------------------------------------
// Client-side filtering / diffing
// ---------------------------------------------------------------------
test('filterOfficial passes through real official servers (the correctness backstop)', () => {
  const servers = [normalizeServer(REAL_SAMPLE_PVE), normalizeServer({ ...REAL_SAMPLE_PVE, IsOfficial: '0' })];
  const result = filterOfficial(servers);
  assert.equal(result.length, 1);
});

test('splitByGameMode buckets real pve/pvp records correctly', () => {
  const servers = [normalizeServer(REAL_SAMPLE_PVE), normalizeServer(REAL_SAMPLE_PVO_BASE())];
  const { pve, pvp, unknown } = splitByGameMode(servers);
  assert.equal(pve.length, 1);
  assert.equal(pvp.length, 1);
  assert.equal(unknown.length, 0);
});

test('diffRoster finds added/removed servers keyed on SessionID', () => {
  const prev = [{ id: 'a' }, { id: 'b' }];
  const next = [{ id: 'b' }, { id: 'c' }];
  const diff = diffRoster(prev, next);
  assert.deepEqual(diff.added.map((s) => s.id), ['c']);
  assert.deepEqual(diff.removed.map((s) => s.id), ['a']);
});
