#!/usr/bin/env node
'use strict';

/**
 * alerts_page.js
 *
 * In-page alert feed plus the per-account Discord webhook form.
 * Visiting GET /alerts is the ack: displayed rows are marked read by
 * the route after this render. No per-row buttons, no live JS.
 */

const { escapeHtml } = require('./theme.js');
const { renderPage } = require('./layout.js');

const PAGE_CSS = `
.alert-feed { list-style: none; margin: 0; padding: 0; }
.alert-row {
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
.alert-row.unread {
  border-left: 3px solid var(--accent);
  padding-left: calc(var(--space-4) - 3px);
}
.alert-row p { margin: 0; }
.alert-row .alert-meta { margin-top: var(--space-1); color: var(--muted); font-size: 0.85rem; }
.alert-row .alert-meta a { color: var(--accent); }
.webhook-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: var(--space-4);
  margin: 0 0 var(--space-5);
}
.webhook-card h2 { margin-top: 0; }
.webhook-card input[type="url"] { width: min(100%, 36rem); }
.webhook-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-3); }
.webhook-status.enabled { color: var(--online); }
.webhook-status.disabled { color: var(--offline); }
.flash-error { color: var(--offline); }
.flash-ok { color: var(--online); }
.masked-url { font-family: var(--font-mono); }
`;

function formatRelativeTime(iso, nowMs = Date.now()) {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const delta = Math.max(0, nowMs - then);
  const sec = Math.round(delta / 1000);
  if (sec < 45) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return min === 1 ? '1 minute ago' : `${min} minutes ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return hr === 1 ? '1 hour ago' : `${hr} hours ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return day === 1 ? '1 day ago' : `${day} days ago`;
  return new Date(then).toISOString().slice(0, 10);
}

function maskWebhookUrl(url) {
  const s = String(url || '');
  if (s.length < 4) return '••••';
  return `••••${s.slice(-4)}`;
}

function renderAlertRow(event, nowMs) {
  const unread = event.readAt ? '' : ' unread';
  const relative = formatRelativeTime(event.createdAt, nowMs);
  const isSystem = event.kind === 'system';
  const nameLabel = escapeHtml(event.serverName || event.serverId || 'ArkHelper');
  const nameHtml = isSystem
    ? nameLabel
    : `<a href="/servers/${encodeURIComponent(event.serverId)}">${escapeHtml(event.serverName || event.serverId)}</a>`;
  return `<li class="alert-row${unread}">
    <p>${escapeHtml(event.message)}</p>
    <p class="alert-meta">${nameHtml}
    \u00b7 <time datetime="${escapeHtml(event.createdAt || '')}">${escapeHtml(relative)}</time></p>
  </li>`;
}

function renderWebhookSection({ webhook = null, webhookError = null, testResult = null } = {}) {
  const errorHtml = webhookError
    ? `<p class="flash-error">${escapeHtml(webhookError)}</p>`
    : '';
  const testHtml =
    testResult === 'ok'
      ? `<p class="flash-ok">Test message sent.</p>`
      : testResult === 'fail'
        ? `<p class="flash-error">Test message failed to send.</p>`
        : '';

  if (!webhook) {
    return `<section class="webhook-card">
    <h2>Discord webhook</h2>
    ${errorHtml}${testHtml}
    <p>Alerts always show on this page. To also receive them in Discord, create a webhook in your server's channel settings (Edit Channel \u2192 Integrations \u2192 Webhooks), then paste the URL here.</p>
    <form method="POST" action="/alerts/webhook">
      <label>Webhook URL <input type="url" name="url" autocomplete="off" spellcheck="false"></label>
      <div class="webhook-actions"><button type="submit">Save</button></div>
    </form>
  </section>`;
  }

  const stateClass = webhook.enabled ? 'enabled' : 'disabled';
  const stateLabel = webhook.enabled ? 'Enabled' : 'Disabled';
  return `<section class="webhook-card">
    <h2>Discord webhook</h2>
    ${errorHtml}${testHtml}
    <p>Saved webhook: <span class="masked-url">${escapeHtml(maskWebhookUrl(webhook.url))}</span>
    \u2014 <span class="webhook-status ${stateClass}">${stateLabel}</span></p>
    <p class="note">Saving a new URL replaces this one, re-enables it, and clears the failure count.</p>
    <form method="POST" action="/alerts/webhook">
      <label>Webhook URL <input type="url" name="url" autocomplete="off" spellcheck="false"></label>
      <div class="webhook-actions">
        <button type="submit">Save</button>
      </div>
    </form>
    <div class="webhook-actions">
      <form method="POST" action="/alerts/webhook/test"><button type="submit">Send test</button></form>
      <form method="POST" action="/alerts/webhook/delete"><button type="submit">Remove</button></form>
    </div>
  </section>`;
}

function renderAlertsPage({
  loggedIn,
  events = [],
  account = null,
  live = null,
  now = Date.now(),
  webhook = null,
  webhookError = null,
  testResult = null,
} = {}) {
  const nowMs = typeof now === 'function' ? now() : typeof now === 'number' ? now : Date.parse(now);
  let inner;
  if (!loggedIn) {
    inner = `<h1>Alerts</h1>
  <p>You need to be logged in to view your alert feed. <a href="/auth/discord/login">Login with Discord</a></p>`;
  } else {
    const webhookHtml = renderWebhookSection({ webhook, webhookError, testResult });
    const feedHtml = !events.length
      ? `<p>Nothing in your feed yet. Turn on down, online, capacity, or free-slot alerts from a <a href="/servers">server detail page</a> or from a server on your <a href="/favorites">favorites</a> list \u2014 they show up here when they fire.</p>`
      : `<ul class="alert-feed">${events.map((event) => renderAlertRow(event, nowMs)).join('')}</ul>`;
    inner = `<h1>Alerts</h1>
  ${webhookHtml}
  ${feedHtml}`;
  }

  return renderPage({
    title: 'ArkHelper \u2014 Alerts',
    currentPath: '/alerts',
    account,
    live,
    extraCss: PAGE_CSS,
    body: inner,
  });
}

module.exports = { renderAlertsPage, formatRelativeTime, maskWebhookUrl };
