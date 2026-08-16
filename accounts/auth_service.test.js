'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb, getAlertSettings } = require('./db.js');
const { parseCookies, buildSetCookie, createAuthServer, SESSION_COOKIE, STATE_COOKIE } = require('./auth_service.js');

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
  assert.ok(body.routes.includes('/stats'));
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

test('GET /stats includes the uptime leaderboard when the history endpoint returns data', async () => {
  const db = openDb(':memory:');
  const roster = { servers: [{ id: '1', name: 'A', map: 'M', gameMode: 'pve', playersNow: 5, maxPlayers: 70 }] };
  const uptimeLeaderboard = { totalRuns: 10, servers: [{ serverId: '1', presentCount: 10, uptimePercent: 100 }] };
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    statsDeps: fakeStatsDeps({ roster, uptimeLeaderboard }),
  });

  const res = await fetch(`${base}/stats`);
  const html = await res.text();
  assert.match(html, /100%/);
  assert.match(html, />A</); // the roster's real server name, not the raw serverId "1"
  assert.match(html, /href="\/servers\/1"/);

  server.close();
});

test('GET /stats falls back gracefully when a leaderboard entry references a server no longer in the roster', async () => {
  const db = openDb(':memory:');
  const roster = { servers: [] }; // server "1" from the leaderboard isn't here anymore
  const uptimeLeaderboard = { totalRuns: 10, servers: [{ serverId: '1', presentCount: 10, uptimePercent: 100 }] };
  const { server, base } = await startServer({
    db,
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
    discordDeps: fakeDiscordDeps(),
    statsDeps: fakeStatsDeps({ roster, uptimeLeaderboard }),
  });

  const res = await fetch(`${base}/stats`);
  assert.equal(res.status, 200); // no crash even though the id doesn't resolve
  const html = await res.text();
  assert.match(html, /Server 1/); // shortened-id fallback still renders something sensible

  server.close();
});
