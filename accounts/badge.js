#!/usr/bin/env node
'use strict';

/**
 * badge.js
 *
 * The embeddable "live status" badge — an <img> pointed at this
 * endpoint shows a small status indicator that updates on every fetch
 * (no caching by design, since the whole point is it stays current).
 * Renders even for a server that's currently absent from the roster,
 * so an embedded badge degrades to "offline" instead of a broken image.
 */

const { escapeHtml } = require('./home_page.js');

const COLORS = {
  online: '#3ea34f',
  offline: '#c0392b',
  unknown: '#6b6459',
};

function truncateName(name, maxLen = 28) {
  if (!name) return 'Unknown server';
  return name.length > maxLen ? `${name.slice(0, maxLen - 1)}\u2026` : name;
}

// status: 'online' | 'offline' | 'unknown'
function renderBadgeSvg({ name, status, playersNow, maxPlayers }) {
  const label = truncateName(name);
  const color = COLORS[status] || COLORS.unknown;
  const statusText =
    status === 'online' ? (typeof playersNow === 'number' ? `${playersNow}/${maxPlayers ?? '?'}` : 'online') : status === 'offline' ? 'offline' : 'unknown';

  const labelWidth = 10 + label.length * 6.2;
  const statusWidth = 10 + statusText.length * 6.2;
  const width = Math.round(labelWidth + statusWidth);
  const height = 20;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${labelWidth}" height="${height}" fill="#2a2620" rx="3"/>
  <rect x="${labelWidth}" width="${statusWidth}" height="${height}" fill="${color}" rx="3"/>
  <rect x="${labelWidth - 3}" width="3" height="${height}" fill="${color}"/>
  <text x="${labelWidth / 2}" y="14" font-family="system-ui, sans-serif" font-size="11" fill="#e8e6e3" text-anchor="middle">${escapeHtml(label)}</text>
  <text x="${labelWidth + statusWidth / 2}" y="14" font-family="system-ui, sans-serif" font-size="11" fill="#ffffff" text-anchor="middle">${escapeHtml(statusText)}</text>
</svg>`;
}

// Badge for a server id that isn't in the current roster at all, or
// when the roster itself is unreachable.
function renderUnknownBadgeSvg(label = 'Server') {
  return renderBadgeSvg({ name: label, status: 'unknown' });
}

function buildEmbedSnippets(badgeUrl, serverDetailUrl) {
  return {
    markdown: `[![ArkHelper status](${badgeUrl})](${serverDetailUrl})`,
    html: `<a href="${serverDetailUrl}"><img src="${badgeUrl}" alt="Server status"></a>`,
  };
}

module.exports = {
  renderBadgeSvg,
  renderUnknownBadgeSvg,
  buildEmbedSnippets,
  truncateName,
  COLORS,
};
