#!/usr/bin/env node
'use strict';

/**
 * rates_page.js
 *
 * /rates — current official-network multipliers per variant, a bonus
 * banner when official multipliers are off 1.0, and recent changes.
 */

const { escapeHtml } = require('./theme.js');
const { renderPage } = require('./layout.js');

const VARIANT_ORDER = ['official', 'arkpocalypse', 'smalltribes', 'conquest'];
const VARIANT_LABELS = {
  official: 'Official',
  arkpocalypse: 'Arkpocalypse',
  smalltribes: 'Small Tribes',
  conquest: 'Conquest',
};

const PAGE_CSS = `
.bonus-banner {
  background: #3a2a12;
  border: 1px solid var(--degraded);
  color: var(--degraded);
  border-radius: var(--radius);
  padding: var(--space-4) var(--space-5);
  font-size: 1.15rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  margin: 0 0 var(--space-5);
}
.rates-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: var(--space-3); margin: var(--space-4) 0 var(--space-5); }
.rate-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: var(--space-4); }
.rate-card h2 { margin: 0 0 var(--space-3); font-size: 1.05rem; }
.rate-card dl { margin: 0; display: grid; gap: var(--space-2); }
.rate-card .fig { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 1.05rem; font-weight: 700; color: var(--accent); }
.rate-card .lbl { color: var(--muted); font-size: 0.75rem; }
.rate-card .other { margin-top: var(--space-3); color: var(--muted); font-size: 0.82rem; }
.rate-card .other div { margin-top: var(--space-1); word-break: break-word; }
`;

function labelForKey(key) {
  return String(key || '')
    .replace(/Multiplier$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^b([A-Z])/, '$1');
}

function isMultiplierKey(key) {
  return typeof key === 'string' && key.endsWith('Multiplier');
}

function formatRateValue(key, value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return isMultiplierKey(key) ? `${value}\u00d7` : String(value);
  }
  if (value == null) return '\u2014';
  return String(value);
}

function hasBonusRates(officialRates) {
  if (!officialRates || typeof officialRates !== 'object') return false;
  return Object.entries(officialRates).some(
    ([key, value]) => isMultiplierKey(key) && typeof value === 'number' && Number.isFinite(value) && value !== 1
  );
}

function formatWhen(iso) {
  if (!iso) return '\u2014';
  return String(iso).replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

function formatChangeValue(value) {
  if (value == null) return '\u2014';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return String(value);
}

function variantLabel(variant) {
  return VARIANT_LABELS[variant] || variant;
}

function renderVariantCard(variant, values) {
  const entries = Object.entries(values || {});
  const multipliers = entries.filter(([key]) => isMultiplierKey(key));
  const others = entries.filter(([key]) => !isMultiplierKey(key));
  const multiRows = multipliers
    .map(
      ([key, value]) =>
        `<div><div class="fig">${escapeHtml(formatRateValue(key, value))}</div><div class="lbl">${escapeHtml(labelForKey(key))}</div></div>`
    )
    .join('');
  const otherRows =
    others.length === 0
      ? ''
      : `<div class="other">${others
          .map(([key, value]) => `<div>${escapeHtml(labelForKey(key))}: ${escapeHtml(formatRateValue(key, value))}</div>`)
          .join('')}</div>`;
  return `<article class="rate-card">
    <h2>${escapeHtml(variantLabel(variant))}</h2>
    <dl>${multiRows || '<div class="note">No multipliers in this snapshot.</div>'}</dl>
    ${otherRows}
  </article>`;
}

function renderRatesPage({ feedAvailable, feed, account = null, live = null }) {
  if (!feedAvailable || !feed || !feed.variants || Object.keys(feed.variants).length === 0) {
    return renderPage({
      title: 'Official rates \u2014 ArkHelper',
      currentPath: '/rates',
      account,
      live,
      extraCss: PAGE_CSS,
      body: `<h1>Official rates</h1>
  <p>Rate data isn't available right now (the discovery service may not be running, or it hasn't fetched the CDN feeds yet).</p>`,
    });
  }

  const variants = feed.variants;
  const official = variants.official || {};
  const banner = hasBonusRates(official)
    ? `<div class="bonus-banner" role="status">Bonus rates active</div>`
    : '';

  const seen = new Set();
  const cards = [];
  for (const variant of VARIANT_ORDER) {
    if (variants[variant]) {
      seen.add(variant);
      cards.push(renderVariantCard(variant, variants[variant]));
    }
  }
  for (const variant of Object.keys(variants)) {
    if (!seen.has(variant)) cards.push(renderVariantCard(variant, variants[variant]));
  }

  const changes = Array.isArray(feed.changes) ? feed.changes : [];
  const table =
    changes.length === 0
      ? `<p class="note">No rate changes recorded yet.</p>`
      : `<table>
      <thead><tr><th>Network</th><th>Key</th><th>Change</th><th>When</th></tr></thead>
      <tbody>${changes
        .map(
          (c) => `<tr>
            <td>${escapeHtml(variantLabel(c.variant))}</td>
            <td>${escapeHtml(c.key || '')}</td>
            <td class="num">${escapeHtml(formatChangeValue(c.old))} \u2192 ${escapeHtml(formatChangeValue(c.new))}</td>
            <td class="num">${escapeHtml(formatWhen(c.changedAt))}</td>
          </tr>`
        )
        .join('')}</tbody>
    </table>`;

  return renderPage({
    title: 'Official rates \u2014 ArkHelper',
    description: 'Live official ARK: Survival Ascended server rates by network, plus recent multiplier changes.',
    currentPath: '/rates',
    account,
    live,
    extraCss: PAGE_CSS,
    body: `<h1>Official rates</h1>
  ${banner}
  <p class="note">Current multipliers from Wildcard's CDN config feeds. Values are what official servers are running, not a recommendation.</p>
  <div class="rates-grid">${cards.join('')}</div>
  <h2>Recent changes</h2>
  ${table}`,
  });
}

module.exports = {
  renderRatesPage,
  hasBonusRates,
  formatRateValue,
  labelForKey,
  VARIANT_ORDER,
  VARIANT_LABELS,
};
