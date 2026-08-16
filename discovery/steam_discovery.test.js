'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ARK_SA_DEDICATED_SERVER_APPID,
  buildFilterString,
  buildServerListUrl,
  parseServerListResponse,
  looksOfficial,
  detectGameMode,
  normalizeServer,
  discoverFullRoster,
  filterOfficial,
  splitByGameMode,
  diffRoster,
} = require('./steam_discovery.js');

// ---------------------------------------------------------------------
// Filter / URL building
// ---------------------------------------------------------------------
test('buildFilterString targets the ARK:SA appid and Official name match by default', () => {
  const filter = buildFilterString();
  assert.equal(filter, `\\appid\\${ARK_SA_DEDICATED_SERVER_APPID}\\name_match\\*Official*`);
});

test('buildFilterString omits name_match when nameMatch is falsy', () => {
  const filter = buildFilterString({ nameMatch: null });
  assert.equal(filter, `\\appid\\${ARK_SA_DEDICATED_SERVER_APPID}`);
});

test('buildServerListUrl includes key, filter, and limit as query params', () => {
  const url = buildServerListUrl({ key: 'abc', filter: '\\appid\\2430930', limit: 500 });
  assert.match(url, /key=abc/);
  assert.match(url, /filter=%5Cappid%5C2430930/);
  assert.match(url, /limit=500/);
});

test('buildServerListUrl defaults the filter when none is given', () => {
  const url = buildServerListUrl({ key: 'abc' });
  assert.match(url, /name_match/);
});

// ---------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------
test('parseServerListResponse extracts the servers array', () => {
  const body = JSON.stringify({ response: { servers: [{ name: 'A' }, { name: 'B' }] } });
  const { servers } = parseServerListResponse(body);
  assert.equal(servers.length, 2);
});

test('parseServerListResponse returns an empty array when response/servers is missing', () => {
  assert.deepEqual(parseServerListResponse('{}').servers, []);
  assert.deepEqual(parseServerListResponse('{"response":{}}').servers, []);
});

test('parseServerListResponse throws clearly on malformed JSON', () => {
  assert.throws(() => parseServerListResponse('not json'), /Failed to parse/);
});

// ---------------------------------------------------------------------
// Heuristics
// ---------------------------------------------------------------------
test('looksOfficial matches the word Official case-insensitively', () => {
  assert.equal(looksOfficial('NA-PVE-GenOne6539 Official Long-term PvE #1030'), true);
  assert.equal(looksOfficial('some official-sounding but lowercase name'), true);
  assert.equal(looksOfficial('[07/08] EliteArk.com Solo-Duo 15x Valg1'), false);
  assert.equal(looksOfficial(undefined), false);
  assert.equal(looksOfficial(''), false);
});

test('looksOfficial does NOT match "unofficial" (official is a substring of it)', () => {
  assert.equal(looksOfficial('C unofficial community server'), false);
  assert.equal(looksOfficial('Totally Unofficial Ragnarok x10'), false);
});

test('detectGameMode reads PVE/PVP from the name', () => {
  assert.equal(detectGameMode({ name: 'NA-PVE-GenOne6539' }), 'pve');
  assert.equal(detectGameMode({ name: 'EU-PVP-Something' }), 'pvp');
  assert.equal(detectGameMode({ name: 'no mode signal here' }), 'unknown');
});

test('detectGameMode also checks gametype as a fallback signal', () => {
  assert.equal(detectGameMode({ name: 'Ambiguous Name', gametype: 'pve,crossplay' }), 'pve');
});

// ---------------------------------------------------------------------
// normalizeServer
// ---------------------------------------------------------------------
test('normalizeServer maps a well-formed Steam server record', () => {
  const raw = {
    addr: '5.62.114.31:7781',
    gameport: 7781,
    steamid: '90123456789012345',
    name: 'NA-PVE-GenOne6539 Official Long-term PvE #1030',
    map: 'Genesis_WP',
    version: '92.41',
    players: 68,
    max_players: 70,
    bots: 0,
    region: 0,
    dedicated: true,
    secure: true,
    gamedir: 'ark',
    gametype: 'pve',
  };
  const server = normalizeServer(raw);
  assert.equal(server.id, '5.62.114.31:7781');
  assert.equal(server.ip, '5.62.114.31');
  assert.equal(server.port, 7781);
  assert.equal(server.official, true);
  assert.equal(server.gameMode, 'pve');
  assert.equal(server.map, 'Genesis_WP');
  assert.equal(server.playersNow, 68);
  assert.equal(server.maxPlayers, 70);
});

test('normalizeServer is defensive on a mostly-empty record', () => {
  const server = normalizeServer({});
  assert.equal(server.id, null);
  assert.equal(server.official, false);
  assert.equal(server.gameMode, 'unknown');
  assert.equal(server.playersNow, null);
});

test('normalizeServer never throws, even on null input', () => {
  assert.doesNotThrow(() => normalizeServer(null));
  assert.doesNotThrow(() => normalizeServer(undefined));
});

test('normalizeServer derives port from addr when gameport is absent', () => {
  const server = normalizeServer({ addr: '1.2.3.4:27015', name: 'x' });
  assert.equal(server.port, 27015);
});

// ---------------------------------------------------------------------
// discoverFullRoster (mocked HTTP)
// ---------------------------------------------------------------------
test('discoverFullRoster fetches, parses, and normalizes in one pass', async () => {
  const fakeGet = async () => ({
    status: 200,
    body: JSON.stringify({
      response: {
        servers: [
          { addr: '1.1.1.1:7777', name: 'NA-PVE-X Official', players: 10, max_players: 70 },
          { addr: '2.2.2.2:7777', name: 'EU-PVP-Y Official', players: 20, max_players: 70 },
        ],
      },
    }),
  });
  const { servers, pages } = await discoverFullRoster({ httpGet: fakeGet, sleep: async () => {}, token: 'k' });
  assert.equal(servers.length, 2);
  assert.equal(pages, 1);
  assert.equal(servers[0].official, true);
});

test('discoverFullRoster calls onPage once with a count', async () => {
  const fakeGet = async () => ({
    status: 200,
    body: JSON.stringify({ response: { servers: [{ addr: '1.1.1.1:1', name: 'Official A' }] } }),
  });
  const seen = [];
  await discoverFullRoster({ httpGet: fakeGet, sleep: async () => {}, onPage: (info) => seen.push(info) });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].count, 1);
});

test('discoverFullRoster retries on a 5xx then succeeds', async () => {
  let call = 0;
  const fakeGet = async () => {
    call += 1;
    if (call === 1) return { status: 503, body: '{}' };
    return { status: 200, body: JSON.stringify({ response: { servers: [] } }) };
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
  const fakeGet = async () => ({ status: 403, body: '{"error":"Forbidden"}' });
  await assert.rejects(
    () => discoverFullRoster({ httpGet: fakeGet, sleep: async () => {} }),
    /HTTP 403 from Steam/
  );
});

// ---------------------------------------------------------------------
// Client-side filtering / diffing
// ---------------------------------------------------------------------
test('filterOfficial and splitByGameMode work the same as the BattleMetrics version', () => {
  const servers = [
    { id: '1', official: true, gameMode: 'pve' },
    { id: '2', official: true, gameMode: 'pvp' },
    { id: '3', official: false, gameMode: 'pvp' },
  ];
  assert.equal(filterOfficial(servers).length, 2);
  const split = splitByGameMode(filterOfficial(servers));
  assert.equal(split.pve.length, 1);
  assert.equal(split.pvp.length, 1);
});

test('diffRoster keys on id instead of battlemetricsId', () => {
  const prev = [{ id: 'a' }, { id: 'b' }];
  const next = [{ id: 'b' }, { id: 'c' }];
  const diff = diffRoster(prev, next);
  assert.deepEqual(diff.added.map((s) => s.id), ['c']);
  assert.deepEqual(diff.removed.map((s) => s.id), ['a']);
});
