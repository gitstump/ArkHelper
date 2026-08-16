#!/usr/bin/env node
'use strict';

/**
 * rankings_page.js
 *
 * The /rankings page — top 100 servers by composite rank score, with
 * a breakdown of the four components. Scores are already on the roster
 * (stamped during discovery), so this is a pure sort/slice/render of
 * data the accounts service already fetched. No extra discovery query.
 */

const { escapeHtml } = require('./home_page.js');
const { renderPage } = require('./layout.js');
const { displayNameFor } = require('./stats_page.js');

const TOP_N = 100;

const PAGE_CSS = `
.explain { margin-top: var(--space-6); padding-top: var(--space-4); border-top: 1px solid var(--border); }
.explain h2 { margin-top: 0; }
.explain dt { color: var(--accent); margin-top: var(--space-3); }
.explain dd { margin-left: 0; color: var(--muted); }
`;

function rankingFromRoster(servers, { limit = TOP_N, order = 'desc', minConfidence = null } = {}) {
  const eligible = (Array.isArray(servers) ? servers : []).filter((s) => {
    if (typeof s.rankScore !== 'number') return false;
    if (minConfidence != null) {
      const confidence = s.rankComponents && s.rankComponents.confidence;
      if (typeof confidence !== 'number' || confidence < minConfidence) return false;
    }
    return true;
  });
  const dir = order === 'asc' ? 1 : -1;
  const rows = [...eligible]
    .sort((a, b) => dir * (a.rankScore - b.rankScore) || String(a.id || '').localeCompare(String(b.id || '')))
    .slice(0, limit)
    .map((s, i) => ({
      rank: typeof s.rank === 'number' ? s.rank : i + 1,
      serverId: s.id,
      name: s.name,
      rankScore: s.rankScore,
      components: s.rankComponents || {},
    }));
  return { servers: rows, totalRanked: eligible.length };
}

function formatPoints(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '\u2014';
  return String(value);
}

function renderRankingsPage({
  rosterAvailable,
  ranking,
  account = null,
  live = null,
  currentPath = '/rankings',
  title = 'ArkHelper \u2014 Rankings',
  description,
  heading = 'Rankings',
  intro = '',
  summaryKind = 'top',
}) {
  if (!rosterAvailable) {
    return renderPage({
      title,
      description,
      currentPath,
      account,
      live,
      extraCss: PAGE_CSS,
      body: `<h1>${escapeHtml(heading)}</h1>
  <p>Server data isn't available right now (the discovery service may not be running).</p>`,
    });
  }

  const rows = ranking && Array.isArray(ranking.servers) ? ranking.servers : [];
  const table =
    rows.length === 0
      ? `<p class="note">No rank scores yet — they appear automatically after the discovery service records its first history snapshot.</p>`
      : `<table>
      <thead><tr><th>#</th><th>Server</th><th>Score</th><th>Reliability</th><th>Connection</th><th>Activity</th><th>Confidence</th></tr></thead>
      <tbody>${rows
        .map((s) => {
          const c = s.components || {};
          return `<tr>
            <td>${escapeHtml(String(s.rank ?? ''))}</td>
            <td><a href="/servers/${encodeURIComponent(s.serverId || '')}">${escapeHtml(displayNameFor(s))}</a></td>
            <td class="num">${escapeHtml(formatPoints(s.rankScore))}</td>
            <td class="num">${escapeHtml(formatPoints(c.reliability))}</td>
            <td class="num">${escapeHtml(formatPoints(c.connection))}</td>
            <td class="num">${escapeHtml(formatPoints(c.activity))}</td>
            <td class="num">${escapeHtml(formatPoints(c.confidence))}</td>
          </tr>`;
        })
        .join('')}</tbody>
    </table>`;

  const kindWord = summaryKind === 'lowest' ? 'lowest' : 'top';
  const countNote =
    rows.length > 0
      ? `<p class="note">Showing the ${kindWord} ${escapeHtml(String(rows.length))} of ${escapeHtml(String(ranking.totalRanked))} ranked official servers. Score is out of 100.</p>`
      : '';
  const introHtml = intro ? `<p class="note">${escapeHtml(intro)}</p>` : '';

  return renderPage({
    title,
    description,
    currentPath,
    account,
    live,
    extraCss: PAGE_CSS,
    body: `<h1>${escapeHtml(heading)}</h1>
  ${introHtml}
  ${countNote}
  ${table}

  <section class="explain">
    <h2>How the score is built</h2>
    <p>Every official server gets a score from 0 to 100, rebuilt each time we refresh Wildcard's official list. The four pieces always add up to the score you see above.</p>
    <dl>
      <dt>Reliability — 40 points</dt>
      <dd>How often the server showed up in the official list over the last 7 days. 100% presence is a full 40; 90% is 36; and so on. If we have less than a day of history, we still use what we have — see Confidence.</dd>
      <dt>Connection — 25 points</dt>
      <dd>Ping from Wildcard's monitoring path. 60ms or faster is a full 25. Between 60 and 150ms the score slides down to 15; between 150 and 300ms it slides to 5; slower than 300ms is 2.5. If we don't have a ping, this piece is 0.</dd>
      <dt>Activity — 25 points</dt>
      <dd>Average how full the server was (players &divide; max players) over the last 7 days. A server that sits at half full all week beats one that spiked once and sat empty otherwise — we use the mean, not the peak.</dd>
      <dt>Confidence — 10 points</dt>
      <dd>How much history we have. A week or more of data is a full 10; a server we first saw this refresh gets 0. That keeps a brand-new server from outranking a well-known one on a single lucky snapshot.</dd>
    </dl>
  </section>`,
  });
}

module.exports = {
  TOP_N,
  rankingFromRoster,
  renderRankingsPage,
};
