'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderAlertsPage, formatRelativeTime } = require('./alerts_page.js');

const NOW = Date.parse('2026-08-17T16:00:00.000Z');

function event(overrides = {}) {
  return {
    id: 1,
    accountId: 1,
    serverId: 's1',
    serverName: 'NA-PVE-GenOne6433',
    kind: 'down',
    message: 'NA-PVE-GenOne6433 went offline.',
    createdAt: '2026-08-17T15:55:00.000Z',
    readAt: null,
    ...overrides,
  };
}

test('formatRelativeTime covers minutes, hours, and just now', () => {
  assert.equal(formatRelativeTime('2026-08-17T16:00:00.000Z', NOW), 'just now');
  assert.equal(formatRelativeTime('2026-08-17T15:55:00.000Z', NOW), '5 minutes ago');
  assert.equal(formatRelativeTime('2026-08-17T15:00:00.000Z', NOW), '1 hour ago');
  assert.equal(formatRelativeTime('2026-08-16T16:00:00.000Z', NOW), '1 day ago');
});

test('renderAlertsPage prompts login when logged out', () => {
  const html = renderAlertsPage({ loggedIn: false, events: [event()] });
  assert.match(html, /need to be logged in/);
  assert.match(html, /href="\/auth\/discord\/login"/);
  assert.doesNotMatch(html, /went offline/);
  assert.match(html, /class="active" href="\/alerts"/);
});

test('renderAlertsPage shows empty-state copy pointing at server pages and favorites', () => {
  const html = renderAlertsPage({ loggedIn: true, events: [] });
  assert.match(html, /Nothing in your feed yet/);
  assert.match(html, /href="\/servers"/);
  assert.match(html, /href="\/favorites"/);
  assert.doesNotMatch(html, /class="alert-feed"/);
});

test('renderAlertsPage lists events with message, server link, and relative time', () => {
  const html = renderAlertsPage({
    loggedIn: true,
    events: [event()],
    now: NOW,
  });
  assert.match(html, /NA-PVE-GenOne6433 went offline\./);
  assert.match(html, /href="\/servers\/s1"/);
  assert.match(html, /5 minutes ago/);
  assert.match(html, /datetime="2026-08-17T15:55:00.000Z"/);
});

test('renderAlertsPage marks unread rows and leaves read rows without the unread class', () => {
  const html = renderAlertsPage({
    loggedIn: true,
    now: NOW,
    events: [
      event({ id: 2, readAt: null, message: 'unread one' }),
      event({ id: 1, readAt: '2026-08-17T15:00:00.000Z', message: 'already read', kind: 'online' }),
    ],
  });
  assert.match(html, /class="alert-row unread"/);
  assert.match(html, /unread one/);
  assert.match(html, /already read/);
  const readBlock = html.slice(html.indexOf('already read') - 80, html.indexOf('already read') + 20);
  assert.doesNotMatch(readBlock, /alert-row unread/);
});

test('renderAlertsPage escapes hostile message and server name', () => {
  const html = renderAlertsPage({
    loggedIn: true,
    now: NOW,
    events: [
      event({
        serverId: 'x',
        serverName: '<script>evil()</script>',
        message: '<img src=x onerror=alert(1)>',
      }),
    ],
  });
  assert.doesNotMatch(html, /<script>evil\(\)<\/script>/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img src=x/);
});
