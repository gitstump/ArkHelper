'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb, getAlertSettings } = require('./db.js');
const { parseCookies, buildSetCookie, createAuthServer, fetchAlertsRoster, SESSION_COOKIE, STATE_COOKIE, PRESET_COOKIE } = require('./auth_service.js');
const { HASHED_CACHE_CONTROL, publishStaticAsset, resolveDataUrl } = require('./static_data.js');
const { siteOrigin } = require('./origin.js');
const {
  LOCAL_FETCH_TIMEOUT_HEAVY_MS,
  LOCAL_FETCH_TIMEOUT_BACKGROUND_MS,
  OFFICIAL_ROSTER_CACHE_TTL_MS,
  createTtlCache,
} = require('./local_fetch.js');

// ---------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------
test('parseCookies parses a standard multi-cookie header', () => {
  const cookies = parseCookies('a=1; b=2; c=hello%20world');
  assert.deepEqual(cookies, { a: '1', b: '2', c: 'hello world' });
});

test('parseCookies returns an empty object for a missing header', () => {
  assert.deepEqual(parseCookies(undefined), {});
  assert.deepEqual(parseCookies(''), {});
});

test('buildSetCookie includes HttpOnly, SameSite, and Max-Age', () => {
  const cookie = buildSetCookie('name', 'value', { maxAgeSeconds: 100 });
  assert.match(cookie, /^name=value/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Max-Age=100/);
  assert.doesNotMatch(cookie, /Secure/);
});

test('buildSetCookie adds Secure when requested', () => {
  const cookie = buildSetCookie('name', 'value', { maxAgeSeconds: 100, secure: true });
  assert.match(cookie, /Secure/);
});

test('buildSetCookie with clear:true sets Max-Age=0 and an empty value', () => {
  const cookie = buildSetCookie('name', 'irrelevant', { clear: true });
  assert.match(cookie, /^name=;/);
  assert.match(cookie, /Max-Age=0/);
});

// ---------------------------------------------------------------------
// Server helpers
// ---------------------------------------------------------------------
async function startServer(opts) {
  const server = createAuthServer(opts);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  return { server, port, base: `http://127.0.0.1:${port}` };
}

function fakeDiscordDeps({ userId = '999', username = 'brian', avatar = 'hash' } = {}) {
  return {
    generateState: () => 'FIXED_STATE',
    buildAuthorizeUrl: ({ clientId, redirectUri, state }) => `https://discord.example/authorize?client_id=${clientId}&state=${state}&redirect=${encodeURIComponent(redirectUri)}`,
    exchangeCodeForToken: async ({ code }) => ({ accessToken: `AT-for-${code}`, tokenType: 'Bearer', expiresIn: 604800 }),
    fetchDiscordUser: async ({ accessToken }) => ({ id: userId, username, avatar, raw: {} }),
  };
}

// ---------------------------------------------------------------------
// createAuthServer construction validation
// ---------------------------------------------------------------------
test('createAuthServer throws without required options', () => {
  const db = openDb(':memory:');
  assert.throws(() => createAuthServer({ clientId: 'a', clientSecret: 'b', redirectUri: 'http://x' }), /db is required/);
  assert.throws(() => createAuthServer({ db, redirectUri: 'http://x' }), /clientId and clientSecret/);
  assert.throws(() => createAuthServer({ db, clientId: 'a', clientSecret: 'b' }), /redirectUri is required/);
});

test('createAuthServer throws naming a missing brand asset file', () => {
  const db = openDb(':memory:');
  assert.throws(
    () => createAuthServer({
      db,
      clientId: 'a',
      clientSecret: 'b',
      redirectUri: 'http://x',
      assetsDir: path.join(__dirname, 'assets', '__missing-brand-assets__'),
    }),
    /brand asset missing or unreadable: favicon\.ico/
  );
});

test('createAuthServer fails at boot when the static-data manifest is missing', () => {
  const db = openDb(':memory:');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkhelper-auth-static-'));
  assert.throws(
    () => createAuthServer({
      db,
      clientId: 'a',
      clientSecret: 'b',
      redirectUri: 'http://x',
      staticDataDir: dir,
    }),
    /static data manifest missing:/
  );
});

test('createAuthServer fails at boot when the static-data manifest is missing a required key', () => {
  const db = openDb(':memory:');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkhelper-auth-static-'));
  publishStaticAsset({
    dir,
    logicalName: 'crafting-costs',
    content: Buffer.from('{"items":[]}\n'),
  });
  assert.throws(
    () => createAuthServer({
      db,
      clientId: 'a',
      clientSecret: 'b',
      redirectUri: 'http://x',
      staticDataDir: dir,
    }),
    /static data manifest missing key "demolish-refunds"/
  );
});

// ---------------------------------------------------------------------
// /auth/discord/login
// ---------------------------------------------------------------------
test('GET /auth/discord/login redirects to the authorize URL and sets a state cookie', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
  });

  const res = await fetch(`${base}/auth/discord/login`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /^https:\/\/discord\.example\/authorize/);
  assert.match(res.headers.get('location'), /state=FIXED_STATE/);
  assert.match(res.headers.get('set-cookie'), new RegExp(`${STATE_COOKIE}=FIXED_STATE`));

  server.close();
});

// ---------------------------------------------------------------------
// /auth/discord/callback — full happy path
// ---------------------------------------------------------------------
test('full login flow: login -> callback creates an account, session, and redirects', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    successRedirect: '/welcome',
    discordDeps: fakeDiscordDeps({ userId: '42', username: 'brian' }),
  });

  // Step 1: hit login to get the state cookie (simulating what a browser would carry forward)
  const loginRes = await fetch(`${base}/auth/discord/login`, { redirect: 'manual' });
  const stateCookie = loginRes.headers.get('set-cookie').split(';')[0]; // "ark_oauth_state=FIXED_STATE"

  // Step 2: hit the callback with that cookie plus Discord's redirect params
  const callbackRes = await fetch(`${base}/auth/discord/callback?code=ABC&state=FIXED_STATE`, {
    redirect: 'manual',
    headers: { Cookie: stateCookie },
  });

  assert.equal(callbackRes.status, 302);
  assert.equal(callbackRes.headers.get('location'), '/welcome');

  const setCookies = callbackRes.headers.getSetCookie ? callbackRes.headers.getSetCookie() : [callbackRes.headers.get('set-cookie')];
  const sessionCookieLine = setCookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  assert.ok(sessionCookieLine, 'expected a session cookie to be set');

  // The account should now exist in the DB
  const account = db.prepare('SELECT * FROM accounts WHERE discord_id = ?').get('42');
  assert.ok(account);
  assert.equal(account.discord_username, 'brian');

  server.close();
});

test('callback rejects a mismatched state (CSRF protection)', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
  });

  const res = await fetch(`${base}/auth/discord/callback?code=ABC&state=WRONG_STATE`, {
    headers: { Cookie: `${STATE_COOKIE}=FIXED_STATE` },
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /invalid or missing state/);

  server.close();
});

test('callback rejects when there is no state cookie at all', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
  });

  const res = await fetch(`${base}/auth/discord/callback?code=ABC&state=FIXED_STATE`);
  assert.equal(res.status, 400);

  server.close();
});

test('callback surfaces a Discord-side error param as a 400, not a crash', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
  });

  const res = await fetch(`${base}/auth/discord/callback?error=access_denied`, {
    headers: { Cookie: `${STATE_COOKIE}=FIXED_STATE` },
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /access_denied/);

  server.close();
});

test('callback returns a clear 502 (not a crash) if the token exchange fails', async () => {
  const db = openDb(':memory:');
  const deps = fakeDiscordDeps();
  deps.exchangeCodeForToken = async () => {
    throw new Error('simulated Discord outage');
  };
  const { server, base } = await startServer({ db, clientId: 'CID', clientSecret: 'SECRET', redirectUri: 'http://x/cb', discordDeps: deps });

  const res = await fetch(`${base}/auth/discord/callback?code=ABC&state=FIXED_STATE`, {
    headers: { Cookie: `${STATE_COOKIE}=FIXED_STATE` },
  });
  assert.equal(res.status, 502);
  const body = await res.json();
  assert.match(body.error, /simulated Discord outage/);

  server.close();
});

test('logging in again with the same Discord account reuses the account, not a duplicate', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps({ userId: '42' }),
  });

  for (let i = 0; i < 2; i += 1) {
    await fetch(`${base}/auth/discord/callback?code=ABC${i}&state=FIXED_STATE`, {
      headers: { Cookie: `${STATE_COOKIE}=FIXED_STATE` },
    });
  }

  const count = db.prepare('SELECT COUNT(*) as c FROM accounts WHERE discord_id = ?').get('42');
  assert.equal(count.c, 1);

  server.close();
});

// ---------------------------------------------------------------------
// /auth/me
// ---------------------------------------------------------------------
test('GET /auth/me reports loggedIn:false with no session cookie', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({ db, clientId: 'CID', clientSecret: 'SECRET', redirectUri: 'http://x/cb', discordDeps: fakeDiscordDeps() });

  const res = await fetch(`${base}/auth/me`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.loggedIn, false);

  server.close();
});

test('GET /auth/me reports the account for a valid session', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps({ userId: '42', username: 'brian' }),
  });

  const callbackRes = await fetch(`${base}/auth/discord/callback?code=ABC&state=FIXED_STATE`, {
    redirect: 'manual',
    headers: { Cookie: `${STATE_COOKIE}=FIXED_STATE` },
  });
  const setCookies = callbackRes.headers.getSetCookie ? callbackRes.headers.getSetCookie() : [callbackRes.headers.get('set-cookie')];
  const sessionCookie = setCookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`)).split(';')[0];

  const meRes = await fetch(`${base}/auth/me`, { headers: { Cookie: sessionCookie } });
  const body = await meRes.json();
  assert.equal(body.loggedIn, true);
  assert.equal(body.account.discordId, '42');
  assert.equal(body.account.username, 'brian');

  server.close();
});

// ---------------------------------------------------------------------
// /auth/logout
// ---------------------------------------------------------------------
test('POST /auth/logout clears the session so /auth/me no longer recognizes it', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps({ userId: '42' }),
  });

  const callbackRes = await fetch(`${base}/auth/discord/callback?code=ABC&state=FIXED_STATE`, {
    redirect: 'manual',
    headers: { Cookie: `${STATE_COOKIE}=FIXED_STATE` },
  });
  const setCookies = callbackRes.headers.getSetCookie ? callbackRes.headers.getSetCookie() : [callbackRes.headers.get('set-cookie')];
  const sessionCookie = setCookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`)).split(';')[0];

  const logoutRes = await fetch(`${base}/auth/logout`, { method: 'POST', headers: { Cookie: sessionCookie } });
  assert.equal(logoutRes.status, 200);

  const meRes = await fetch(`${base}/auth/me`, { headers: { Cookie: sessionCookie } });
  const body = await meRes.json();
  assert.equal(body.loggedIn, false);

  server.close();
});

// ---------------------------------------------------------------------
// Unknown routes
// ---------------------------------------------------------------------
test('unknown routes 404 with a helpful body', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({ db, clientId: 'CID', clientSecret: 'SECRET', redirectUri: 'http://x/cb', discordDeps: fakeDiscordDeps() });

  const res = await fetch(`${base}/nonsense`);
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.ok(body.routes.includes('/auth/me'));
  assert.ok(body.routes.includes('/'));
  assert.ok(body.routes.includes('/servers'));
  assert.ok(body.routes.includes('/compare'));
  assert.ok(body.routes.includes('/servers/:id'));
  assert.ok(body.routes.includes('/servers/:id/badge.svg'));
  assert.ok(body.routes.includes('/lists/:slug'));
  assert.ok(body.routes.includes('/maps'));
  assert.ok(body.routes.includes('/maps/:slug'));
  assert.ok(body.routes.includes('/clusters'));
  assert.ok(body.routes.includes('/clusters/:id'));
  assert.ok(body.routes.includes('/guides'));
  assert.ok(body.routes.includes('/guides/:slug'));
  assert.ok(body.routes.includes('/colors'));
  assert.ok(body.routes.includes('/colors/sets/:slug'));
  assert.ok(body.routes.includes('/tools/crafting-cost'));
  assert.ok(body.routes.includes('/data/:hashed.json'));
  assert.ok(body.routes.includes('/tools/demolish-refund'));
  assert.ok(body.routes.includes('/news'));
  assert.ok(body.routes.includes('/mods'));
  assert.ok(body.routes.includes('/mods/:id'));
  assert.ok(body.routes.includes('/rankings'));
  assert.ok(body.routes.includes('/favorites'));
  assert.ok(body.routes.includes('/alerts'));
  assert.ok(body.routes.includes('/alerts/:id'));
  assert.ok(body.routes.includes('/alerts/webhook'));
  assert.ok(body.routes.includes('/alerts/webhook/delete'));
  assert.ok(body.routes.includes('/alerts/webhook/test'));
  assert.ok(body.routes.includes('/robots.txt'));

  server.close();
});

// ---------------------------------------------------------------------
// GET / (homepage)
// ---------------------------------------------------------------------
function fakeHomeDeps(rosterMeta = null) {
  return { fetchRosterMetaSafe: async () => rosterMeta };
}

function fakeBrowserDeps(roster = null) {
  return { fetchJsonSafe: async () => roster };
}

function fakeDetailDeps({ roster = null, historyData = null, rankingData = null, unofficialServer = null } = {}) {
  return {
    fetchJsonSafe: async (url) => {
      if (url.includes('/history/')) return historyData;
      if (url.includes('/rankings/')) return rankingData;
      if (url.includes('/unofficial/server/')) return unofficialServer;
      return roster;
    },
  };
}

function fakeStatsDeps({ roster = null, uptimeLeaderboard = null, ranking = null } = {}) {
  return {
    fetchJsonSafe: async (url) => {
      if (url.includes('/leaderboards/')) return uptimeLeaderboard;
      if (url.includes('/rankings')) return ranking;
      return roster;
    },
  };
}

function makeTestServers() {
  return [
    { id: '1', name: 'EU-PVE-TheIsland5313', map: 'TheIsland_WP', gameMode: 'pve', playersNow: 5, maxPlayers: 70, day: 100, clusterId: 'PVECrossplay', hasPassword: false, wildcardReportedPing: 180 },
    { id: '2', name: 'Asia-PVP-LostColony2859', map: 'LostColony_WP', gameMode: 'pvp', playersNow: 20, maxPlayers: 70, day: 50, clusterId: 'PVPCrossplay', hasPassword: false, wildcardReportedPing: 252 },
  ];
}

test('GET / shows a login link when logged out', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    homeDeps: fakeHomeDeps(),
  });

  const res = await fetch(`${base}/`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /Login with Discord/);

  server.close();
});

test('GET / shows the username when a valid session cookie is sent', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps({ userId: '42', username: 'brian' }),
    homeDeps: fakeHomeDeps(),
  });

  const callbackRes = await fetch(`${base}/auth/discord/callback?code=ABC&state=FIXED_STATE`, {
    redirect: 'manual',
    headers: { Cookie: `${STATE_COOKIE}=FIXED_STATE` },
  });
  const setCookies = callbackRes.headers.getSetCookie ? callbackRes.headers.getSetCookie() : [callbackRes.headers.get('set-cookie')];
  const sessionCookie = setCookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`)).split(';')[0];

  const res = await fetch(`${base}/`, { headers: { Cookie: sessionCookie } });
  const html = await res.text();
  assert.match(html, /title="Logged in via Discord"/);
  assert.match(html, />brian</);
  assert.doesNotMatch(html, /Logged in as/);
  assert.doesNotMatch(html, /Discord ID/);

  server.close();
});

test('GET / includes roster stats when the discovery feed is reachable', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    homeDeps: fakeHomeDeps({ totalOfficial: 3179, pveCount: 1420, pvpCount: 1759, generatedAt: 'NOW' }),
  });

  const res = await fetch(`${base}/`);
  const html = await res.text();
  assert.match(html, /3,179/);

  server.close();
});

test('GET / still renders (200, not a crash) when the discovery feed is unreachable', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    homeDeps: fakeHomeDeps(null), // simulates fetchRosterMetaSafe's own null-on-failure behavior
  });

  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /roster data isn't available/);

  server.close();
});

// ---------------------------------------------------------------------
// GET /servers (browser page)
// ---------------------------------------------------------------------
test('GET /servers renders the roster when the discovery feed is reachable', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps({ servers: makeTestServers() }),
  });

  const res = await fetch(`${base}/servers`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /TheIsland_WP/);
  assert.match(html, /LostColony_WP/);

  server.close();
});

test('GET /servers?transfers= composes with gameMode and excludes unknown-flag servers', async () => {
  const db = openDb(':memory:');
  const roster = {
    servers: [
      { id: '1', name: 'EU-PVE-TheIsland5313', map: 'TheIsland_WP', gameMode: 'pve', playersNow: 5, maxPlayers: 70, day: 100, clusterId: 'C', hasPassword: false, allowCharTransfers: true, allowItemTransfers: true },
      { id: '2', name: 'Asia-PVP-LostColony2859', map: 'LostColony_WP', gameMode: 'pvp', playersNow: 20, maxPlayers: 70, day: 50, clusterId: 'C', hasPassword: false, allowCharTransfers: true, allowItemTransfers: true },
      { id: '3', name: 'NA-PVE-NoFlags', map: 'Astraeos_WP', gameMode: 'pve', playersNow: 1, maxPlayers: 70, day: 10, clusterId: 'C', hasPassword: false },
    ],
  };
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(roster),
  });

  const both = await fetch(`${base}/servers?transfers=both&gameMode=pve`);
  const bothHtml = await both.text();
  assert.match(bothHtml, /EU-PVE-TheIsland5313/);
  assert.doesNotMatch(bothHtml, /Asia-PVP-LostColony2859/);
  assert.doesNotMatch(bothHtml, /NA-PVE-NoFlags/);
  assert.match(bothHtml, /<option value="both" selected>Transfers allowed<\/option>/);

  const any = await fetch(`${base}/servers?gameMode=pve`);
  const anyHtml = await any.text();
  assert.match(anyHtml, /EU-PVE-TheIsland5313/);
  assert.match(anyHtml, /NA-PVE-NoFlags/);

  server.close();
});

test('GET /servers applies query-string filters', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps({ servers: makeTestServers() }),
  });

  const res = await fetch(`${base}/servers?gameMode=pvp`);
  const html = await res.text();
  assert.match(html, /LostColony_WP/);
  assert.doesNotMatch(html, /EU-PVE-TheIsland5313/); // the filtered-out server's name, not just its map (which still appears in the dropdown)

  server.close();
});

test('GET /servers?country=DE filters by country and shows a flag in the Region column', async () => {
  const db = openDb(':memory:');
  const roster = {
    servers: [
      { id: '1', name: 'EU-PVE-TheIsland5313', map: 'TheIsland_WP', gameMode: 'pve', country: 'DE', countryName: 'Germany', playersNow: 5, maxPlayers: 70, day: 100, clusterId: 'C', hasPassword: false },
      { id: '2', name: 'NA-PVP-Astraeos2573', map: 'Astraeos_WP', gameMode: 'pvp', country: 'US', countryName: 'United States', playersNow: 20, maxPlayers: 70, day: 50, clusterId: 'C', hasPassword: false },
    ],
  };
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(roster),
  });

  const res = await fetch(`${base}/servers?country=de`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /EU-PVE-TheIsland5313/);
  assert.doesNotMatch(html, /NA-PVP-Astraeos2573/);
  assert.match(html, /<option value="DE" selected>Germany<\/option>/);
  assert.match(html, /\u{1F1E9}\u{1F1EA} DE/u);

  server.close();
});

test('GET /servers ping/uptime form inputs filter and echo their values', async () => {
  const db = openDb(':memory:');
  const roster = {
    servers: [
      { id: '1', name: 'EU-PVE-TheIsland5313', map: 'TheIsland_WP', gameMode: 'pve', playersNow: 5, maxPlayers: 70, day: 100, clusterId: 'PVECrossplay', hasPassword: false, wildcardReportedPing: 180, uptimePercent: 99 },
      { id: '2', name: 'Asia-PVP-LostColony2859', map: 'LostColony_WP', gameMode: 'pvp', playersNow: 20, maxPlayers: 70, day: 50, clusterId: 'PVPCrossplay', hasPassword: false, wildcardReportedPing: 252, uptimePercent: 50 },
    ],
  };
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(roster),
  });

  const formRes = await fetch(`${base}/servers`);
  const formHtml = await formRes.text();
  assert.match(formHtml, /name="minPing"/);
  assert.match(formHtml, /name="maxPing"/);
  assert.match(formHtml, /name="minUptime"/);
  assert.match(formHtml, /name="clusterId"/);

  const res = await fetch(`${base}/servers?minPing=100&maxPing=200&minUptime=90`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /EU-PVE-TheIsland5313/);
  assert.doesNotMatch(html, /Asia-PVP-LostColony2859/);
  assert.match(html, /name="minPing"[^>]*value="100"/);
  assert.match(html, /name="maxPing"[^>]*value="200"/);
  assert.match(html, /name="minUptime"[^>]*value="90"/);

  server.close();
});

test('GET /servers?clusterId= filters the official roster from the form', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps({ servers: makeTestServers() }),
  });

  const res = await fetch(`${base}/servers?clusterId=PVECrossplay`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /EU-PVE-TheIsland5313/);
  assert.doesNotMatch(html, /Asia-PVP-LostColony2859/);
  assert.match(html, /name="clusterId"[^>]*value="PVECrossplay"/);

  server.close();
});

test('GET /servers shows the fallback (200, not a crash) when the discovery feed is unreachable', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(null),
  });

  const res = await fetch(`${base}/servers`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /discovery service may not be running/);

  server.close();
});

// ---------------------------------------------------------------------
// GET /servers/:id (detail page)
// ---------------------------------------------------------------------
test('GET /servers/:id renders the matching server with history', async () => {
  const db = openDb(':memory:');
  const roster = { servers: [{ id: 'abc', name: 'EU-PVE-TheIsland5313', map: 'TheIsland_WP', gameMode: 'pve', modIds: [] }] };
  const historyData = { uptime: { uptimePercent: 100, totalRuns: 3, presentCount: 3 }, history: [{ seenAt: 'now', playersNow: 5, maxPlayers: 70, day: 1 }] };
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    detailDeps: fakeDetailDeps({ roster, historyData }),
  });

  const res = await fetch(`${base}/servers/abc`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /EU-PVE-TheIsland5313/);
  assert.match(html, /100%/);

  server.close();
});

test('GET /servers/:id returns 404 for an id not in the roster', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    detailDeps: fakeDetailDeps({ roster: { servers: [] } }),
  });

  const res = await fetch(`${base}/servers/does-not-exist`);
  assert.equal(res.status, 404);
  const html = await res.text();
  assert.match(html, /not found/i);

  server.close();
});

test('GET /servers/:id renders a persisted unofficial server with recent changes', async () => {
  const db = openDb(':memory:');
  const unofficialServer = {
    id: 'u-sess-1',
    name: 'Community Box',
    map: 'TheIsland_WP',
    gameMode: 'pve',
    playersNow: 4,
    maxPlayers: 20,
    version: '92.41',
    ping: 40,
    lastSeen: '2026-08-23T12:00:00.000Z',
  };
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    detailDeps: fakeDetailDeps({
      roster: { servers: [] },
      unofficialServer,
      historyData: {
        changeEvents: [
          { eventType: 'version_change', field: 'version', oldValue: '92.45', newValue: '92.47', detectedAt: 'now' },
        ],
      },
    }),
  });

  const res = await fetch(`${base}/servers/u-sess-1`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /Community Box/);
  assert.match(html, /<td>Players<\/td><td>4 \/ 20<\/td>/);
  assert.match(html, /Updated from 92\.45 to 92\.47/);
  assert.doesNotMatch(html, /<h2>Uptime<\/h2>/);
  assert.doesNotMatch(html, /<h2>Recent history<\/h2>/);

  server.close();
});

test('GET /servers/:id still prefers the official roster when the id exists there', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    detailDeps: fakeDetailDeps({
      roster: { servers: [{ id: 'abc', name: 'EU-PVE-TheIsland5313', map: 'TheIsland_WP', gameMode: 'pve', modIds: [] }] },
      unofficialServer: { id: 'abc', name: 'Should Not Win', lastSeen: '2026-08-23T12:00:00.000Z' },
      historyData: { uptime: { uptimePercent: 100, totalRuns: 3, presentCount: 3 }, history: [] },
    }),
  });

  const res = await fetch(`${base}/servers/abc`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /EU-PVE-TheIsland5313/);
  assert.doesNotMatch(html, /Should Not Win/);
  assert.match(html, /<h2>Uptime<\/h2>/);

  server.close();
});

test('GET /servers/:id shows the roster-unavailable page (200, not a crash) when discovery is down', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    detailDeps: fakeDetailDeps({ roster: null }),
  });

  const res = await fetch(`${base}/servers/abc`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /discovery service may not be running/);

  server.close();
});

test('GET /servers/:id still renders the server facts even when history is unavailable', async () => {
  const db = openDb(':memory:');
  const roster = { servers: [{ id: 'abc', name: 'A Server', map: 'M', gameMode: 'pve', modIds: [] }] };
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    detailDeps: fakeDetailDeps({ roster, historyData: null }), // history feed down/unavailable
  });

  const res = await fetch(`${base}/servers/abc`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /A Server/);
  assert.match(html, /Not enough history yet/);

  server.close();
});

test('GET /servers/:id passes changeEvents and heatmap data through when the history feed provides it', async () => {
  const db = openDb(':memory:');
  const roster = { servers: [{ id: 'abc', name: 'A Server', map: 'M', gameMode: 'pve', modIds: [] }] };
  const flatGrid = (extra) => {
    const grid = [];
    for (let dow = 0; dow < 7; dow += 1) for (let hour = 0; hour < 24; hour += 1) grid.push({ dayOfWeek: dow, hour, avgPlayers: null, sampleCount: 0, downtimePercent: null, totalRuns: 0, ...extra });
    return grid;
  };
  const historyData = {
    uptime: { uptimePercent: 100, totalRuns: 5, presentCount: 5 },
    history: [],
    changeLog: [{ changeType: 'wipe', oldValue: '45', newValue: '1', seenAt: 'now' }],
    changeEvents: [{ eventType: 'version_change', field: 'version', oldValue: '92.45', newValue: '92.47', detectedAt: 'now' }],
    peakTimes: flatGrid({ sampleCount: 2 }),
    downtimePatterns: flatGrid({ totalRuns: 2 }),
  };
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    detailDeps: fakeDetailDeps({ roster, historyData }),
  });

  const res = await fetch(`${base}/servers/abc`);
  const html = await res.text();
  assert.doesNotMatch(html, /Wipe detected/);
  assert.doesNotMatch(html, /<h2>Activity log<\/h2>/);
  assert.match(html, /<h2>Recent changes<\/h2>/);
  assert.equal((html.match(/Updated from 92\.45 to 92\.47/g) || []).length, 1);
  assert.match(html, /<svg/); // at least one heatmap rendered

  server.close();
});

test('GET /servers/:id always includes a badge embed section pointed at the right URL', async () => {
  const db = openDb(':memory:');
  const roster = { servers: [{ id: 'abc', name: 'A Server', map: 'M', gameMode: 'pve', modIds: [] }] };
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    detailDeps: fakeDetailDeps({ roster, historyData: null }),
  });

  const res = await fetch(`${base}/servers/abc`);
  const html = await res.text();
  assert.match(html, /src="\/servers\/abc\/badge\.svg"/);

  server.close();
});

test('GET /servers/:id shows the rank neighborhood when the rankings fetch succeeds', async () => {
  const db = openDb(':memory:');
  const roster = {
    servers: [
      { id: 'abc', name: 'A Server', map: 'M', gameMode: 'pve', modIds: [] },
      { id: 'nbr', name: 'Neighbor Server', map: 'M', gameMode: 'pve', modIds: [] },
    ],
  };
  const rankingData = {
    serverId: 'abc',
    ranking: {
      rank: 4,
      percentile: 91.2,
      totalRanked: 50,
      neighbors: [
        { serverId: 'nbr', rank: 3, rankScore: 88, uptimePercent: 99 },
        { serverId: 'abc', rank: 4, rankScore: 87, uptimePercent: 98 },
      ],
    },
  };
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    detailDeps: fakeDetailDeps({ roster, historyData: null, rankingData }),
  });

  const res = await fetch(`${base}/servers/abc`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /<h2>Rank neighborhood<\/h2>/);
  assert.match(html, /Ranked #4 of 50 \u2014 top 91\.2%/);
  assert.match(html, /href="\/servers\/nbr"/);

  server.close();
});

test('GET /servers/:id still renders when the rankings fetch fails', async () => {
  const db = openDb(':memory:');
  const roster = { servers: [{ id: 'abc', name: 'A Server', map: 'M', gameMode: 'pve', modIds: [] }] };
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    detailDeps: fakeDetailDeps({ roster, historyData: null, rankingData: null }),
  });

  const res = await fetch(`${base}/servers/abc`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /A Server/);
  assert.doesNotMatch(html, /Rank neighborhood/);

  server.close();
});

// ---------------------------------------------------------------------
// GET /servers/:id/badge.svg
// ---------------------------------------------------------------------
test('GET /servers/:id/badge.svg returns an online badge for a server in the roster', async () => {
  const db = openDb(':memory:');
  const roster = { servers: [{ id: 'abc', name: 'A Server', playersNow: 5, maxPlayers: 70 }] };
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    detailDeps: fakeDetailDeps({ roster }),
  });

  const res = await fetch(`${base}/servers/abc/badge.svg`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/svg+xml');
  const svg = await res.text();
  assert.match(svg, /5\/70/);
  assert.doesNotMatch(svg, /<script/);

  server.close();
});

test('GET /servers/:id/badge.svg returns an "unknown" badge (never an error) for an id not in the roster', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    detailDeps: fakeDetailDeps({ roster: { servers: [] } }),
  });

  const res = await fetch(`${base}/servers/does-not-exist/badge.svg`);
  assert.equal(res.status, 200); // never a broken image
  const svg = await res.text();
  assert.match(svg, />unknown</);

  server.close();
});

test('GET /servers/:id/badge.svg degrades to "unknown" when the discovery feed is unreachable', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    detailDeps: fakeDetailDeps({ roster: null }),
  });

  const res = await fetch(`${base}/servers/abc/badge.svg`);
  assert.equal(res.status, 200);

  server.close();
});

// ---------------------------------------------------------------------
// Favorites
// ---------------------------------------------------------------------
async function loginAndGetSessionCookie(base, discordDeps) {
  const callbackRes = await fetch(`${base}/auth/discord/callback?code=ABC&state=FIXED_STATE`, {
    redirect: 'manual',
    headers: { Cookie: `${STATE_COOKIE}=FIXED_STATE` },
  });
  const setCookies = callbackRes.headers.getSetCookie ? callbackRes.headers.getSetCookie() : [callbackRes.headers.get('set-cookie')];
  return setCookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`)).split(';')[0];
}

test('GET /favorites prompts login when logged out', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({ db, clientId: 'CID', clientSecret: 'SECRET', redirectUri: 'http://x/cb', discordDeps: fakeDiscordDeps() });

  const res = await fetch(`${base}/favorites`);
  const html = await res.text();
  assert.match(html, /need to be logged in/);

  server.close();
});

test('POST /favorites/:id requires login (401)', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({ db, clientId: 'CID', clientSecret: 'SECRET', redirectUri: 'http://x/cb', discordDeps: fakeDiscordDeps() });

  const res = await fetch(`${base}/favorites/abc`, { method: 'POST' });
  assert.equal(res.status, 401);

  server.close();
});

test('full flow: login, favorite a server, see it on /favorites, unfavorite it', async () => {
  const db = openDb(':memory:');
  const roster = { servers: [{ id: 'abc', name: 'EU-PVE-TheIsland5313', map: 'TheIsland_WP', gameMode: 'pve', playersNow: 5, maxPlayers: 70, day: 1, clusterId: 'C', hasPassword: false }] };
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps({ userId: '42', username: 'brian' }),
    detailDeps: fakeDetailDeps({ roster, historyData: null }),
    browserDeps: fakeBrowserDeps(roster),
  });

  const sessionCookie = await loginAndGetSessionCookie(base, fakeDiscordDeps());

  // Favorite it
  const addRes = await fetch(`${base}/favorites/abc`, { method: 'POST', headers: { Cookie: sessionCookie }, redirect: 'manual' });
  assert.equal(addRes.status, 302);
  assert.equal(addRes.headers.get('location'), '/servers/abc');

  // Detail page should now show "Remove from favorites"
  const detailRes = await fetch(`${base}/servers/abc`, { headers: { Cookie: sessionCookie } });
  const detailHtml = await detailRes.text();
  assert.match(detailHtml, /Remove from favorites/);

  // /favorites should list it
  const favRes = await fetch(`${base}/favorites`, { headers: { Cookie: sessionCookie } });
  const favHtml = await favRes.text();
  assert.match(favHtml, /EU-PVE-TheIsland5313/);

  // Unfavorite it
  const removeRes = await fetch(`${base}/favorites/abc/remove`, { method: 'POST', headers: { Cookie: sessionCookie }, redirect: 'manual' });
  assert.equal(removeRes.status, 302);

  // /favorites should now be empty
  const favRes2 = await fetch(`${base}/favorites`, { headers: { Cookie: sessionCookie } });
  const favHtml2 = await favRes2.text();
  assert.match(favHtml2, /haven't favorited any servers yet/);

  server.close();
});

test('GET /favorites shows a stale note for a favorited server no longer in the roster', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps({ userId: '42' }),
    detailDeps: fakeDetailDeps({ roster: { servers: [] } }), // "abc" won't be found
  });

  const sessionCookie = await loginAndGetSessionCookie(base, fakeDiscordDeps());
  await fetch(`${base}/favorites/abc`, { method: 'POST', headers: { Cookie: sessionCookie } });

  const favRes = await fetch(`${base}/favorites`, { headers: { Cookie: sessionCookie } });
  const favHtml = await favRes.text();
  assert.match(favHtml, /1 favorited server\(s\) no longer appear/);

  server.close();
});

// ---------------------------------------------------------------------
// Alert settings
// ---------------------------------------------------------------------
test('POST /alerts/:id requires login (401)', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({ db, clientId: 'CID', clientSecret: 'SECRET', redirectUri: 'http://x/cb', discordDeps: fakeDiscordDeps() });

  const res = await fetch(`${base}/alerts/abc`, { method: 'POST', body: new URLSearchParams({ notifyDown: 'on' }) });
  assert.equal(res.status, 401);

  server.close();
});

test('full flow: save alert settings, see them pre-filled, then clear them', async () => {
  const db = openDb(':memory:');
  const roster = { servers: [{ id: 'abc', name: 'A Server', map: 'M', gameMode: 'pve', modIds: [] }] };
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps({ userId: '42' }),
    detailDeps: fakeDetailDeps({ roster, historyData: null }),
  });
  const sessionCookie = await loginAndGetSessionCookie(base, fakeDiscordDeps());

  // Save: notifyDown checked, notifyOnline unchecked (simply absent, as a real browser would send)
  const saveRes = await fetch(`${base}/alerts/abc`, {
    method: 'POST',
    headers: { Cookie: sessionCookie },
    body: new URLSearchParams({ notifyDown: 'on', capacityThresholdPct: '85' }),
    redirect: 'manual',
  });
  assert.equal(saveRes.status, 302);
  assert.equal(saveRes.headers.get('location'), '/servers/abc');

  // Detail page should reflect it
  const detailRes = await fetch(`${base}/servers/abc`, { headers: { Cookie: sessionCookie } });
  const detailHtml = await detailRes.text();
  assert.match(detailHtml, /name="notifyDown" checked/);
  assert.doesNotMatch(detailHtml, /name="notifyOnline" checked/);
  assert.match(detailHtml, /name="capacityThresholdPct"[^>]*value="85"/);

  // Confirm it's actually in the DB, not just rendered
  const stored = getAlertSettings(db, 1, 'abc');
  assert.equal(stored.notifyDown, true);
  assert.equal(stored.capacityThresholdPct, 85);

  // Clear everything (submit with nothing checked, empty thresholds)
  await fetch(`${base}/alerts/abc`, {
    method: 'POST',
    headers: { Cookie: sessionCookie },
    body: new URLSearchParams({ capacityThresholdPct: '', minFreeSlots: '' }),
  });
  assert.equal(getAlertSettings(db, 1, 'abc'), null);

  server.close();
});

test('POST /alerts/:id with a malformed request body does not crash the server', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps({ userId: '42' }),
  });
  const sessionCookie = await loginAndGetSessionCookie(base, fakeDiscordDeps());

  const res = await fetch(`${base}/alerts/abc`, { method: 'POST', headers: { Cookie: sessionCookie }, redirect: 'manual' }); // no body at all
  assert.equal(res.status, 302); // empty body just means "nothing checked" — clears/no-ops, doesn't error

  server.close();
});

// ---------------------------------------------------------------------
// GET /alerts feed
// ---------------------------------------------------------------------
test('GET /alerts prompts login when logged out', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({ db, clientId: 'CID', clientSecret: 'SECRET', redirectUri: 'http://x/cb', discordDeps: fakeDiscordDeps() });

  const res = await fetch(`${base}/alerts`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /need to be logged in/);
  assert.match(html, /href="\/auth\/discord\/login"/);

  server.close();
});

test('GET /alerts 200 logged in, renders events, and visiting marks them read', async () => {
  const db = openDb(':memory:');
  const { persistAlertCycle, listAlertEventsForAccount } = require('./db.js');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps({ userId: '42', username: 'brian' }),
  });
  const sessionCookie = await loginAndGetSessionCookie(base, fakeDiscordDeps());

  persistAlertCycle(db, {
    events: [
      {
        accountId: 1,
        serverId: 's1',
        serverName: 'NA-PVE-GenOne6433',
        kind: 'down',
        message: 'NA-PVE-GenOne6433 went offline.',
        createdAt: '2026-08-17T12:00:00.000Z',
      },
    ],
    stateUpdates: [],
  });

  const res = await fetch(`${base}/alerts`, { headers: { Cookie: sessionCookie } });
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /NA-PVE-GenOne6433 went offline\./);
  assert.match(html, /href="\/servers\/s1"/);
  assert.match(html, /class="alert-row unread"/);

  const after = listAlertEventsForAccount(db, 1);
  assert.equal(after.length, 1);
  assert.ok(after[0].readAt);

  const res2 = await fetch(`${base}/alerts`, { headers: { Cookie: sessionCookie } });
  const html2 = await res2.text();
  assert.match(html2, /went offline/);
  assert.doesNotMatch(html2, /alert-row unread/);

  server.close();
});

test('GET /alerts logged in with no events shows the empty state', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps({ userId: '42' }),
  });
  const sessionCookie = await loginAndGetSessionCookie(base, fakeDiscordDeps());

  const res = await fetch(`${base}/alerts`, { headers: { Cookie: sessionCookie } });
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /Nothing in your feed yet/);
  assert.match(html, /href="\/favorites"/);

  server.close();
});

test('GET /alerts renders the health note at 3+ consecutive skips and omits it below 3', async () => {
  const db = openDb(':memory:');
  let skips = 2;
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps({ userId: '42' }),
    getAlertsHealth: () => ({
      consecutiveSkips: skips,
      lastSuccessAt: null,
      lastSkipReason: 'missing_roster',
    }),
  });
  const sessionCookie = await loginAndGetSessionCookie(base, fakeDiscordDeps());

  const below = await fetch(`${base}/alerts`, { headers: { Cookie: sessionCookie } });
  const belowHtml = await below.text();
  assert.equal(below.status, 200);
  assert.doesNotMatch(belowHtml, /unable to run/);
  assert.doesNotMatch(belowHtml, /Alerts may be delayed/);

  skips = 3;
  const at = await fetch(`${base}/alerts`, { headers: { Cookie: sessionCookie } });
  const atHtml = await at.text();
  assert.equal(at.status, 200);
  assert.match(atHtml, /Alert checks have been unable to run for the last 3 cycles\. Alerts may be delayed\./);
  assert.match(atHtml, /class="note"/);

  skips = 13;
  const later = await fetch(`${base}/alerts`, { headers: { Cookie: sessionCookie } });
  assert.match(await later.text(), /last 13 cycles/);

  const loggedOut = await fetch(`${base}/alerts`);
  assert.doesNotMatch(await loggedOut.text(), /unable to run/);

  server.close();
});

test('POST /alerts/:id is unchanged by GET /alerts — still saves settings', async () => {
  const db = openDb(':memory:');
  const roster = { servers: [{ id: 'abc', name: 'A Server', map: 'M', gameMode: 'pve', modIds: [] }] };
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps({ userId: '42' }),
    detailDeps: fakeDetailDeps({ roster, historyData: null }),
  });
  const sessionCookie = await loginAndGetSessionCookie(base, fakeDiscordDeps());

  const saveRes = await fetch(`${base}/alerts/abc`, {
    method: 'POST',
    headers: { Cookie: sessionCookie },
    body: new URLSearchParams({ notifyDown: 'on' }),
    redirect: 'manual',
  });
  assert.equal(saveRes.status, 302);
  assert.equal(saveRes.headers.get('location'), '/servers/abc');
  assert.equal(getAlertSettings(db, 1, 'abc').notifyDown, true);

  const getRes = await fetch(`${base}/alerts`, { headers: { Cookie: sessionCookie } });
  assert.equal(getRes.status, 200);

  server.close();
});

const GOOD_WEBHOOK = 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwx';

test('POST /alerts/webhook requires login (401)', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({ db, clientId: 'CID', clientSecret: 'SECRET', redirectUri: 'http://x/cb', discordDeps: fakeDiscordDeps() });
  const res = await fetch(`${base}/alerts/webhook`, { method: 'POST', body: new URLSearchParams({ url: GOOD_WEBHOOK }) });
  assert.equal(res.status, 401);
  server.close();
});

test('POST /alerts/webhook/delete requires login (401)', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({ db, clientId: 'CID', clientSecret: 'SECRET', redirectUri: 'http://x/cb', discordDeps: fakeDiscordDeps() });
  const res = await fetch(`${base}/alerts/webhook/delete`, { method: 'POST' });
  assert.equal(res.status, 401);
  server.close();
});

test('POST /alerts/webhook/test requires login (401)', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({ db, clientId: 'CID', clientSecret: 'SECRET', redirectUri: 'http://x/cb', discordDeps: fakeDiscordDeps() });
  const res = await fetch(`${base}/alerts/webhook/test`, { method: 'POST' });
  assert.equal(res.status, 401);
  server.close();
});

test('POST /alerts/webhook saves a valid URL, GET /alerts shows the masked form, invalid URL stores nothing', async () => {
  const db = openDb(':memory:');
  const { getAccountWebhook } = require('./db.js');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps({ userId: '42' }),
  });
  const sessionCookie = await loginAndGetSessionCookie(base, fakeDiscordDeps());

  try {
  const bad = await fetch(`${base}/alerts/webhook`, {
    method: 'POST',
    headers: { Cookie: sessionCookie },
    body: new URLSearchParams({ url: 'https://evil.example/hook' }),
  });
  assert.equal(bad.status, 200);
  const badHtml = await bad.text();
  assert.match(badHtml, /valid Discord webhook URL/);
  assert.equal(getAccountWebhook(db, 1), null);

  const saveRes = await fetch(`${base}/alerts/webhook`, {
    method: 'POST',
    headers: { Cookie: sessionCookie },
    body: new URLSearchParams({ url: GOOD_WEBHOOK }),
    redirect: 'manual',
  });
  assert.equal(saveRes.status, 302);
  assert.equal(saveRes.headers.get('location'), '/alerts');
  assert.equal(getAccountWebhook(db, 1).url, GOOD_WEBHOOK);
  assert.equal(getAccountWebhook(db, 1).enabled, true);

  const page = await fetch(`${base}/alerts`, { headers: { Cookie: sessionCookie } });
  const html = await page.text();
  assert.match(html, /••••uvwx/);
  assert.doesNotMatch(html, /abcdefghijklmnopqrstuvwx/);
  assert.match(html, /Enabled/);
  assert.match(html, /Send test/);
  } finally {
  server.close();
  }
});

test('POST /alerts/webhook/delete removes the webhook', async () => {
  const db = openDb(':memory:');
  const { getAccountWebhook, upsertAccountWebhook } = require('./db.js');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps({ userId: '42' }),
  });
  const sessionCookie = await loginAndGetSessionCookie(base, fakeDiscordDeps());
  upsertAccountWebhook(db, 1, GOOD_WEBHOOK);

  const res = await fetch(`${base}/alerts/webhook/delete`, {
    method: 'POST',
    headers: { Cookie: sessionCookie },
    redirect: 'manual',
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/alerts');
  assert.equal(getAccountWebhook(db, 1), null);

  server.close();
});

test('POST /alerts/webhook/test posts the fixed test message and reports success or failure on redirect', async () => {
  const db = openDb(':memory:');
  const { upsertAccountWebhook } = require('./db.js');
  const { TEST_WEBHOOK_MESSAGE } = require('./alert_dispatch.js');
  const calls = [];
  let next = { status: 204, ok: true };
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps({ userId: '42' }),
    webhookPostFn: async (url, content) => {
      calls.push({ url, content });
      return next;
    },
  });
  const sessionCookie = await loginAndGetSessionCookie(base, fakeDiscordDeps());
  upsertAccountWebhook(db, 1, GOOD_WEBHOOK);

  const okRes = await fetch(`${base}/alerts/webhook/test`, {
    method: 'POST',
    headers: { Cookie: sessionCookie },
    redirect: 'manual',
  });
  assert.equal(okRes.status, 302);
  assert.equal(okRes.headers.get('location'), '/alerts?test=ok');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, GOOD_WEBHOOK);
  assert.equal(calls[0].content, TEST_WEBHOOK_MESSAGE);

  const okPage = await fetch(`${base}/alerts?test=ok`, { headers: { Cookie: sessionCookie } });
  assert.match(await okPage.text(), /Test message sent/);

  next = { status: 500, ok: false };
  const failRes = await fetch(`${base}/alerts/webhook/test`, {
    method: 'POST',
    headers: { Cookie: sessionCookie },
    redirect: 'manual',
  });
  assert.equal(failRes.status, 302);
  assert.equal(failRes.headers.get('location'), '/alerts?test=fail');
  const failPage = await fetch(`${base}/alerts?test=fail`, { headers: { Cookie: sessionCookie } });
  assert.match(await failPage.text(), /Test message failed to send/);

  server.close();
});

// ---------------------------------------------------------------------
// GET /stats
// ---------------------------------------------------------------------
test('GET /stats renders live counters and leaderboards from the roster', async () => {
  const db = openDb(':memory:');
  const roster = {
    servers: [
      { id: '1', name: 'A', map: 'TheIsland_WP', gameMode: 'pve', playersNow: 10, maxPlayers: 70, clusterId: 'C1', platformType: 'PC' },
      { id: '2', name: 'B', map: 'Aberration_WP', gameMode: 'pvp', playersNow: 40, maxPlayers: 70, clusterId: 'C2', platformType: 'PC+PS5' },
    ],
  };
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    statsDeps: fakeStatsDeps({ roster, uptimeLeaderboard: null }),
  });

  const res = await fetch(`${base}/stats`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /TheIsland_WP/);
  assert.match(html, /Aberration_WP/);
  assert.match(html, /B/); // top-by-players leaderboard should list server B (40 players) ahead of A

  server.close();
});

test('GET /stats shows the fallback (200, not a crash) when the discovery feed is unreachable', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    statsDeps: fakeStatsDeps({ roster: null }),
  });

  const res = await fetch(`${base}/stats`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /discovery service may not be running/);

  server.close();
});

test('GET /stats links into the leaderboard suite instead of duplicating ranked tables', async () => {
  const db = openDb(':memory:');
  const roster = { servers: [{ id: '1', name: 'A', map: 'M', gameMode: 'pve', playersNow: 5, maxPlayers: 70 }] };
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    statsDeps: fakeStatsDeps({ roster, uptimeLeaderboard: null }),
  });

  const res = await fetch(`${base}/stats`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /href="\/leaderboards"/);
  assert.match(html, /href="\/leaderboards\/map-uptime"/);
  assert.match(html, /href="\/rankings"/);

  server.close();
});

test('GET /stats still 200s when the roster is empty', async () => {
  const db = openDb(':memory:');
  const roster = { servers: [] };
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    statsDeps: fakeStatsDeps({ roster }),
  });

  const res = await fetch(`${base}/stats`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /href="\/leaderboards"/);

  server.close();
});

test('GET /stats reads ranking from roster rankScore without a separate rankings query', async () => {
  const db = openDb(':memory:');
  const roster = {
    servers: [
      { id: '1', name: 'Best', map: 'M', gameMode: 'pve', playersNow: 5, maxPlayers: 70, rankScore: 90, rank: 1, rankComponents: { reliability: 40, connection: 25, activity: 15, confidence: 10 } },
      { id: '2', name: 'Worse', map: 'M', gameMode: 'pvp', playersNow: 1, maxPlayers: 70, rankScore: 20, rank: 2, rankComponents: { reliability: 10, connection: 0, activity: 0, confidence: 10 } },
    ],
  };
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    statsDeps: fakeStatsDeps({ roster, uptimeLeaderboard: null }),
  });

  const res = await fetch(`${base}/stats`);
  const html = await res.text();
  assert.match(html, /href="\/rankings"/);
  assert.match(html, /href="\/leaderboards\/top-100"/);

  server.close();
});

// ---------------------------------------------------------------------
// GET /rankings
// ---------------------------------------------------------------------
test('GET /rankings renders the top servers from roster rankScore', async () => {
  const db = openDb(':memory:');
  const roster = {
    servers: [
      { id: '1', name: 'EU-PVE-TheIsland5313', rankScore: 88, rank: 1, rankComponents: { reliability: 36, connection: 25, activity: 17, confidence: 10 } },
      { id: '2', name: 'NA-PVP-Astraeos2573', rankScore: 40, rank: 2, rankComponents: { reliability: 20, connection: 5, activity: 5, confidence: 10 } },
    ],
  };
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(roster),
  });

  const res = await fetch(`${base}/rankings`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /EU-PVE-TheIsland5313/);
  assert.match(html, /88/);
  assert.match(html, /How the score is built/);
  assert.match(html, /href="\/servers\/1"/);

  server.close();
});

test('GET /rankings shows the fallback (200, not a crash) when the discovery feed is unreachable', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(null),
  });

  const res = await fetch(`${base}/rankings`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /discovery service may not be running/);

  server.close();
});

function leaderboardRoster() {
  return {
    servers: [
      {
        id: 'island-pve',
        name: 'EU-PVE-TheIsland5313',
        map: 'TheIsland_WP',
        gameMode: 'pve',
        playersNow: 10,
        maxPlayers: 70,
        wildcardReportedPing: 40,
        uptimePercent: 99,
        avgPopulationPercent: 50,
        rankScore: 90,
        rank: 1,
        rankComponents: { reliability: 40, connection: 25, activity: 15, confidence: 10 },
      },
      {
        id: 'abb-pvp',
        name: 'Asia-PVP-Aberration1',
        map: 'Aberration_WP',
        gameMode: 'pvp',
        playersNow: 5,
        maxPlayers: 70,
        wildcardReportedPing: 200,
        uptimePercent: 80,
        avgPopulationPercent: 20,
        rankScore: 25,
        rank: 2,
        rankComponents: { reliability: 10, connection: 5, activity: 5, confidence: 10 },
      },
      {
        id: 'new-pve',
        name: 'EU-PVE-New1',
        map: 'Astraeos_WP',
        gameMode: 'pve',
        playersNow: 1,
        maxPlayers: 70,
        wildcardReportedPing: 30,
        uptimePercent: 100,
        avgPopulationPercent: 10,
        rankScore: 8,
        rank: 3,
        rankComponents: { reliability: 8, connection: 0, activity: 0, confidence: 2 },
      },
    ],
  };
}

test('GET /leaderboards renders the suite index', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(leaderboardRoster()),
  });

  const res = await fetch(`${base}/leaderboards`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /<title>ArkHelper \u2014 Leaderboards/);
  assert.match(html, /href="\/leaderboards\/map-uptime"/);
  assert.match(html, /href="\/leaderboards\/pve-vs-pvp"/);
  assert.match(html, /href="\/leaderboards\/regions"/);
  assert.match(html, /href="\/leaderboards\/top-100"/);
  assert.match(html, /href="\/leaderboards\/bottom-100"/);
  assert.match(html, /href="\/rankings"/);

  server.close();
});

test('GET /leaderboards/map-uptime renders map aggregates from roster history fields', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(leaderboardRoster()),
  });

  const res = await fetch(`${base}/leaderboards/map-uptime`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /TheIsland_WP/);
  assert.match(html, /99%/);
  assert.match(html, /Aberration_WP/);
  assert.match(html, /80%/);

  server.close();
});

test('GET /leaderboards/pve-vs-pvp renders mode comparison aggregates', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(leaderboardRoster()),
  });

  const res = await fetch(`${base}/leaderboards/pve-vs-pvp`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /<h2>PvE<\/h2>/);
  assert.match(html, /<h2>PvP<\/h2>/);
  assert.match(html, /TheIsland_WP/);
  assert.match(html, /Aberration_WP/);

  server.close();
});

test('GET /leaderboards/regions aggregates official servers by country', async () => {
  const db = openDb(':memory:');
  const roster = {
    servers: [
      { id: 'de-1', name: 'EU-PVE-1', map: 'TheIsland_WP', gameMode: 'pve', country: 'DE', countryName: 'Germany', playersNow: 10, maxPlayers: 70, wildcardReportedPing: 40, uptimePercent: 90 },
      { id: 'de-2', name: 'EU-PVE-2', map: 'TheIsland_WP', gameMode: 'pve', country: 'DE', countryName: 'Germany', playersNow: 20, maxPlayers: 70, wildcardReportedPing: 60, uptimePercent: 100 },
      { id: 'none', name: 'No-Geo', map: 'Aberration_WP', gameMode: 'pvp', playersNow: 1, maxPlayers: 70, wildcardReportedPing: 20, uptimePercent: 50 },
    ],
  };
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(roster),
  });

  const res = await fetch(`${base}/leaderboards/regions`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /<title>ARK Regional Leaderboard/);
  assert.match(html, /Germany/);
  assert.match(html, /Unknown/);
  assert.match(html, /95%/);
  assert.match(html, /50ms/);

  server.close();
});

test('GET /leaderboards/top-100 reuses rankings content', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(leaderboardRoster()),
  });

  const res = await fetch(`${base}/leaderboards/top-100`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /EU-PVE-TheIsland5313/);
  assert.match(html, /90/);
  assert.match(html, /How the score is built/);

  server.close();
});

test('GET /leaderboards/bottom-100 excludes thin-history servers', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(leaderboardRoster()),
  });

  const res = await fetch(`${base}/leaderboards/bottom-100`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /full week of history/);
  assert.match(html, /Asia-PVP-Aberration1/);
  assert.doesNotMatch(html, /EU-PVE-New1/);

  server.close();
});

test('GET /leaderboards/unknown returns 404', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(leaderboardRoster()),
  });

  const res = await fetch(`${base}/leaderboards/nope`);
  assert.equal(res.status, 404);

  server.close();
});

test('GET /servers shows stamped uptime on a roster row with history', async () => {
  const db = openDb(':memory:');
  const roster = {
    servers: [
      {
        id: '1',
        name: 'EU-PVE-TheIsland5313',
        map: 'TheIsland_WP',
        gameMode: 'pve',
        playersNow: 5,
        maxPlayers: 70,
        day: 100,
        clusterId: 'C',
        hasPassword: false,
        wildcardReportedPing: 40,
        uptimePercent: 97.5,
        rank: 2,
        rankScore: 80,
      },
    ],
  };
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(roster),
  });

  const res = await fetch(`${base}/servers`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /97\.5%/);
  const row = html.match(/<tr>[\s\S]*?EU-PVE-TheIsland5313[\s\S]*?<\/tr>/);
  assert.ok(row);
  const cells = [...row[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
  assert.equal(cells[9], '97.5%');
  assert.doesNotMatch(cells[9], /\u2014/);

  server.close();
});

test('GET /servers?sort=rank orders by rankScore', async () => {
  const db = openDb(':memory:');
  const roster = {
    servers: [
      { id: '1', name: 'Low', map: 'A', gameMode: 'pve', playersNow: 50, maxPlayers: 70, day: 1, clusterId: 'C', hasPassword: false, rankScore: 10 },
      { id: '2', name: 'High', map: 'B', gameMode: 'pvp', playersNow: 1, maxPlayers: 70, day: 1, clusterId: 'C', hasPassword: false, rankScore: 90 },
    ],
  };
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(roster),
  });

  const res = await fetch(`${base}/servers?sort=rank&dir=desc`);
  const html = await res.text();
  server.close();
  assert.ok(html.indexOf('>High<') < html.indexOf('>Low<'), 'High-ranked server should appear before Low-ranked in the table');
});

// ---------------------------------------------------------------------
// GET /is-ark-down and /status
// ---------------------------------------------------------------------
test('GET /is-ark-down renders the stored status snapshot with a short cache', async () => {
  const db = openDb(':memory:');
  const status = {
    state: 'NORMAL',
    verdictKey: 'up',
    offlinePct: 1.2,
    baselinePct: 2,
    onlineCount: 3100,
    totalKnown: 3180,
    rosterFetchFailed: false,
    computedAt: '2026-08-15T12:00:00.000Z',
    activeIncident: null,
    incidents: [],
  };
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    statusDeps: { fetchJsonSafe: async () => status },
  });

  const res = await fetch(`${base}/is-ark-down`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=30');
  const html = await res.text();
  assert.match(html, /ARK official servers look UP/);
  assert.match(html, /3100 \/ 3180/);

  server.close();
});

test('GET /status is an alias of /is-ark-down', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    statusDeps: {
      fetchJsonSafe: async () => ({
        state: 'UPDATE_ROLLOUT',
        verdictKey: 'update',
        offlinePct: 4,
        baselinePct: 3,
        onlineCount: 100,
        totalKnown: 100,
        computedAt: '2026-08-15T12:00:00.000Z',
        incidents: [],
      }),
    },
  });

  const res = await fetch(`${base}/status`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=30');
  assert.match(html, /Update appears to be rolling out/);

  server.close();
});

test('GET /rates renders variant cards and the bonus banner from the discovery feed', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    feedsDeps: {
      fetchJsonSafe: async () => ({
        variants: {
          official: { TamingSpeedMultiplier: 2, HarvestAmountMultiplier: 2, XPMultiplier: 2 },
          arkpocalypse: { TamingSpeedMultiplier: 5 },
        },
        changes: [{ variant: 'official', key: 'TamingSpeedMultiplier', old: 1, new: 2, changedAt: '2026-08-14T00:00:00.000Z' }],
      }),
    },
  });

  const res = await fetch(`${base}/rates`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Bonus rates active/);
  assert.match(html, /Official/);
  assert.match(html, /Arkpocalypse/);
  assert.match(html, /2\u00d7/);

  server.close();
});

test('GET /rates falls back when the discovery feed is unreachable (200, not a crash)', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    feedsDeps: { fetchJsonSafe: async () => null },
  });

  const res = await fetch(`${base}/rates`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Rate data isn't available right now/);

  server.close();
});

test('GET /news renders titles and links from the discovery feed', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    feedsDeps: {
      fetchJsonSafe: async () => ({
        entries: [
          {
            type: 'CTA',
            title: null,
            body: null,
            action: 'Link::https://survivetheark.com/index.php?/articles.html/community-crunch-519-tusk-tusk-boom-r2553/',
            url: 'https://survivetheark.com/index.php?/articles.html/community-crunch-519-tusk-tusk-boom-r2553/',
            firstSeen: '2026-08-16T10:00:00.000Z',
            active: true,
          },
          {
            type: 'CTA',
            title: null,
            action: 'DLC::Dragontopia',
            url: null,
            firstSeen: '2026-08-10T00:00:00.000Z',
            active: true,
          },
        ],
      }),
    },
  });

  const res = await fetch(`${base}/news`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Community Crunch 519: Tusk Tusk Boom/);
  assert.match(html, /Dragontopia/);
  const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
  assert.doesNotMatch(main, /<img\b/i);

  server.close();
});

test('GET /news falls back when the discovery feed is unreachable (200, not a crash)', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    feedsDeps: { fetchJsonSafe: async () => null },
  });

  const res = await fetch(`${base}/news`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /News data isn't available right now/);

  server.close();
});

function fakeModsBrowserDeps({ summary = null, detail = null, unofficialMeta = null } = {}) {
  return {
    fetchJsonSafe: async (url) => {
      const target = String(url);
      if (target.includes('/mods/summary')) return summary;
      if (target.includes('/unofficial/meta')) return unofficialMeta;
      const idMatch = target.match(/\/mods\/(\d+)$/);
      if (idMatch) {
        if (detail && String(detail.mod_id) === idMatch[1]) return detail;
        return null;
      }
      return null;
    },
  };
}

test('GET /mods renders adoption from the discovery feed', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeModsBrowserDeps({
      unofficialMeta: { count: 12 },
      summary: {
        lastFetchAt: '2026-08-18T14:00:00.000Z',
        mods: [
          {
            mod_id: 11,
            name: 'S+',
            author: 'Splus',
            server_count: 2,
            players_now: 9,
            download_count: 1000,
            logo_url: 'https://media.forgecdn.net/avatars/thumb.png',
            website_url: 'https://www.curseforge.com/ark-survival-ascended/mods/splus',
          },
        ],
      },
    }),
  });

  const res = await fetch(`${base}/mods`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Mod adoption/);
  assert.match(html, /Mod data provided by/);
  assert.match(html, /S\+/);
  assert.match(html, /href="\/mods\/11"/);
  assert.match(html, /12 listed/);

  server.close();
});

test('GET /mods falls back when discovery is unreachable (200, not a crash)', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: { fetchJsonSafe: async () => null },
  });

  const res = await fetch(`${base}/mods`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /discovery service may not be running/);

  server.close();
});

test('GET /mods/:id renders the detail page; unknown ids 404', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeModsBrowserDeps({
      detail: {
        mod_id: 11,
        name: 'S+',
        author: 'Splus',
        summary: 'Build.',
        servers: [{ server_key: 'a', name: 'Alpha Box', map: 'TheIsland_WP', players_now: 6 }],
      },
    }),
  });

  const res = await fetch(`${base}/mods/11`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<h1>S\+<\/h1>/);
  assert.match(html, /Alpha Box/);
  assert.doesNotMatch(html, /href="\/servers\/a"/);

  const miss = await fetch(`${base}/mods/999`);
  assert.equal(miss.status, 404);
  assert.match(await miss.text(), /Mod not found/);

  server.close();
});

test('GET /mods summary and detail request the HEAVY timeout budget', async () => {
  const db = openDb(':memory:');
  const seen = [];
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: {
      fetchJsonSafe: async (url, opts = {}) => {
        seen.push({ url: String(url), timeoutMs: opts.timeoutMs });
        const target = String(url);
        if (target.includes('/mods/summary')) return { mods: [], lastFetchAt: null };
        if (target.includes('/unofficial/meta')) return { count: 0 };
        if (/\/mods\/11$/.test(target)) return { mod_id: 11, name: 'S+' };
        return null;
      },
    },
  });

  await fetch(`${base}/mods`);
  await fetch(`${base}/mods/11`);

  const summary = seen.find((call) => call.url.includes('/mods/summary'));
  const detail = seen.find((call) => /\/mods\/11$/.test(call.url));
  assert.ok(summary);
  assert.ok(detail);
  assert.equal(summary.timeoutMs, LOCAL_FETCH_TIMEOUT_HEAVY_MS);
  assert.equal(detail.timeoutMs, LOCAL_FETCH_TIMEOUT_HEAVY_MS);

  server.close();
});

test('alerts roster wiring uses the BACKGROUND timeout budget', async () => {
  let seen;
  const fakeFetch = async (url, opts = {}) => {
    seen = { url, timeoutMs: opts.timeoutMs };
    return { servers: [] };
  };
  await fetchAlertsRoster(fakeFetch);
  assert.equal(seen.url, 'http://localhost:8792/roster');
  assert.equal(seen.timeoutMs, LOCAL_FETCH_TIMEOUT_BACKGROUND_MS);
});

test('GET /is-ark-down falls back when discovery status is unreachable (200, not a crash)', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    statusDeps: { fetchJsonSafe: async () => null },
  });

  const res = await fetch(`${base}/is-ark-down`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Status data isn't available right now/);

  server.close();
});

// ---------------------------------------------------------------------
// Filter presets
// ---------------------------------------------------------------------
function cookiePair(res, name) {
  const all = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
  const line = all.find((c) => c && c.startsWith(`${name}=`));
  return line ? line.split(';')[0] : null;
}

function cookieLine(res, name) {
  const all = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
  return all.find((c) => c && c.startsWith(`${name}=`)) || '';
}

function sequentialToken(prefix = 'SHARE') {
  let n = 0;
  return () => `${prefix}${++n}`;
}

test('logged-out preset save/apply/delete round-trip via cookie', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps({ servers: makeTestServers() }),
  });

  const saveRes = await fetch(`${base}/presets`, {
    method: 'POST',
    body: new URLSearchParams({ name: 'PvE', query: 'gameMode=pve&evil=drop' }),
    redirect: 'manual',
  });
  assert.equal(saveRes.status, 302);
  assert.equal(saveRes.headers.get('location'), '/servers?gameMode=pve');
  const setLine = cookieLine(saveRes, PRESET_COOKIE);
  assert.match(setLine, /HttpOnly/);
  assert.match(setLine, /SameSite=Lax/);
  assert.match(setLine, /Path=\//);
  const presetCookie = cookiePair(saveRes, PRESET_COOKIE);
  assert.ok(presetCookie);

  const listRes = await fetch(`${base}/servers`, { headers: { Cookie: presetCookie } });
  const listHtml = await listRes.text();
  assert.match(listHtml, /href="\/servers\?gameMode=pve"/);
  assert.match(listHtml, />PvE</);
  assert.doesNotMatch(listHtml, /Copy share link/);

  const applyRes = await fetch(`${base}/servers?gameMode=pve`, { headers: { Cookie: presetCookie } });
  const applyHtml = await applyRes.text();
  assert.match(applyHtml, /EU-PVE-TheIsland5313/);
  assert.doesNotMatch(applyHtml, /Asia-PVP-LostColony2859/);
  assert.match(applyHtml, />PvE</);

  const deleteRes = await fetch(`${base}/presets/delete`, {
    method: 'POST',
    headers: { Cookie: presetCookie },
    body: new URLSearchParams({ name: 'PvE', returnQuery: 'gameMode=pve' }),
    redirect: 'manual',
  });
  assert.equal(deleteRes.status, 302);
  const cleared = cookieLine(deleteRes, PRESET_COOKIE);
  assert.match(cleared, /Max-Age=0/);

  server.close();
});

test('GET /servers?gameMode=pve applies the pve filter (preset apply target)', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps({ servers: makeTestServers() }),
  });

  const res = await fetch(`${base}/servers?gameMode=pve`);
  const html = await res.text();
  assert.match(html, /EU-PVE-TheIsland5313/);
  assert.doesNotMatch(html, /Asia-PVP-LostColony2859/);
  assert.match(html, /Save as preset/);

  server.close();
});

test('logged-out preset cap of 3 is enforced with a friendly redirect', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps({ servers: makeTestServers() }),
  });

  let cookie = '';
  for (let i = 0; i < 3; i += 1) {
    const res = await fetch(`${base}/presets`, {
      method: 'POST',
      headers: cookie ? { Cookie: cookie } : {},
      body: new URLSearchParams({ name: `P${i}`, query: `map=M${i}` }),
      redirect: 'manual',
    });
    assert.equal(res.status, 302);
    cookie = cookiePair(res, PRESET_COOKIE);
  }

  const rejected = await fetch(`${base}/presets`, {
    method: 'POST',
    headers: { Cookie: cookie },
    body: new URLSearchParams({ name: 'P3', query: 'map=M3' }),
    redirect: 'manual',
  });
  assert.equal(rejected.status, 302);
  assert.match(rejected.headers.get('location'), /presetError=cookie_cap/);

  const page = await fetch(`${base}/servers?map=M3&presetError=cookie_cap`, { headers: { Cookie: cookie } });
  const html = await page.text();
  assert.match(html, /limited to 3/);

  server.close();
});

test('logged-out preset save rejects a cookie that would exceed ~2KB', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps({ servers: makeTestServers() }),
  });

  const res = await fetch(`${base}/presets`, {
    method: 'POST',
    body: new URLSearchParams({ name: 'Huge', query: `search=${'x'.repeat(4000)}` }),
    redirect: 'manual',
  });
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /presetError=cookie_size/);
  assert.equal(cookiePair(res, PRESET_COOKIE), null);

  server.close();
});

test('logged-in preset CRUD stores in SQLite and shows a share URL', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps({ userId: '42' }),
    browserDeps: fakeBrowserDeps({ servers: makeTestServers() }),
    randomToken: sequentialToken('SHARE'),
  });
  const sessionCookie = await loginAndGetSessionCookie(base);

  const saveRes = await fetch(`${base}/presets`, {
    method: 'POST',
    headers: { Cookie: sessionCookie },
    body: new URLSearchParams({ name: 'PvE', query: 'gameMode=pve&unknown=1' }),
    redirect: 'manual',
  });
  assert.equal(saveRes.status, 302);
  assert.equal(saveRes.headers.get('location'), '/servers?gameMode=pve');
  assert.equal(cookiePair(saveRes, PRESET_COOKIE), null); // account storage, not cookie

  const listed = db.prepare('SELECT * FROM filter_presets').all();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].query_string, 'gameMode=pve');
  assert.equal(listed[0].share_token, 'SHARE1');

  const page = await fetch(`${base}/servers`, { headers: { Cookie: sessionCookie } });
  const html = await page.text();
  assert.match(html, />PvE</);
  assert.match(html, /\/p\/SHARE1/);

  const del = await fetch(`${base}/presets/delete`, {
    method: 'POST',
    headers: { Cookie: sessionCookie },
    body: new URLSearchParams({ id: String(listed[0].id) }),
    redirect: 'manual',
  });
  assert.equal(del.status, 302);
  assert.equal(db.prepare('SELECT COUNT(*) as c FROM filter_presets').get().c, 0);

  server.close();
});

test('logged-in preset cap of 15 is enforced over HTTP', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps({ userId: '42' }),
    browserDeps: fakeBrowserDeps({ servers: makeTestServers() }),
    randomToken: sequentialToken('T'),
  });
  const sessionCookie = await loginAndGetSessionCookie(base);

  for (let i = 0; i < 15; i += 1) {
    const res = await fetch(`${base}/presets`, {
      method: 'POST',
      headers: { Cookie: sessionCookie },
      body: new URLSearchParams({ name: `P${i}`, query: `map=M${i}` }),
      redirect: 'manual',
    });
    assert.equal(res.status, 302);
    assert.doesNotMatch(res.headers.get('location'), /presetError=/);
  }

  const rejected = await fetch(`${base}/presets`, {
    method: 'POST',
    headers: { Cookie: sessionCookie },
    body: new URLSearchParams({ name: 'overflow', query: 'map=Z' }),
    redirect: 'manual',
  });
  assert.match(rejected.headers.get('location'), /presetError=account_cap/);
  assert.equal(db.prepare('SELECT COUNT(*) as c FROM filter_presets').get().c, 15);

  server.close();
});

test('login migrates cookie presets into the account and skips name collisions', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps({ userId: '42', username: 'brian' }),
    browserDeps: fakeBrowserDeps({ servers: makeTestServers() }),
    randomToken: sequentialToken('MIG'),
  });

  // First login + save an account preset named PvE
  const session1 = await loginAndGetSessionCookie(base);
  await fetch(`${base}/presets`, {
    method: 'POST',
    headers: { Cookie: session1 },
    body: new URLSearchParams({ name: 'PvE', query: 'gameMode=pve' }),
    redirect: 'manual',
  });
  await fetch(`${base}/auth/logout`, { method: 'POST', headers: { Cookie: session1 } });

  // Logged-out cookie presets: colliding PvE + a new Ranked
  const cookieSave = await fetch(`${base}/presets`, {
    method: 'POST',
    body: new URLSearchParams({ name: 'PvE', query: 'gameMode=pve&search=island' }),
    redirect: 'manual',
  });
  let presetCookie = cookiePair(cookieSave, PRESET_COOKIE);
  const cookieSave2 = await fetch(`${base}/presets`, {
    method: 'POST',
    headers: { Cookie: presetCookie },
    body: new URLSearchParams({ name: 'Ranked', query: 'sort=rank' }),
    redirect: 'manual',
  });
  presetCookie = cookiePair(cookieSave2, PRESET_COOKIE);

  const callbackRes = await fetch(`${base}/auth/discord/callback?code=ABC2&state=FIXED_STATE`, {
    redirect: 'manual',
    headers: { Cookie: `${STATE_COOKIE}=FIXED_STATE; ${presetCookie}` },
  });
  assert.equal(callbackRes.status, 302);
  const cleared = cookieLine(callbackRes, PRESET_COOKIE);
  assert.match(cleared, /Max-Age=0/);
  const session2 = cookiePair(callbackRes, SESSION_COOKIE);

  const names = db.prepare('SELECT name, query_string FROM filter_presets ORDER BY name').all();
  assert.deepEqual(names.map((r) => r.name), ['PvE', 'Ranked']);
  const pve = names.find((r) => r.name === 'PvE');
  assert.equal(pve.query_string, 'gameMode=pve'); // original account copy, collision skipped

  const page = await fetch(`${base}/servers`, { headers: { Cookie: session2 } });
  const html = await page.text();
  assert.match(html, />Ranked</);
  assert.match(html, />PvE</);

  server.close();
});

test('GET /p/:token redirects to /servers?<sanitized query>', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps({ userId: '42' }),
    browserDeps: fakeBrowserDeps({ servers: makeTestServers() }),
    randomToken: () => 'FIXEDSHARE',
  });
  const sessionCookie = await loginAndGetSessionCookie(base);
  await fetch(`${base}/presets`, {
    method: 'POST',
    headers: { Cookie: sessionCookie },
    body: new URLSearchParams({ name: 'PvE', query: 'gameMode=pve&hack=1' }),
    redirect: 'manual',
  });

  const res = await fetch(`${base}/p/FIXEDSHARE`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/servers?gameMode=pve');

  server.close();
});

test('GET /p/:token returns the same 404 for unknown and deleted tokens', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps({ userId: '42' }),
    browserDeps: fakeBrowserDeps({ servers: makeTestServers() }),
    randomToken: () => 'TO-DELETE',
  });
  const sessionCookie = await loginAndGetSessionCookie(base);
  await fetch(`${base}/presets`, {
    method: 'POST',
    headers: { Cookie: sessionCookie },
    body: new URLSearchParams({ name: 'PvE', query: 'gameMode=pve' }),
    redirect: 'manual',
  });
  const id = db.prepare('SELECT id FROM filter_presets').get().id;
  await fetch(`${base}/presets/delete`, {
    method: 'POST',
    headers: { Cookie: sessionCookie },
    body: new URLSearchParams({ id: String(id) }),
    redirect: 'manual',
  });

  const deleted = await fetch(`${base}/p/TO-DELETE`);
  const unknown = await fetch(`${base}/p/not-a-real-token`);
  assert.equal(deleted.status, 404);
  assert.equal(unknown.status, 404);
  assert.equal(deleted.headers.get('content-type'), unknown.headers.get('content-type'));
  assert.deepEqual(await deleted.json(), await unknown.json());
  const body = await fetch(`${base}/p/also-unknown`).then((r) => r.json());
  assert.equal(body.error, 'not found');
  assert.equal(body.routes, undefined);

  server.close();
});

test('share redirect sanitizes stored query strings and never leaves /servers', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps({ userId: '42' }),
    browserDeps: fakeBrowserDeps({ servers: makeTestServers() }),
  });
  const sessionCookie = await loginAndGetSessionCookie(base);
  const account = db.prepare('SELECT id FROM accounts').get();
  db.prepare(
    'INSERT INTO filter_presets (account_id, name, query_string, share_token, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(account.id, 'Bad', 'gameMode=pve&redirect=https://evil.example/&next=/login', 'BADTOKEN', 'now');

  const res = await fetch(`${base}/p/BADTOKEN`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  const location = res.headers.get('location');
  assert.equal(location, '/servers?gameMode=pve');
  assert.match(location, /^\/servers(\?|$)/);
  assert.doesNotMatch(location, /evil/);
  assert.doesNotMatch(location, /redirect=/);

  const saveRes = await fetch(`${base}/presets`, {
    method: 'POST',
    headers: { Cookie: sessionCookie },
    body: new URLSearchParams({ name: 'Trap', query: 'https://evil.example/phish?gameMode=pve' }),
    redirect: 'manual',
  });
  assert.match(saveRes.headers.get('location'), /presetError=empty_query/);

  server.close();
});

function listRoster() {
  return {
    servers: [
      { id: 'pve', name: 'EU-PVE-TheIsland5313', map: 'TheIsland_WP', gameMode: 'pve', playersNow: 5, maxPlayers: 70, day: 100, rankScore: 80, wildcardReportedPing: 180, platformType: 'PC+XSX+WINGDK+PS5' },
      { id: 'pvp', name: 'Asia-PVP-LostColony2859', map: 'LostColony_WP', gameMode: 'pvp', playersNow: 20, maxPlayers: 70, day: 50, rankScore: 40, wildcardReportedPing: 40, platformType: 'PC+PS5+XSX' },
      { id: 'full', name: 'NA-PVP-Full1', map: 'Astraeos_WP', gameMode: 'pvp', playersNow: 70, maxPlayers: 70, day: 10, rankScore: 90, wildcardReportedPing: 12, platformType: 'XSX+PS5' },
    ],
    totalOfficial: 3,
    generatedAt: '2026-08-16T00:00:00.000Z',
  };
}

function fakeListDeps({ roster = listRoster(), unofficialRoster = { servers: [] }, wipes = { wipes: [] } } = {}) {
  return {
    fetchJsonSafe: async (url) => {
      if (String(url).includes('/history/wipes')) return wipes;
      if (String(url).includes('/unofficial/roster')) return unofficialRoster;
      return roster;
    },
  };
}

test('GET /lists/official-pve renders PvE servers and omits PvP', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeListDeps(),
  });

  const res = await fetch(`${base}/lists/official-pve`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /<title>ARK Official PvE Servers/);
  assert.match(html, /EU-PVE-TheIsland5313/);
  assert.doesNotMatch(html, /Asia-PVP-LostColony2859/);
  assert.match(html, /<summary class="active">Servers<\/summary>/);

  server.close();
});

test('GET /lists/available-now excludes a full server', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeListDeps(),
  });

  const res = await fetch(`${base}/lists/available-now`);
  const html = await res.text();
  assert.match(html, /EU-PVE-TheIsland5313/);
  assert.match(html, /Asia-PVP-LostColony2859/);
  assert.doesNotMatch(html, /NA-PVP-Full1/);
  assert.match(html, /observed/);

  server.close();
});

test('GET /lists/recently-wiped shows in-window wipes and hides older ones', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeListDeps({
      wipes: {
        wipes: [
          { serverId: 'pve', seenAt: new Date().toISOString() },
          { serverId: 'pvp', seenAt: '2020-01-01T00:00:00.000Z' },
        ],
      },
    }),
  });

  const res = await fetch(`${base}/lists/recently-wiped`);
  const html = await res.text();
  assert.match(html, /EU-PVE-TheIsland5313/);
  assert.doesNotMatch(html, /Asia-PVP-LostColony2859/);
  assert.match(html, /Wiped /);
  assert.match(html, /<span class="wipe-type">Official<\/span>/);
  assert.doesNotMatch(html, /<span class="wipe-type">Unofficial<\/span>/);
  assert.match(html, /aria-label="Wipe source"/);

  server.close();
});

test('GET /lists/recently-wiped merges unofficial wipes and filters by type', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeListDeps({
      unofficialRoster: {
        servers: [{ id: 'comm-1', name: 'Community Fresh', map: 'Extinction_WP', gameMode: 'pvp', playersNow: 3, maxPlayers: 20, day: 1 }],
      },
      wipes: {
        wipes: [
          { serverId: 'pve', seenAt: new Date().toISOString() },
          { serverId: 'comm-1', seenAt: new Date().toISOString() },
        ],
      },
    }),
  });

  const all = await fetch(`${base}/lists/recently-wiped`);
  const allHtml = await all.text();
  assert.match(allHtml, /EU-PVE-TheIsland5313/);
  assert.match(allHtml, /Community Fresh/);
  assert.match(allHtml, /<span class="wipe-type">Official<\/span>/);
  assert.match(allHtml, /<span class="wipe-type">Unofficial<\/span>/);
  assert.match(allHtml, /href="\/servers\/comm-1"/);
  assert.match(allHtml, /href="\/servers\/pve"/);

  const official = await fetch(`${base}/lists/recently-wiped?type=official`);
  const officialHtml = await official.text();
  assert.match(officialHtml, /EU-PVE-TheIsland5313/);
  assert.doesNotMatch(officialHtml, /Community Fresh/);

  const unofficial = await fetch(`${base}/lists/recently-wiped?type=unofficial`);
  const unofficialHtml = await unofficial.text();
  assert.match(unofficialHtml, /Community Fresh/);
  assert.match(unofficialHtml, /href="\/servers\/comm-1"/);
  assert.doesNotMatch(unofficialHtml, /EU-PVE-TheIsland5313/);

  server.close();
});

test('GET /lists/low-ping paginates on the list URL', async () => {
  const db = openDb(':memory:');
  const roster = {
    servers: Array.from({ length: 26 }, (_, i) => ({
      id: String(i),
      name: `Srv${String(i).padStart(2, '0')}`,
      map: 'TheIsland_WP',
      gameMode: 'pve',
      playersNow: 1,
      maxPlayers: 70,
      wildcardReportedPing: i + 1,
      platformType: 'PC+PS5+XSX',
    })),
  };
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeListDeps({ roster }),
  });

  const res = await fetch(`${base}/lists/low-ping?page=2`);
  const html = await res.text();
  assert.match(html, /Page 2 of 2/);
  assert.match(html, /href="\/lists\/low-ping\?/);
  assert.match(html, /Srv25/);

  server.close();
});

test('GET /lists/unknown-slug 404s', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
  });

  const res = await fetch(`${base}/lists/not-a-list`);
  assert.equal(res.status, 404);

  server.close();
});

test('GET /servers includes Server lists links and a Platform filter', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(listRoster()),
  });

  const res = await fetch(`${base}/servers`);
  const html = await res.text();
  assert.match(html, /Server lists/);
  assert.match(html, /href="\/lists\/official-pve"/);
  assert.match(html, /name="platform"/);

  server.close();
});

function unofficialTestRoster() {
  return {
    fetchedAt: '2026-08-16T12:00:00.000Z',
    count: 1,
    cycles_total: 4,
    servers: [
      {
        id: 'u1',
        name: 'Community Box',
        map: 'TheIsland_WP',
        gameMode: 'pve',
        playersNow: 4,
        maxPlayers: 20,
        version: '92.41',
        platformType: 'PC',
        wildcardReportedPing: 40,
        hasPassword: false,
        cycles_seen: 3,
      },
    ],
  };
}

function fakeSplitBrowserDeps({ official, unofficial }) {
  return {
    fetchJsonSafe: async (url) => {
      if (String(url).includes('/unofficial/roster')) return unofficial;
      if (String(url).includes('/roster')) return official;
      return null;
    },
  };
}

function fakeSplitHomeDeps({ official, unofficial }) {
  return {
    fetchRosterMetaSafe: async (url) => {
      if (String(url).includes('/unofficial/meta')) return unofficial;
      return official;
    },
  };
}

test('GET /servers default query stays official and ignores unofficial names', async () => {
  const db = openDb(':memory:');
  const official = { servers: makeTestServers() };
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeSplitBrowserDeps({ official, unofficial: unofficialTestRoster() }),
    homeDeps: fakeSplitHomeDeps({
      official: { totalOfficial: 2, pveCount: 1, pvpCount: 1, generatedAt: 'T' },
      unofficial: { count: 1, cycles_total: 4, lastFetchStatus: 'ok' },
    }),
  });

  const res = await fetch(`${base}/servers?gameMode=pve`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /EU-PVE-TheIsland5313/);
  assert.doesNotMatch(html, /Community Box/);
  assert.match(html, /href="\/servers\/1"/);

  server.close();
});

test('GET /servers?source=unofficial lists unofficial servers without rank/uptime', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeSplitBrowserDeps({ official: { servers: makeTestServers() }, unofficial: unofficialTestRoster() }),
    homeDeps: fakeSplitHomeDeps({
      official: { totalOfficial: 2, pveCount: 1, pvpCount: 1, generatedAt: 'T' },
      unofficial: { count: 1, cycles_total: 4, lastFetchStatus: 'ok' },
    }),
  });

  const res = await fetch(`${base}/servers?source=unofficial`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /Community Box/);
  assert.doesNotMatch(html, /EU-PVE-TheIsland5313/);
  assert.match(html, /href="\/servers\/u1"/);
  assert.match(html, />Seen</);
  assert.match(html, /75%/);

  server.close();
});

test('GET /servers?source=unofficial form has ping inputs but strips minUptime', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeSplitBrowserDeps({ official: { servers: makeTestServers() }, unofficial: unofficialTestRoster() }),
    homeDeps: fakeSplitHomeDeps({
      official: { totalOfficial: 2, pveCount: 1, pvpCount: 1, generatedAt: 'T' },
      unofficial: { count: 1, cycles_total: 4, lastFetchStatus: 'ok' },
    }),
  });

  const res = await fetch(`${base}/servers?source=unofficial`);
  const html = await res.text();
  assert.match(html, /name="minPing"/);
  assert.match(html, /name="maxPing"/);
  assert.doesNotMatch(html, /name="minUptime"/);
  assert.doesNotMatch(html, /name="clusterId"/);

  const withBound = await fetch(`${base}/servers?source=unofficial&minUptime=99`);
  const withHtml = await withBound.text();
  assert.equal(withBound.status, 200);
  assert.match(withHtml, /Community Box/);
  assert.doesNotMatch(withHtml, /No servers match these filters/);

  server.close();
});

test('GET /servers?source=unofficial shows the roster-unavailable fallback', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeSplitBrowserDeps({ official: { servers: makeTestServers() }, unofficial: null }),
  });

  const res = await fetch(`${base}/servers?source=unofficial`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /roster data isn't available/);

  server.close();
});

test('GET / includes unofficial count in the hero when unofficial meta is available', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps({ servers: makeTestServers() }),
    homeDeps: fakeSplitHomeDeps({
      official: { totalOfficial: 3179, pveCount: 1420, pvpCount: 1759, generatedAt: 'NOW' },
      unofficial: { count: 56198, cycles_total: 1, lastFetchStatus: 'ok' },
    }),
  });

  const res = await fetch(`${base}/`);
  const html = await res.text();
  assert.match(html, /3,179/);
  assert.match(html, /56,198/);
  assert.match(html, /official \(1,420 PvE \/ 1,759 PvP\) and .* unofficial servers/);

  server.close();
});

function heroSection(html) {
  const match = html.match(/<section class="hero">[\s\S]*?<\/section>/);
  assert.ok(match, 'expected a hero section');
  return match[0];
}

test('GET /servers hero band is identical with source=unofficial', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeSplitBrowserDeps({
      official: { servers: makeTestServers() },
      unofficial: unofficialTestRoster(),
    }),
    homeDeps: fakeSplitHomeDeps({
      official: { totalOfficial: 2, pveCount: 1, pvpCount: 1, generatedAt: 'T' },
      unofficial: { count: 1, playersOnline: 4, cycles_total: 4, lastFetchStatus: 'ok' },
    }),
  });

  const officialRes = await fetch(`${base}/servers`);
  const unofficialRes = await fetch(`${base}/servers?source=unofficial`);
  const officialHtml = await officialRes.text();
  const unofficialHtml = await unofficialRes.text();
  assert.equal(officialRes.status, 200);
  assert.equal(unofficialRes.status, 200);
  assert.equal(heroSection(officialHtml), heroSection(unofficialHtml));
  assert.match(heroSection(officialHtml), /29/);
  assert.match(heroSection(officialHtml), /25 official \u00b7 4 unofficial/);
  assert.match(heroSection(officialHtml), /Unofficial Servers Listed/);

  const homeRes = await fetch(`${base}/`);
  const homeHtml = await homeRes.text();
  assert.equal(heroSection(homeHtml), heroSection(officialHtml));

  server.close();
});

test('GET /servers hero band stays official-only when unofficial meta is unavailable', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeSplitBrowserDeps({
      official: { servers: makeTestServers() },
      unofficial: unofficialTestRoster(),
    }),
    homeDeps: fakeSplitHomeDeps({
      official: { totalOfficial: 2, pveCount: 1, pvpCount: 1, generatedAt: 'T' },
      unofficial: null,
    }),
  });

  const res = await fetch(`${base}/servers?source=unofficial`);
  const html = await res.text();
  const hero = heroSection(html);
  assert.match(hero, />25</);
  assert.doesNotMatch(hero, /Unofficial Servers Listed/);
  assert.doesNotMatch(hero, /official \u00b7 .* unofficial/);
  assert.doesNotMatch(hero, />0</);

  server.close();
});

test('unofficial roster cache avoids a second fetch within the TTL', async () => {
  const db = openDb(':memory:');
  let unofficialCalls = 0;
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    unofficialRosterCache: createTtlCache({ ttlMs: 5 * 60 * 1000, now: () => 1_000 }),
    browserDeps: {
      fetchJsonSafe: async (url) => {
        if (String(url).includes('/unofficial/roster')) {
          unofficialCalls += 1;
          return unofficialTestRoster();
        }
        return { servers: makeTestServers() };
      },
    },
  });

  await fetch(`${base}/servers?source=unofficial`);
  await fetch(`${base}/servers?source=unofficial`);
  assert.equal(unofficialCalls, 1);

  server.close();
});

function countingOfficialRosterDeps({ now, ttlMs } = {}) {
  let officialFetches = 0;
  const fetchJsonSafe = async (url) => {
    if (String(url) === 'http://localhost:8792/roster') {
      officialFetches += 1;
      return { servers: makeTestServers(), generatedAt: 'T' };
    }
    return null;
  };
  const officialRosterCache = createTtlCache({
    ttlMs: ttlMs != null ? ttlMs : OFFICIAL_ROSTER_CACHE_TTL_MS,
    now,
  });
  return {
    officialFetches: () => officialFetches,
    officialRosterCache,
    browserDeps: { fetchJsonSafe },
    detailDeps: { fetchJsonSafe },
    statsDeps: { fetchJsonSafe },
  };
}

test('two official page renders within the roster TTL share one underlying fetch', async () => {
  const db = openDb(':memory:');
  const deps = countingOfficialRosterDeps({ now: () => 1_000 });
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    ...deps,
  });

  const stats = await fetch(`${base}/stats`);
  const rankings = await fetch(`${base}/rankings`);
  assert.equal(stats.status, 200);
  assert.equal(rankings.status, 200);
  assert.equal(deps.officialFetches(), 1);

  server.close();
});

test('official roster cache refetches after the TTL expires', async () => {
  const db = openDb(':memory:');
  let now = 1_000;
  const deps = countingOfficialRosterDeps({ now: () => now });
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    ...deps,
  });

  await fetch(`${base}/stats`);
  await fetch(`${base}/rankings`);
  assert.equal(deps.officialFetches(), 1);
  now = 1_000 + OFFICIAL_ROSTER_CACHE_TTL_MS;
  await fetch(`${base}/maps`);
  assert.equal(deps.officialFetches(), 2);

  server.close();
});

test('alerts engine roster comes from the shared official cache after a page render', async () => {
  const db = openDb(':memory:');
  const deps = countingOfficialRosterDeps({ now: () => 1_000 });
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    ...deps,
  });

  await fetch(`${base}/stats`);
  assert.equal(deps.officialFetches(), 1);
  const roster = await fetchAlertsRoster(deps.browserDeps.fetchJsonSafe, 'http://localhost:8792/roster', deps.officialRosterCache);
  assert.ok(roster && Array.isArray(roster.servers));
  assert.equal(deps.officialFetches(), 1);

  server.close();
});

test('GET /servers stale-serves the last official roster and shows its age', async () => {
  const db = openDb(':memory:');
  let now = 1_000;
  let fail = false;
  const fetchJsonSafe = async (url) => {
    if (String(url) === 'http://localhost:8792/roster') {
      if (fail) return null;
      return { servers: makeTestServers(), generatedAt: 'T' };
    }
    return null;
  };
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    officialRosterCache: createTtlCache({ ttlMs: OFFICIAL_ROSTER_CACHE_TTL_MS, now: () => now }),
    browserDeps: { fetchJsonSafe },
    homeDeps: fakeHomeDeps({ totalOfficial: 2, pveCount: 1, pvpCount: 1, generatedAt: 'T' }),
  });

  try {
    const first = await fetch(`${base}/servers`);
    assert.equal(first.status, 200);
    assert.match(await first.text(), /TheIsland_WP/);

    fail = true;
    now = 1_000 + OFFICIAL_ROSTER_CACHE_TTL_MS;
    const second = await fetch(`${base}/servers`);
    const html = await second.text();
    assert.equal(second.status, 200);
    assert.match(html, /TheIsland_WP/);
    assert.match(html, /Data as of 5 minutes ago/);
    assert.doesNotMatch(html, /isn't available right now/);
  } finally {
    server.close();
  }
});

test('GET /servers with no cached roster still shows unavailable on a failed fetch', async () => {
  const db = openDb(':memory:');
  const fetchJsonSafe = async () => null;
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    officialRosterCache: createTtlCache({ ttlMs: OFFICIAL_ROSTER_CACHE_TTL_MS, now: () => 1_000 }),
    browserDeps: { fetchJsonSafe },
    homeDeps: { fetchRosterMetaSafe: async () => null },
  });

  const res = await fetch(`${base}/servers`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /isn't available right now/);
  assert.doesNotMatch(html, /Data as of/);
  assert.doesNotMatch(html, /TheIsland_WP/);

  server.close();
});

test('official roster cache does not cache a null miss', async () => {
  const db = openDb(':memory:');
  let officialFetches = 0;
  const fetchJsonSafe = async (url) => {
    if (String(url) === 'http://localhost:8792/roster') {
      officialFetches += 1;
      return null;
    }
    return null;
  };
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    officialRosterCache: createTtlCache({ ttlMs: OFFICIAL_ROSTER_CACHE_TTL_MS, now: () => 1_000 }),
    browserDeps: { fetchJsonSafe },
    statsDeps: { fetchJsonSafe },
  });

  await fetch(`${base}/stats`);
  await fetch(`${base}/rankings`);
  assert.equal(officialFetches, 2);

  server.close();
});

test('GET /robots.txt is allow-all with Crawl-delay 10', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
  });

  const res = await fetch(`${base}/robots.txt`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/plain;\s*charset=utf-8$/i);
  assert.equal(await res.text(), 'User-agent: *\nCrawl-delay: 10\n');

  server.close();
});

function mapsRoster() {
  return {
    generatedAt: '2026-08-16T00:00:00.000Z',
    servers: [
      {
        id: 'island-pve',
        name: 'EU-PVE-TheIsland5313',
        map: 'TheIsland_WP',
        gameMode: 'pve',
        playersNow: 10,
        maxPlayers: 70,
        version: '92.41',
        uptimePercent: 99,
        rankScore: 90,
        rank: 1,
        platformType: 'PC+XSX+WINGDK+PS5',
      },
      {
        id: 'genesis-pvp',
        name: 'EU-PVP-Genesis99',
        map: 'Genesis_WP',
        gameMode: 'pvp',
        playersNow: 40,
        maxPlayers: 70,
        version: '93.0',
        uptimePercent: 100,
        rankScore: 95,
        rank: 2,
        platformType: 'PC+PS5+XSX',
      },
    ],
  };
}

test('GET /maps renders the index sorted by server count', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(mapsRoster()),
  });

  const res = await fetch(`${base}/maps`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /<title>ARK Maps/);
  assert.match(html, /href="\/maps\/the-island"/);
  assert.match(html, /href="\/maps\/genesis"/);

  server.close();
});

test('GET /maps/the-island does not include a Genesis server', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(mapsRoster()),
  });

  const res = await fetch(`${base}/maps/the-island`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /<title>ARK The Island Servers/);
  assert.match(html, /EU-PVE-TheIsland5313/);
  assert.doesNotMatch(html, /EU-PVP-Genesis99/);
  assert.match(html, /href="\/servers\?map=TheIsland_WP"/);

  server.close();
});

test('GET /maps/genesis routes the Genesis slug to Genesis servers only', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(mapsRoster()),
  });

  const res = await fetch(`${base}/maps/genesis`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /EU-PVP-Genesis99/);
  assert.doesNotMatch(html, /EU-PVE-TheIsland5313/);

  server.close();
});

test('GET /maps/brand-new-map serves an unrecognized roster map without 500', async () => {
  const db = openDb(':memory:');
  const roster = {
    servers: [
      { id: 'n1', name: 'NA-PVE-New1', map: 'BrandNewMap_WP', gameMode: 'pve', playersNow: 3, maxPlayers: 70, rankScore: 11 },
    ],
  };
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(roster),
  });

  const res = await fetch(`${base}/maps/brand-new-map`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /<h1>BrandNewMap_WP<\/h1>/);
  assert.match(html, /NA-PVE-New1/);

  server.close();
});

test('GET /maps/not-a-real-map returns 404', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(mapsRoster()),
  });

  const res = await fetch(`${base}/maps/not-a-real-map`);
  const html = await res.text();
  assert.equal(res.status, 404);
  assert.match(html, /Map not found/);

  server.close();
});

test('GET /maps degrades when the roster is unreachable', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(null),
  });

  const res = await fetch(`${base}/maps`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /isn't available right now/);

  server.close();
});

function clustersRoster() {
  return {
    generatedAt: '2026-08-16T00:00:00.000Z',
    servers: [
      {
        id: 'island-pve',
        name: 'EU-PVE-TheIsland5313',
        map: 'TheIsland_WP',
        gameMode: 'pve',
        playersNow: 10,
        maxPlayers: 70,
        clusterId: 'PVECrossplay',
        uptimePercent: 99,
        rankScore: 90,
        rank: 1,
        wildcardReportedPing: 20,
      },
      {
        id: 'ab-pvp',
        name: 'NA-PVP-Aberration1',
        map: 'Aberration_WP',
        gameMode: 'pvp',
        playersNow: 20,
        maxPlayers: 70,
        clusterId: 'PVPCrossplay',
        uptimePercent: 80,
        rankScore: 70,
        rank: 3,
        wildcardReportedPing: 40,
      },
      {
        id: 'space-pve',
        name: 'EU-PVE-SpaceCluster',
        map: 'TheIsland_WP',
        gameMode: 'pve',
        playersNow: 4,
        maxPlayers: 70,
        clusterId: 'C 1',
        uptimePercent: 50,
        rankScore: 20,
        rank: 8,
      },
      {
        id: 'orphan',
        name: 'Orphan',
        map: 'TheIsland_WP',
        gameMode: 'pve',
        playersNow: 1,
        maxPlayers: 70,
      },
    ],
  };
}

test('GET /clusters renders 200 and lists every distinct cluster', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(clustersRoster()),
  });

  const res = await fetch(`${base}/clusters`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /<title>ARK Clusters/);
  assert.match(html, /href="\/clusters\/PVECrossplay"/);
  assert.match(html, /href="\/clusters\/PVPCrossplay"/);
  assert.match(html, /href="\/clusters\/C%201"/);
  assert.doesNotMatch(html, /Orphan/);
  assert.match(html, /<summary class="active">Stats<\/summary>/);

  server.close();
});

test('GET /clusters/:id renders 200 and contains member server names', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(clustersRoster()),
  });

  const res = await fetch(`${base}/clusters/PVECrossplay`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /EU-PVE-TheIsland5313/);
  assert.doesNotMatch(html, /NA-PVP-Aberration1/);
  assert.doesNotMatch(html, /EU-PVE-SpaceCluster/);

  server.close();
});

test('GET /clusters/not-a-real-cluster returns the 404 HTML page', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(clustersRoster()),
  });

  const res = await fetch(`${base}/clusters/not-a-real-cluster`);
  const html = await res.text();
  assert.equal(res.status, 404);
  assert.match(html, /Cluster not found/);
  assert.match(html, /href="\/clusters\/PVECrossplay"/);

  server.close();
});

test('GET /clusters/:id resolves an encoded URL-unsafe cluster ID', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(clustersRoster()),
  });

  const res = await fetch(`${base}/clusters/${encodeURIComponent('C 1')}`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /EU-PVE-SpaceCluster/);

  server.close();
});

test('GET /clusters/bad% 404s on malformed percent-encoding without throwing', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(clustersRoster()),
  });

  const res = await fetch(`${base}/clusters/bad%`);
  const html = await res.text();
  assert.equal(res.status, 404);
  assert.match(html, /Cluster not found/);

  server.close();
});

test('GET /clusters degrades when the roster is unreachable', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(null),
  });

  const res = await fetch(`${base}/clusters`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /isn't available right now/);

  server.close();
});

test('GET /clusters/:id degrades when the roster is unreachable', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(null),
  });

  const res = await fetch(`${base}/clusters/PVECrossplay`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /isn't available right now/);

  server.close();
});

test('GET /guides renders the index as HTML', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(null),
  });

  const res = await fetch(`${base}/guides`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(html, /<title>Guides \u2014 ArkHelper<\/title>/);
  assert.match(html, /href="\/guides\/beginners"/);
  assert.match(html, /href="\/guides\/taming"/);
  assert.match(html, /href="\/guides\/resource-locations"/);
  assert.match(html, /href="\/guides\/settings-performance"/);
  assert.match(html, /href="\/guides\/breeding-mutations"/);
  assert.match(html, /href="\/guides\/boss-strategies"/);
  assert.match(html, /href="\/guides\/scorched-earth-progression"/);
  assert.match(html, /Scorched Earth Progression/);
  assert.match(html, /href="\/guides\/aberration-progression"/);
  assert.match(html, /href="\/guides\/extinction-progression"/);
  assert.match(html, /href="\/guides\/genesis-progression"/);
  assert.match(html, /href="\/guides\/the-island-resources"/);
  assert.match(html, /The Island Resources/);
  assert.match(html, /href="\/guides\/scorched-earth-resources"/);
  assert.match(html, /Scorched Earth Resources/);
  assert.match(html, /href="\/guides\/aberration-resources"/);
  assert.match(html, /Aberration Resources/);
  assert.match(html, /href="\/guides\/the-center-resources"/);
  assert.match(html, /The Center Resources/);
  assert.match(html, /href="\/guides\/ragnarok-resources"/);
  assert.match(html, /Ragnarok Resources/);
  assert.match(html, /href="\/guides\/extinction-resources"/);
  assert.match(html, /Extinction Resources/);
  assert.match(html, /href="\/guides\/genesis-resources"/);
  assert.match(html, /Genesis Resources/);
  assert.match(html, /href="\/guides\/lost-colony-resources"/);
  assert.match(html, /Lost Colony Resources/);
  assert.equal((html.match(/class="guide-card"/g) || []).length, 18);
  assert.match(html, /href="\/guides">Guides/);

  server.close();
});

test('GET /guides/beginners renders the guide h1', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(null),
  });

  const res = await fetch(`${base}/guides/beginners`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(html, /<h1>Beginner&#39;s Guide \u2014 ARK: Survival Ascended<\/h1>/);
  assert.match(html, /href="\/guides">Guides/);
  assert.match(html, /Related guides/);
  assert.match(html, /href="\/guides\/taming"/);
  assert.match(html, /href="\/guides\/resource-locations"/);
  assert.match(html, /href="\/guides\/settings-performance"/);
  assert.doesNotMatch(html, /\(coming soon\)/);

  server.close();
});

test('GET /guides/taming renders the guide h1', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(null),
  });

  const res = await fetch(`${base}/guides/taming`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(html, /<h1>Taming Guide \u2014 ARK: Survival Ascended<\/h1>/);
  assert.match(html, /href="\/guides">Guides/);
  assert.match(html, /Check the rates, then pack for the whole job/);
  assert.match(html, /href="\/rates"/);
  assert.match(html, /The most common taming failure is not the animal waking up/);
  assert.match(html, /where your new hauler earns its keep/);
  assert.match(html, /href="\/guides\/breeding-mutations"/);
  assert.doesNotMatch(html, /\(coming soon\)/);

  server.close();
});

test('GET /guides/resource-locations renders the guide h1', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(null),
  });

  const res = await fetch(`${base}/guides/resource-locations`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(html, /<h1>Resource Locations \u2014 ARK: Survival Ascended<\/h1>/);
  assert.match(html, /href="\/guides">Guides/);
  assert.match(html, /Resources follow terrain, not maps/);
  assert.match(html, /Resource to terrain, tool, and hauling companion/);
  assert.match(html, /The question is never &#39;where is the metal on this map&#39;/);
  assert.doesNotMatch(html, /\(coming soon\)/);

  server.close();
});

test('GET /guides/settings-performance renders the guide h1', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(null),
  });

  const res = await fetch(`${base}/guides/settings-performance`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(html, /<h1>Settings &amp; Performance \u2014 ARK: Survival Ascended<\/h1>/);
  assert.match(html, /href="\/guides">Guides/);
  assert.match(html, /First, establish whose problem it is/);
  assert.match(html, /Symptoms to first suspects/);
  assert.match(html, /Choppy alone in a quiet base: your hardware/);
  assert.doesNotMatch(html, /\(coming soon\)/);

  server.close();
});

test('GET /guides/breeding-mutations renders the guide h1', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(null),
  });

  const res = await fetch(`${base}/guides/breeding-mutations`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(html, /<h1>Breeding &amp; Mutations \u2014 ARK: Survival Ascended<\/h1>/);
  assert.match(html, /href="\/guides">Guides/);
  assert.match(html, /Why breed at all/);
  assert.match(html, /The loop: pair, wait, raise, repeat/);
  assert.match(html, /Imprinting: raising it yourself pays/);
  assert.match(html, /Inheritance: each stat flips its own coin/);
  assert.match(html, /Mutations: rare, random, and stacked with care/);
  assert.match(html, /Logistics: the part that actually defeats people/);
  assert.match(html, /When is a line &#39;done&#39;\?/);
  assert.match(html, /Where to go next/);
  assert.match(html, /The first hour after hatching is the commitment/);
  assert.match(html, /class="callout"/);
  assert.match(html, /href="\/guides\/taming"/);
  assert.match(html, /href="\/guides\/boss-strategies"/);
  assert.match(html, /href="\/rates"/);
  assert.doesNotMatch(html, /\(coming soon\)/);

  server.close();
});

test('GET /guides/boss-strategies renders the guide h1', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(null),
  });

  const res = await fetch(`${base}/guides/boss-strategies`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(html, /<h1>Boss Strategies \u2014 ARK: Survival Ascended<\/h1>/);
  assert.match(html, /href="\/guides">Guides/);
  assert.match(html, /The boss fight starts weeks earlier/);
  assert.match(html, /How a fight actually happens/);
  assert.match(html, /Choose your tier honestly/);
  assert.match(html, /The army: bred, imprinted, and saddled/);
  assert.match(html, /Roles in the arena/);
  assert.match(html, /Gear for the minutes that matter/);
  assert.match(html, /After the victory/);
  assert.match(html, /Where to go next/);
  assert.match(html, /You do not lose a boss fight in the arena/);
  assert.match(html, /class="callout"/);
  assert.match(html, /href="\/guides\/breeding-mutations"/);
  assert.match(html, /href="\/maps"/);
  assert.match(html, /href="\/rates"/);
  assert.doesNotMatch(html, /\(coming soon\)/);

  server.close();
});

test('GET /guides/scorched-earth-progression renders the guide h1', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(null),
  });

  const res = await fetch(`${base}/guides/scorched-earth-progression`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(html, /<h1>Scorched Earth Progression Guide \u2014 ARK: Survival Ascended<\/h1>/);
  assert.match(html, /href="\/guides">Guides/);
  assert.match(html, /Wyverns and the scar in the world/);
  assert.match(html, /href="\/guides\/boss-strategies"/);
  assert.match(html, /href="\/guides\/aberration-progression"/);
  assert.doesNotMatch(html, /\(coming soon\)/);

  server.close();
});

test('GET /guides/aberration-progression renders the guide h1', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(null),
  });

  const res = await fetch(`${base}/guides/aberration-progression`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(html, /<h1>Aberration Progression Guide \u2014 ARK: Survival Ascended<\/h1>/);
  assert.match(html, /href="\/guides">Guides/);
  assert.match(html, /Charge light and the things that hate it/);
  assert.match(html, /href="\/guides\/scorched-earth-progression"/);
  assert.doesNotMatch(html, /\(coming soon\)/);

  const scorchedRes = await fetch(`${base}/guides/scorched-earth-progression`);
  const scorchedHtml = await scorchedRes.text();
  assert.match(scorchedHtml, /href="\/guides\/aberration-progression"/);

  server.close();
});

test('GET /guides/extinction-progression renders the guide h1', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(null),
  });

  const res = await fetch(`${base}/guides/extinction-progression`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(html, /<h1>Extinction Progression Guide \u2014 ARK: Survival Ascended<\/h1>/);
  assert.match(html, /href="\/guides">Guides/);
  assert.match(html, /Element nodes and orbital drops/);
  assert.match(html, /href="\/guides\/aberration-progression"/);
  assert.doesNotMatch(html, /\(coming soon\)/);

  const aberrationRes = await fetch(`${base}/guides/aberration-progression`);
  const aberrationHtml = await aberrationRes.text();
  assert.match(aberrationHtml, /href="\/guides\/extinction-progression"/);

  server.close();
});

test('GET /guides/genesis-progression renders the guide h1', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(null),
  });

  const res = await fetch(`${base}/guides/genesis-progression`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(html, /<h1>Genesis Progression Guide \u2014 ARK: Survival Ascended<\/h1>/);
  assert.match(html, /href="\/guides">Guides/);
  assert.match(html, /Missions, Hexagons, and the simulation&#39;s economy/);
  assert.match(html, /href="\/guides\/extinction-progression"/);
  assert.doesNotMatch(html, /\(coming soon\)/);

  const extinctionRes = await fetch(`${base}/guides/extinction-progression`);
  const extinctionHtml = await extinctionRes.text();
  assert.match(extinctionHtml, /href="\/guides\/genesis-progression"/);

  server.close();
});

test('GET /guides/the-island-resources renders the guide h1', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(null),
  });

  const res = await fetch(`${base}/guides/the-island-resources`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(html, /<h1>The Island Resources Guide \u2014 ARK: Survival Ascended<\/h1>/);
  assert.match(html, /href="\/guides">Guides/);
  assert.match(html, /href="\/guides\/resource-locations"/);
  assert.match(html, /href="\/maps\/the-island"/);

  server.close();
});

test('GET /guides/scorched-earth-resources renders the guide h1', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(null),
  });

  const res = await fetch(`${base}/guides/scorched-earth-resources`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(html, /<h1>Scorched Earth Resources Guide \u2014 ARK: Survival Ascended<\/h1>/);
  assert.match(html, /href="\/guides">Guides/);
  assert.match(html, /href="\/guides\/resource-locations"/);
  assert.match(html, /href="\/maps\/scorched-earth"/);

  server.close();
});

test('GET /guides/aberration-resources renders the guide h1', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(null),
  });

  const res = await fetch(`${base}/guides/aberration-resources`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(html, /<h1>Aberration Resources Guide \u2014 ARK: Survival Ascended<\/h1>/);
  assert.match(html, /href="\/guides">Guides/);
  assert.match(html, /href="\/guides\/resource-locations"/);
  assert.match(html, /href="\/maps\/aberration"/);

  server.close();
});

test('GET /guides/nope returns 404 HTML', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(null),
  });

  const res = await fetch(`${base}/guides/nope`);
  const html = await res.text();
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(html, /Guide not found/);
  assert.match(html, /nope/);
  assert.match(html, /href="\/guides"/);

  server.close();
});

test('GET /colors returns the palette page with dyes and no dye IDs', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(null),
  });

  const res = await fetch(`${base}/colors`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(html, /Burn/);
  assert.doesNotMatch(html, /Color ID:\s*1\d{2}/);
  assert.match(html, /href="\/colors"/);

  server.close();
});

test('GET /colors/sets/dinocolorset-spino returns the set page', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(null),
  });

  const res = await fetch(`${base}/colors/sets/dinocolorset-spino`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(html, /Region/);

  server.close();
});

test('GET /tools/crafting-cost renders the calculator shell', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(null),
  });

  const res = await fetch(`${base}/tools/crafting-cost`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(html, /<h1>Crafting Cost Calculator<\/h1>/);
  assert.match(html, /href="\/tools\/crafting-cost"/);
  const craftingUrl = resolveDataUrl('crafting-costs');
  assert.match(html, new RegExp(craftingUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  server.close();
});

test('GET hashed crafting-costs JSON serves the preloaded asset with an immutable cache header', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
  });

  const craftingUrl = resolveDataUrl('crafting-costs');
  const res = await fetch(`${base}${craftingUrl}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/json/);
  assert.equal(res.headers.get('cache-control'), HASHED_CACHE_CONTROL);
  const body = await res.json();
  assert.ok(Array.isArray(body.items));
  assert.ok(body.items.length > 0);
  assert.ok(Array.isArray(body.stations));
  assert.equal(body.stations.length, 6);

  server.close();
});

test('GET /tools/demolish-refund renders the calculator shell', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(null),
  });

  const res = await fetch(`${base}/tools/demolish-refund`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(html, /<h1>Demolish Refund Calculator<\/h1>/);
  assert.match(html, /These numbers are for official servers/);
  assert.match(html, /href="\/tools\/demolish-refund"/);
  const demolishUrl = resolveDataUrl('demolish-refunds');
  assert.match(html, new RegExp(demolishUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  server.close();
});

test('GET hashed demolish-refunds JSON serves the preloaded asset with an immutable cache header', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
  });

  const demolishUrl = resolveDataUrl('demolish-refunds');
  const res = await fetch(`${base}${demolishUrl}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/json/);
  assert.equal(res.headers.get('cache-control'), HASHED_CACHE_CONTROL);
  const body = await res.json();
  assert.ok(Array.isArray(body.structures));
  assert.ok(body.structures.length > 0);
  assert.ok(body.nodemo.includes('PrimalItemResource_Element'));

  server.close();
});

test('HEAD hashed data URL returns 200 with the same headers as GET and an empty body', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
  });

  const craftingUrl = `${base}${resolveDataUrl('crafting-costs')}`;
  const getRes = await fetch(craftingUrl);
  const headRes = await fetch(craftingUrl, { method: 'HEAD' });
  assert.equal(getRes.status, 200);
  assert.equal(headRes.status, 200);
  assert.equal(headRes.headers.get('content-type'), getRes.headers.get('content-type'));
  assert.equal(headRes.headers.get('cache-control'), getRes.headers.get('cache-control'));
  assert.equal(headRes.headers.get('cache-control'), HASHED_CACHE_CONTROL);
  assert.equal(headRes.headers.get('content-length'), getRes.headers.get('content-length'));
  assert.equal(await headRes.text(), '');
  const getBody = await getRes.json();
  assert.ok(Array.isArray(getBody.items));

  server.close();
});

test('HEAD on a nonexistent hashed data URL returns 404 matching GET', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
  });

  const missing = `${base}/data/crafting-costs.000000000000.json`;
  const getRes = await fetch(missing);
  const headRes = await fetch(missing, { method: 'HEAD' });
  assert.equal(getRes.status, 404);
  assert.equal(headRes.status, 404);

  server.close();
});

test('GET /compare with two known ids renders both names and attribute rows', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps({ servers: makeTestServers() }),
  });

  const res = await fetch(`${base}/compare?s=1&s=2`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(html, /EU-PVE-TheIsland5313/);
  assert.match(html, /Asia-PVP-LostColony2859/);
  assert.match(html, /<th scope="row">Status<\/th>/);
  assert.match(html, /<th scope="row">Ping<\/th>/);
  assert.match(html, /<th scope="row">Rank<\/th>/);
  assert.match(html, /href="\/compare"/);

  server.close();
});

test('GET /compare with an unknown id still renders the not-listed column', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps({ servers: makeTestServers() }),
  });

  const res = await fetch(`${base}/compare?s=missing-id`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /missing-id/);
  assert.match(html, /Not currently listed/);
  assert.match(html, /href="\/servers\/missing-id"/);

  server.close();
});

test('GET /servers official source includes compare checkboxes and submit', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps({ servers: makeTestServers() }),
  });

  const res = await fetch(`${base}/servers`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /name="s"/);
  assert.match(html, /action="\/compare"/);
  assert.match(html, /Compare selected/);

  server.close();
});

test('GET /servers?source=unofficial has no compare checkboxes or form', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeSplitBrowserDeps({ official: { servers: makeTestServers() }, unofficial: unofficialTestRoster() }),
    homeDeps: fakeSplitHomeDeps({
      official: { totalOfficial: 2, pveCount: 1, pvpCount: 1, generatedAt: 'T' },
      unofficial: { count: 1, cycles_total: 4, lastFetchStatus: 'ok' },
    }),
  });

  const res = await fetch(`${base}/servers?source=unofficial`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.doesNotMatch(html, /name="s"/);
  assert.doesNotMatch(html, /action="\/compare"/);
  assert.doesNotMatch(html, /Compare selected/);

  server.close();
});

test('GET /servers/:id renders a Compare this server link', async () => {
  const db = openDb(':memory:');
  const roster = { servers: [{ id: 'abc', name: 'A Server', map: 'M', gameMode: 'pve', modIds: [] }] };
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    detailDeps: fakeDetailDeps({ roster, historyData: null }),
  });

  const res = await fetch(`${base}/servers/abc`);
  const html = await res.text();
  assert.match(html, /href="\/compare\?s=abc">Compare this server</);

  server.close();
});

// ---------------------------------------------------------------------
// Brand assets
// ---------------------------------------------------------------------
test('GET /favicon.ico serves the icon with cache headers', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
  });

  const res = await fetch(`${base}/favicon.ico`);
  const body = Buffer.from(await res.arrayBuffer());
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /image\/x-icon/);
  assert.ok(body.length > 0);
  assert.match(res.headers.get('cache-control'), /public,\s*max-age=86400/);
  assert.equal(res.headers.get('content-length'), String(body.length));

  server.close();
});

test('GET /assets/og-image.png serves the social card', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
  });

  const res = await fetch(`${base}/assets/og-image.png`);
  const body = Buffer.from(await res.arrayBuffer());
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /image\/png/);
  assert.ok(body.length > 0);
  assert.match(res.headers.get('cache-control'), /public,\s*max-age=86400/);

  server.close();
});

test('GET /assets/does-not-exist.png returns 404', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
  });

  const res = await fetch(`${base}/assets/does-not-exist.png`);
  assert.equal(res.status, 404);

  server.close();
});

test('HTML pages include favicon, apple-touch-icon, og:image, and twitter card', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(null),
  });

  const res = await fetch(`${base}/guides`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /rel="icon"/);
  assert.match(html, /rel="apple-touch-icon"/);
  const ogImage = html.match(/property="og:image" content="([^"]+)"/);
  assert.ok(ogImage, 'expected an og:image meta tag');
  assert.ok(ogImage[1].startsWith(siteOrigin()), `og:image ${ogImage[1]} should start with ${siteOrigin()}`);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);

  server.close();
});

test('HTML pages include the full logo in the header', async () => {
  const db = openDb(':memory:');
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    browserDeps: fakeBrowserDeps(null),
  });

  const res = await fetch(`${base}/guides`);
  const html = await res.text();
  const headerStart = html.indexOf('<header');
  const headerEnd = html.indexOf('</header>');
  assert.ok(headerStart !== -1 && headerEnd !== -1);
  const header = html.slice(headerStart, headerEnd);
  assert.match(header, /\/assets\/icon-192\.png/);

  server.close();
});
