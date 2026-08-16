'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderStatusPage, verdictFor, formatDurationMs } = require('./status_page.js');

function baseStatus(overrides = {}) {
  return {
    state: 'NORMAL',
    verdictKey: 'up',
    offlinePct: 2.5,
    baselinePct: 3.1,
    onlineCount: 3100,
    totalKnown: 3180,
    serversAffected: 80,
    rosterFetchFailed: false,
    computedAt: '2026-08-15T12:00:00.000Z',
    activeIncident: null,
    incidents: [],
    ...overrides,
  };
}

test('renderStatusPage shows a fallback when status data is unavailable', () => {
  const html = renderStatusPage({ statusAvailable: false });
  assert.match(html, /Status data isn't available right now/);
  assert.match(html, /href="\/servers"/);
});

test('renderStatusPage renders the UP verdict', () => {
  const html = renderStatusPage({ statusAvailable: true, status: baseStatus() });
  assert.match(html, /ARK official servers look UP/);
  assert.match(html, /class="verdict up"/);
  assert.match(html, /3100 \/ 3180/);
  assert.match(html, /offline 2\.5%/);
  assert.match(html, /24h baseline 3\.1%/);
  assert.match(html, /own monitoring path/);
  assert.match(html, /href="\/servers"/);
});

test('renderStatusPage renders a possible-outage verdict and incident start', () => {
  const html = renderStatusPage({
    statusAvailable: true,
    status: baseStatus({
      state: 'OUTAGE',
      verdictKey: 'outage',
      offlinePct: 32,
      activeIncident: { id: 1, type: 'OUTAGE', startedAt: '2026-08-15T10:00:00.000Z' },
      incidents: [{ id: 1, type: 'OUTAGE', startedAt: '2026-08-15T10:00:00.000Z', endedAt: null, durationMs: 7200000 }],
    }),
  });
  assert.match(html, /Possible outage in progress/);
  assert.match(html, /class="verdict outage"/);
  assert.match(html, /Current incident started/);
  assert.match(html, /ongoing/);
  assert.match(html, /2h/);
});

test('renderStatusPage renders the update-rollout verdict', () => {
  const html = renderStatusPage({
    statusAvailable: true,
    status: baseStatus({
      state: 'UPDATE_ROLLOUT',
      verdictKey: 'update',
      activeIncident: { id: 2, type: 'UPDATE_ROLLOUT', startedAt: '2026-08-15T11:00:00.000Z' },
      incidents: [{ id: 2, type: 'UPDATE_ROLLOUT', startedAt: '2026-08-15T11:00:00.000Z', endedAt: null, durationMs: 3600000 }],
    }),
  });
  assert.match(html, /Update appears to be rolling out/);
  assert.match(html, /class="verdict update"/);
  assert.match(html, /Update rollout/);
});

test('renderStatusPage renders the unreachable verdict', () => {
  const html = renderStatusPage({
    statusAvailable: true,
    status: baseStatus({
      state: 'UNREACHABLE',
      verdictKey: 'unreachable',
      rosterFetchFailed: true,
      onlineCount: null,
      totalKnown: 0,
      offlinePct: null,
    }),
  });
  assert.match(html, /We can&#39;t reach ARK&#39;s server list right now/);
  assert.match(html, /class="verdict unreachable"/);
});

test('renderStatusPage lists closed incidents with start, end, and duration', () => {
  const html = renderStatusPage({
    statusAvailable: true,
    status: baseStatus({
      incidents: [
        {
          id: 9,
          type: 'DEGRADED',
          startedAt: '2026-08-14T08:00:00.000Z',
          endedAt: '2026-08-14T10:30:00.000Z',
          durationMs: 2.5 * 60 * 60 * 1000,
        },
      ],
    }),
  });
  assert.match(html, /Degraded/);
  assert.match(html, /2026-08-14 08:00:00 UTC/);
  assert.match(html, /2026-08-14 10:30:00 UTC/);
  assert.match(html, /2h 30m/);
});

test('verdictFor falls back to UP for an unknown key', () => {
  assert.equal(verdictFor({ verdictKey: 'nope' }).key, 'up');
});

test('formatDurationMs handles minutes, hours, and days', () => {
  assert.equal(formatDurationMs(5 * 60 * 1000), '5m');
  assert.equal(formatDurationMs(90 * 60 * 1000), '1h 30m');
  assert.equal(formatDurationMs(3 * 24 * 60 * 60 * 1000), '3d 0h');
});
