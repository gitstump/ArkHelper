#!/usr/bin/env node
'use strict';

/**
 * discord_oauth.js
 *
 * Discord OAuth2 authorization-code flow. Endpoints verified against
 * Discord's current developer documentation before writing this (not
 * guessed) — given how the discovery phase went with Steam and
 * BattleMetrics, this one got checked first:
 *   - Authorize: https://discord.com/oauth2/authorize
 *   - Token exchange: POST https://discord.com/api/v10/oauth2/token
 *     (application/x-www-form-urlencoded, JSON body is rejected)
 *   - User info: GET https://discord.com/api/v10/users/@me
 *     with `Authorization: Bearer <access_token>`
 *
 * State/CSRF handling: this module only generates a state value and
 * expects the caller to verify it matches what was issued (e.g. via a
 * short-lived cookie) — that verification is auth_service.js's job,
 * kept out of this module so this stays pure request-building/parsing.
 */

const https = require('https');
const crypto = require('node:crypto');

const DISCORD_AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
const DISCORD_TOKEN_URL = 'https://discord.com/api/v10/oauth2/token';
const DISCORD_USER_URL = 'https://discord.com/api/v10/users/@me';

// ---------------------------------------------------------------------
// HTTP (real implementations; tests inject fakes)
// ---------------------------------------------------------------------
function realHttpPostForm(url, { body } = {}) {
  return new Promise((resolve, reject) => {
    const formBody = new URLSearchParams(body).toString();
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(formBody),
        },
      },
      (res) => {
        let respBody = '';
        res.on('data', (chunk) => (respBody += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: respBody }));
      }
    );
    req.on('error', reject);
    req.write(formBody);
    req.end();
  });
}

function realHttpGet(url, { headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------
// State (CSRF protection)
// ---------------------------------------------------------------------
function generateState({ randomBytes = () => crypto.randomBytes(24).toString('hex') } = {}) {
  return randomBytes();
}

// ---------------------------------------------------------------------
// Authorize URL
// ---------------------------------------------------------------------
function buildAuthorizeUrl({ clientId, redirectUri, state, scope = 'identify' }) {
  if (!clientId) throw new Error('buildAuthorizeUrl: clientId is required');
  if (!redirectUri) throw new Error('buildAuthorizeUrl: redirectUri is required');
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
  });
  if (state) params.set('state', state);
  return `${DISCORD_AUTHORIZE_URL}?${params.toString()}`;
}

// ---------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------
async function exchangeCodeForToken({ httpPostForm = realHttpPostForm, code, clientId, clientSecret, redirectUri }) {
  if (!code) throw new Error('exchangeCodeForToken: code is required');
  if (!clientId || !clientSecret) throw new Error('exchangeCodeForToken: clientId and clientSecret are required');
  if (!redirectUri) throw new Error('exchangeCodeForToken: redirectUri is required (must match the authorize request)');

  const res = await httpPostForm(DISCORD_TOKEN_URL, {
    body: {
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    },
  });

  if (res.status !== 200) {
    throw new Error(`Discord token exchange failed: HTTP ${res.status} — ${res.body.slice(0, 300)}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(res.body);
  } catch (err) {
    throw new Error(`Discord token exchange returned non-JSON: ${err.message}`);
  }

  return {
    accessToken: parsed.access_token,
    tokenType: parsed.token_type,
    expiresIn: parsed.expires_in,
    refreshToken: parsed.refresh_token,
    scope: parsed.scope,
  };
}

// ---------------------------------------------------------------------
// User fetch
// ---------------------------------------------------------------------
async function fetchDiscordUser({ httpGet = realHttpGet, accessToken }) {
  if (!accessToken) throw new Error('fetchDiscordUser: accessToken is required');

  const res = await httpGet(DISCORD_USER_URL, { headers: { Authorization: `Bearer ${accessToken}` } });

  if (res.status !== 200) {
    throw new Error(`Discord user fetch failed: HTTP ${res.status} — ${res.body.slice(0, 300)}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(res.body);
  } catch (err) {
    throw new Error(`Discord user fetch returned non-JSON: ${err.message}`);
  }

  return {
    id: parsed.id,
    username: parsed.username,
    avatar: parsed.avatar,
    raw: parsed,
  };
}

module.exports = {
  DISCORD_AUTHORIZE_URL,
  DISCORD_TOKEN_URL,
  DISCORD_USER_URL,
  generateState,
  buildAuthorizeUrl,
  exchangeCodeForToken,
  fetchDiscordUser,
  realHttpPostForm,
  realHttpGet,
};
