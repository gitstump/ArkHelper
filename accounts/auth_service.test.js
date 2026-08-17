'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb, getAlertSettings } = require('./db.js');
const { parseCookies, buildSetCookie, createAuthServer, SESSION_COOKIE, STATE_COOKIE, PRESET_COOKIE } = require('./auth_service.js');

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
  assert.ok(body.routes.includes('/servers/:id'));
  assert.ok(body.routes.includes('/servers/:id/badge.svg'));
  assert.ok(body.routes.includes('/lists/:slug'));
  assert.ok(body.routes.includes('/rankings'));
  assert.ok(body.routes.includes('/favorites'));
  assert.ok(body.routes.includes('/alerts/:id'));

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

function fakeDetailDeps({ roster = null, historyData = null } = {}) {
  return {
    fetchJsonSafe: async (url) => (url.includes('/history/') ? historyData : roster),
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
  assert.match(html, /Logged in as <strong>brian<\/strong>/);

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
  assert.match(html, /3179/);

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

test('GET /servers/:id passes changeLog and heatmap data through when the history feed provides it', async () => {
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
  assert.match(html, /Wipe detected/);
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
  assert.equal(cells[7], '97.5%');
  assert.doesNotMatch(cells[7], /\u2014/);

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

function fakeListDeps({ roster = listRoster(), wipes = { wipes: [] } } = {}) {
  return {
    fetchJsonSafe: async (url) => {
      if (String(url).includes('/history/wipes')) return wipes;
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
  assert.doesNotMatch(html, /href="\/servers\/u1"/);
  assert.match(html, />Seen</);
  assert.match(html, /75%/);

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
  assert.match(html, /3179/);
  assert.match(html, /56198/);
  assert.match(html, /official and .* unofficial servers/);

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
  assert.match(heroSection(officialHtml), /Unofficial Servers Tracked/);

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
  assert.doesNotMatch(hero, /Unofficial Servers Tracked/);
  assert.doesNotMatch(hero, /official \u00b7 .* unofficial/);
  assert.doesNotMatch(hero, />0</);

  server.close();
});

test('unofficial roster cache avoids a second fetch within the TTL', async () => {
  const db = openDb(':memory:');
  let unofficialCalls = 0;
  const { createTtlCache } = require('./local_fetch.js');
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
