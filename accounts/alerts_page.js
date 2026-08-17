#!/usr/bin/env node
'use strict';

/**
 * alerts_page.js
 *
 * In-page alert feed. Visiting GET /alerts is the ack: displayed
 * rows are marked read by the route after this render. No per-row
 * buttons, no live JS.
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

function renderAlertRow(event, nowMs) {
  const unread = event.readAt ? '' : ' unread';
  const relative = formatRelativeTime(event.createdAt, nowMs);
  const serverHref = `/servers/${encodeURIComponent(event.serverId)}`;
  return `<li class="alert-row${unread}">
    <p>${escapeHtml(event.message)}</p>
    <p class="alert-meta"><a href="${serverHref}">${escapeHtml(event.serverName || event.serverId)}</a>
    \u00b7 <time datetime="${escapeHtml(event.createdAt || '')}">${escapeHtml(relative)}</time></p>
  </li>`;
}

function renderAlertsPage({ loggedIn, events = [], account = null, live = null, now = Date.now() } = {}) {
  const nowMs = typeof now === 'function' ? now() : typeof now === 'number' ? now : Date.parse(now);
  let inner;
  if (!loggedIn) {
    inner = `<h1>Alerts</h1>
  <p>You need to be logged in to view your alert feed. <a href="/auth/discord/login">Login with Discord</a></p>`;
  } else if (!events.length) {
    inner = `<h1>Alerts</h1>
  <p>Nothing in your feed yet. Turn on down, online, capacity, or free-slot alerts from a <a href="/servers">server detail page</a> or from a server on your <a href="/favorites">favorites</a> list \u2014 they show up here when they fire.</p>`;
  } else {
    inner = `<h1>Alerts</h1>
  <ul class="alert-feed">${events.map((event) => renderAlertRow(event, nowMs)).join('')}</ul>`;
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

module.exports = { renderAlertsPage, formatRelativeTime };
