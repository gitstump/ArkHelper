#!/usr/bin/env node
'use strict';

/**
 * status_page.js
 *
 * Public "Is ARK down?" page. Renders from the latest incident-status
 * snapshot computed during a discovery cycle — no per-request
 * recomputation of offline % or incident state.
 */

const { escapeHtml } = require('./home_page.js');
const { renderPage } = require('./layout.js');

const VERDICTS = {
  up: 'ARK official servers look UP',
  outage: 'Possible outage in progress',
  update: 'Update appears to be rolling out',
  unreachable: "We can't reach ARK's server list right now",
};

const PAGE_CSS = `
.verdict { font-size: 2rem; font-weight: 700; line-height: 1.2; margin: var(--space-4) 0 var(--space-3); }
.verdict.up { color: var(--online); }
.verdict.outage { color: var(--offline); }
.verdict.update { color: var(--degraded); }
.verdict.unreachable { color: var(--muted); }
.numbers { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
`;

function formatPct(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '\u2014';
  return `${value}%`;
}

function formatWhen(iso) {
  if (!iso) return '\u2014';
  return String(iso).replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

function formatDurationMs(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '\u2014';
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (hours < 48) return rem ? `${hours}h ${rem}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function typeLabel(type) {
  if (type === 'OUTAGE') return 'Outage';
  if (type === 'DEGRADED') return 'Degraded';
  if (type === 'UPDATE_ROLLOUT') return 'Update rollout';
  return type || '\u2014';
}

function verdictFor(status) {
  const key = status && status.verdictKey;
  if (key && VERDICTS[key]) return { key, text: VERDICTS[key] };
  return { key: 'up', text: VERDICTS.up };
}

function renderStatusPage({ statusAvailable, status, account = null, live = null }) {
  if (!statusAvailable || !status) {
    return renderPage({
      title: 'Is ARK down? \u2014 ArkHelper',
      currentPath: '/is-ark-down',
      account,
      live,
      extraCss: PAGE_CSS,
      body: `<h1>Is ARK down?</h1>
  <p class="verdict unreachable">Status data isn't available right now.</p>
  <p class="note">The discovery service may not be running, or it hasn't computed a status snapshot yet.</p>
  <p class="note"><a href="/servers">Browse official servers</a></p>`,
    });
  }

  const verdict = verdictFor(status);
  const online = status.onlineCount;
  const total = status.totalKnown;
  const numbers =
    typeof online === 'number' && typeof total === 'number'
      ? `<p class="numbers">${escapeHtml(String(online))} / ${escapeHtml(String(total))} known official servers currently listed &middot; ` +
        `offline ${escapeHtml(formatPct(status.offlinePct))} ` +
        `(24h baseline ${escapeHtml(formatPct(status.baselinePct))})</p>`
      : `<p class="numbers">Current roster numbers aren't available for this reading.</p>`;

  const started =
    status.activeIncident && status.activeIncident.startedAt
      ? `<p class="note">Current incident started ${escapeHtml(formatWhen(status.activeIncident.startedAt))} (${escapeHtml(typeLabel(status.activeIncident.type))}).</p>`
      : '';

  const incidents = Array.isArray(status.incidents) ? status.incidents : [];
  const table =
    incidents.length === 0
      ? `<p class="note">No incidents recorded yet.</p>`
      : `<table>
      <thead><tr><th>Type</th><th>Started</th><th>Ended</th><th>Duration</th></tr></thead>
      <tbody>${incidents
        .map(
          (inc) => `<tr>
            <td>${escapeHtml(typeLabel(inc.type))}</td>
            <td class="num">${escapeHtml(formatWhen(inc.startedAt))}</td>
            <td class="num">${escapeHtml(inc.endedAt ? formatWhen(inc.endedAt) : 'ongoing')}</td>
            <td class="num">${escapeHtml(formatDurationMs(inc.durationMs))}</td>
          </tr>`
        )
        .join('')}</tbody>
    </table>`;

  return renderPage({
    title: 'Is ARK down? \u2014 ArkHelper',
    currentPath: '/is-ark-down',
    account,
    live,
    extraCss: PAGE_CSS,
    body: `<h1>Is ARK down?</h1>
  <p class="verdict ${escapeHtml(verdict.key)}">${escapeHtml(verdict.text)}</p>
  ${numbers}
  ${started}
  <h2>Recent incidents</h2>
  ${table}
  <p class="note">This reflects ArkHelper's own monitoring path (whether official servers appear on Wildcard's public list), not Wildcard's official word. It is a snapshot from ${escapeHtml(formatWhen(status.computedAt))}. <a href="/servers">Browse the live server list</a>.</p>`,
  });
}

module.exports = {
  renderStatusPage,
  formatPct,
  formatDurationMs,
  typeLabel,
  verdictFor,
};
