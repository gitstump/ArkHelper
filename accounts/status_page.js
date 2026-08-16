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

const VERDICTS = {
  up: 'ARK official servers look UP',
  outage: 'Possible outage in progress',
  update: 'Update appears to be rolling out',
  unreachable: "We can't reach ARK's server list right now",
};

const STYLE = `<style>
  body { background:#141210; color:#e8e6e3; font-family: system-ui, -apple-system, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
  h1, h1 a { color: #f2b544; text-decoration: none; }
  h2 { color: #f2b544; margin-top: 2rem; font-size: 1.1rem; }
  a { color: #7fd0ff; }
  table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; }
  th, td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid #2a2620; }
  th { color: #b8b3a8; font-weight: 600; }
  .verdict { font-size: 2rem; font-weight: 700; line-height: 1.2; margin: 1.2rem 0 0.8rem; }
  .verdict.up { color: #8fd18f; }
  .verdict.outage { color: #f08a6b; }
  .verdict.update { color: #f2b544; }
  .verdict.unreachable { color: #b8b3a8; }
  .numbers { color: #e8e6e3; }
  .note { color: #b8b3a8; font-size: 0.9rem; }
  .num { font-variant-numeric: tabular-nums; }
</style>`;

function formatPct(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '\u2014';
  return `${value}%`;
}

function formatWhen(iso) {
  if (!iso) return '\u2014';
  return escapeHtml(String(iso).replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC'));
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

function renderStatusPage({ statusAvailable, status }) {
  if (!statusAvailable || !status) {
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Is ARK down? \u2014 ArkHelper</title>${STYLE}</head>
<body>
  <h1><a href="/">ArkHelper</a> &rsaquo; Is ARK down?</h1>
  <p class="verdict unreachable">Status data isn't available right now.</p>
  <p class="note">The discovery service may not be running, or it hasn't computed a status snapshot yet.</p>
  <p class="note"><a href="/servers">Browse official servers</a></p>
</body></html>`;
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
      ? `<p class="note">Current incident started ${formatWhen(status.activeIncident.startedAt)} (${escapeHtml(typeLabel(status.activeIncident.type))}).</p>`
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
            <td class="num">${formatWhen(inc.startedAt)}</td>
            <td class="num">${inc.endedAt ? formatWhen(inc.endedAt) : 'ongoing'}</td>
            <td class="num">${escapeHtml(formatDurationMs(inc.durationMs))}</td>
          </tr>`
        )
        .join('')}</tbody>
    </table>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Is ARK down? \u2014 ArkHelper</title>
${STYLE}
</head>
<body>
  <h1><a href="/">ArkHelper</a> &rsaquo; Is ARK down?</h1>
  <p class="verdict ${escapeHtml(verdict.key)}">${escapeHtml(verdict.text)}</p>
  ${numbers}
  ${started}
  <h2>Recent incidents</h2>
  ${table}
  <p class="note">This reflects ArkHelper's own monitoring path (whether official servers appear on Wildcard's public list), not Wildcard's official word. It is a snapshot from ${formatWhen(status.computedAt)}. <a href="/servers">Browse the live server list</a>.</p>
</body>
</html>`;
}

module.exports = {
  renderStatusPage,
  formatPct,
  formatDurationMs,
  typeLabel,
  verdictFor,
};
