#!/usr/bin/env node
'use strict';

/**
 * alert_dispatch.js
 *
 * Discord webhook delivery for alert_events. The in-page feed is the
 * channel of record; this POSTs a batched message to one per-account
 * webhook. Failed sends are dropped, never queued. The only outbound
 * HTTP this module performs is a POST to a validated discord.com
 * webhook URL.
 */

const {
  getAccountWebhook,
  listPendingAlertEvents,
  markAlertEventsDispatched,
  resetWebhookFailures,
  incrementWebhookFailures,
  disableAccountWebhook,
  insertAlertDelivery,
  insertAlertEvent,
} = require('./db.js');

const DEFAULT_ORIGIN = 'https://arkhelper.info';
const BATCH_CHAR_LIMIT = 1900;
const POST_TIMEOUT_MS = 10_000;
const DISABLE_AFTER_FAILURES = 3;

const TEST_WEBHOOK_MESSAGE = 'ArkHelper test: your Discord webhook is working.';
const WEBHOOK_DISABLED_MESSAGE =
  'Your Discord webhook was disabled after repeated failures. Save it again on the Alerts page to re-enable.';

function normalizeOrigin(origin) {
  const raw = origin == null || origin === '' ? DEFAULT_ORIGIN : String(origin);
  return raw.replace(/\/+$/, '') || DEFAULT_ORIGIN;
}

function toIso(now) {
  if (typeof now === 'function') return toIso(now());
  if (typeof now === 'string') return now;
  if (typeof now === 'number' && Number.isFinite(now)) return new Date(now).toISOString();
  return new Date().toISOString();
}

// Binding invariant: https, host exactly discord.com, path beginning
// /api/webhooks/. Credentials, ports, and query strings are rejected.
function validateWebhookUrl(url) {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.includes('?') || trimmed.includes('#')) return null;

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.hostname !== 'discord.com') return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.port !== '') return null;

  const afterProto = trimmed.replace(/^https:\/\//i, '');
  const hostPart = afterProto.split('/')[0];
  if (hostPart.toLowerCase() !== 'discord.com') return null;

  let path = parsed.pathname || '';
  while (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  if (!path.startsWith('/api/webhooks/')) return null;
  const rest = path.slice('/api/webhooks/'.length);
  if (!rest) return null;

  return `https://discord.com${path}`;
}

function buildBatchMessage(events, origin) {
  const base = normalizeOrigin(origin);
  const header = 'ArkHelper alerts:';
  const footer = `${base}/alerts`;
  const list = Array.isArray(events) ? events : [];

  function assemble(shown, omitted) {
    const extra = omitted > 0 ? [`- ...and ${omitted} more (see ${base}/alerts)`] : [];
    const lines = shown.map((event) => `- ${event && event.message != null ? event.message : ''}`);
    return [header, ...lines, ...extra, footer].join('\n');
  }

  let keep = list.length;
  while (keep > 0 && assemble(list.slice(0, keep), list.length - keep).length > BATCH_CHAR_LIMIT) {
    keep -= 1;
  }
  return assemble(list.slice(0, keep), list.length - keep);
}

async function defaultPostFn(url, content) {
  const valid = validateWebhookUrl(url);
  if (!valid) {
    const err = new Error('rejected_url');
    err.code = 'rejected_url';
    throw err;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POST_TIMEOUT_MS);
  try {
    const res = await fetch(valid, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
      signal: controller.signal,
    });
    return { status: res.status, ok: res.status >= 200 && res.status < 300 };
  } finally {
    clearTimeout(timer);
  }
}

async function deliverContent(url, content, postFn = defaultPostFn) {
  const valid = validateWebhookUrl(url);
  if (!valid) {
    return { posted: false, ok: false, status: null, detail: 'rejected_url' };
  }
  try {
    const result = await postFn(valid, content);
    const status = result && result.status != null && Number.isFinite(Number(result.status)) ? Number(result.status) : null;
    const ok =
      result && typeof result.ok === 'boolean' ? result.ok : status != null && status >= 200 && status < 300;
    return { posted: true, ok: Boolean(ok), status, detail: null };
  } catch (err) {
    const detail = err && err.message ? String(err.message) : 'network_error';
    return { posted: true, ok: false, status: null, detail };
  }
}

function isPermanentFailure(outcome) {
  if (!outcome.posted) return true;
  return outcome.status === 401 || outcome.status === 403 || outcome.status === 404;
}

function insertDisabledSystemEvent(db, accountId, nowIso) {
  insertAlertEvent(db, {
    accountId,
    serverId: '',
    serverName: 'ArkHelper',
    kind: 'system',
    message: WEBHOOK_DISABLED_MESSAGE,
    createdAt: nowIso,
    dispatchedAt: nowIso,
  });
}

async function dispatchPending({ db, postFn = defaultPostFn, origin, now } = {}) {
  if (!db) return { accounts: 0 };
  const nowIso = toIso(now);
  const siteOrigin = normalizeOrigin(origin);
  const pending = listPendingAlertEvents(db);
  if (pending.length === 0) return { accounts: 0 };

  const byAccount = new Map();
  for (const event of pending) {
    const list = byAccount.get(event.accountId) || [];
    list.push(event);
    byAccount.set(event.accountId, list);
  }

  let accounts = 0;
  for (const [accountId, events] of byAccount) {
    accounts += 1;
    const ids = events.map((event) => event.id);
    const webhook = getAccountWebhook(db, accountId);
    if (!webhook || !webhook.enabled) {
      markAlertEventsDispatched(db, ids, { now: nowIso });
      continue;
    }

    const message = buildBatchMessage(events, siteOrigin);
    const outcome = await deliverContent(webhook.url, message, postFn);
    insertAlertDelivery(
      db,
      {
        accountId,
        eventCount: events.length,
        statusCode: outcome.status,
        ok: outcome.ok,
        detail: outcome.detail,
        createdAt: nowIso,
      },
      { now: nowIso }
    );
    markAlertEventsDispatched(db, ids, { now: nowIso });

    if (outcome.ok) {
      resetWebhookFailures(db, accountId, { now: nowIso });
    } else if (isPermanentFailure(outcome)) {
      const failures = incrementWebhookFailures(db, accountId, { now: nowIso });
      if (failures >= DISABLE_AFTER_FAILURES) {
        disableAccountWebhook(db, accountId, { now: nowIso });
        insertDisabledSystemEvent(db, accountId, nowIso);
      }
    }
  }

  return { accounts };
}

module.exports = {
  DEFAULT_ORIGIN,
  BATCH_CHAR_LIMIT,
  TEST_WEBHOOK_MESSAGE,
  WEBHOOK_DISABLED_MESSAGE,
  validateWebhookUrl,
  buildBatchMessage,
  deliverContent,
  defaultPostFn,
  dispatchPending,
};
