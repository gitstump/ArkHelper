'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DISCORD_AUTHORIZE_URL,
  DISCORD_TOKEN_URL,
  DISCORD_USER_URL,
  generateState,
  buildAuthorizeUrl,
  exchangeCodeForToken,
  fetchDiscordUser,
} = require('./discord_oauth.js');

// ---------------------------------------------------------------------
// State generation
// ---------------------------------------------------------------------
test('generateState produces a non-trivial random string', () => {
  const state = generateState();
  assert.ok(state.length >= 32);
});

test('generateState produces different values each call', () => {
  assert.notEqual(generateState(), generateState());
});

// ---------------------------------------------------------------------
// buildAuthorizeUrl
// ---------------------------------------------------------------------
test('buildAuthorizeUrl builds a correct URL with all params', () => {
  const url = buildAuthorizeUrl({
    clientId: 'CID',
    redirectUri: 'http://localhost:8793/auth/discord/callback',
    state: 'STATE123',
  });
  assert.match(url, new RegExp(`^${DISCORD_AUTHORIZE_URL}\\?`));
  assert.match(url, /response_type=code/);
  assert.match(url, /client_id=CID/);
  assert.match(url, /state=STATE123/);
  assert.match(url, /scope=identify/);
  assert.match(url, /redirect_uri=http%3A%2F%2Flocalhost%3A8793/);
});

test('buildAuthorizeUrl defaults scope to identify when not given', () => {
  const url = buildAuthorizeUrl({ clientId: 'CID', redirectUri: 'http://x/cb' });
  assert.match(url, /scope=identify/);
});

test('buildAuthorizeUrl supports a custom scope', () => {
  const url = buildAuthorizeUrl({ clientId: 'CID', redirectUri: 'http://x/cb', scope: 'identify guilds' });
  assert.match(url, /scope=identify\+guilds/);
});

test('buildAuthorizeUrl omits state when none is given', () => {
  const url = buildAuthorizeUrl({ clientId: 'CID', redirectUri: 'http://x/cb' });
  assert.doesNotMatch(url, /state=/);
});

test('buildAuthorizeUrl throws without a clientId', () => {
  assert.throws(() => buildAuthorizeUrl({ redirectUri: 'http://x/cb' }), /clientId is required/);
});

test('buildAuthorizeUrl throws without a redirectUri', () => {
  assert.throws(() => buildAuthorizeUrl({ clientId: 'CID' }), /redirectUri is required/);
});

// ---------------------------------------------------------------------
// exchangeCodeForToken
// ---------------------------------------------------------------------
test('exchangeCodeForToken posts form-encoded data to the correct URL and parses the response', async () => {
  let capturedUrl, capturedBody, capturedHeaders;
  const fakePost = async (url, opts) => {
    capturedUrl = url;
    capturedBody = opts.body;
    return {
      status: 200,
      body: JSON.stringify({
        access_token: 'AT123',
        token_type: 'Bearer',
        expires_in: 604800,
        refresh_token: 'RT123',
        scope: 'identify',
      }),
    };
  };

  const result = await exchangeCodeForToken({
    httpPostForm: fakePost,
    code: 'CODE123',
    clientId: 'CID',
    clientSecret: 'SECRET',
    redirectUri: 'http://x/cb',
  });

  assert.equal(capturedUrl, DISCORD_TOKEN_URL);
  assert.equal(capturedBody.grant_type, 'authorization_code');
  assert.equal(capturedBody.code, 'CODE123');
  assert.equal(capturedBody.client_secret, 'SECRET');
  assert.equal(result.accessToken, 'AT123');
  assert.equal(result.refreshToken, 'RT123');
  assert.equal(result.expiresIn, 604800);
});

test('exchangeCodeForToken throws a clear error on a non-200 response', async () => {
  const fakePost = async () => ({ status: 400, body: '{"error":"invalid_grant"}' });
  await assert.rejects(
    () => exchangeCodeForToken({ httpPostForm: fakePost, code: 'C', clientId: 'I', clientSecret: 'S', redirectUri: 'http://x/cb' }),
    /token exchange failed: HTTP 400/
  );
});

test('exchangeCodeForToken throws clearly on non-JSON response', async () => {
  const fakePost = async () => ({ status: 200, body: 'not json' });
  await assert.rejects(
    () => exchangeCodeForToken({ httpPostForm: fakePost, code: 'C', clientId: 'I', clientSecret: 'S', redirectUri: 'http://x/cb' }),
    /non-JSON/
  );
});

test('exchangeCodeForToken validates required params before making a request', async () => {
  const fakePost = async () => {
    throw new Error('should not be called');
  };
  await assert.rejects(() => exchangeCodeForToken({ httpPostForm: fakePost, clientId: 'I', clientSecret: 'S', redirectUri: 'http://x/cb' }), /code is required/);
  await assert.rejects(() => exchangeCodeForToken({ httpPostForm: fakePost, code: 'C', redirectUri: 'http://x/cb' }), /clientId and clientSecret/);
  await assert.rejects(() => exchangeCodeForToken({ httpPostForm: fakePost, code: 'C', clientId: 'I', clientSecret: 'S' }), /redirectUri is required/);
});

// ---------------------------------------------------------------------
// fetchDiscordUser
// ---------------------------------------------------------------------
test('fetchDiscordUser sends the bearer token and parses the user object', async () => {
  let capturedUrl, capturedHeaders;
  const fakeGet = async (url, opts) => {
    capturedUrl = url;
    capturedHeaders = opts.headers;
    return { status: 200, body: JSON.stringify({ id: '999', username: 'brian', avatar: 'hash123', discriminator: '0' }) };
  };

  const user = await fetchDiscordUser({ httpGet: fakeGet, accessToken: 'AT123' });
  assert.equal(capturedUrl, DISCORD_USER_URL);
  assert.equal(capturedHeaders.Authorization, 'Bearer AT123');
  assert.equal(user.id, '999');
  assert.equal(user.username, 'brian');
  assert.equal(user.avatar, 'hash123');
  assert.equal(user.raw.discriminator, '0'); // raw payload preserved for anything not explicitly mapped
});

test('fetchDiscordUser throws a clear error on a non-200 response', async () => {
  const fakeGet = async () => ({ status: 401, body: '{"message":"401: Unauthorized"}' });
  await assert.rejects(() => fetchDiscordUser({ httpGet: fakeGet, accessToken: 'BAD' }), /user fetch failed: HTTP 401/);
});

test('fetchDiscordUser throws without an accessToken', async () => {
  await assert.rejects(() => fetchDiscordUser({ httpGet: async () => ({}) }), /accessToken is required/);
});
