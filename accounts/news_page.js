#!/usr/bin/env node
'use strict';

/**
 * news_page.js
 *
 * /news — launcher news listing. Official announcement images are
 * hotlinked from Wildcard's CDN only (never downloaded or re-served).
 */

const { escapeHtml } = require('./theme.js');
const { renderPage } = require('./layout.js');

const CDN_ORIGIN = 'https://cdn2.arkdedicated.com';
const ATTRIBUTION =
  'Game imagery is from Studio Wildcard\'s official announcements. This site is unaffiliated.';

const PAGE_CSS = `
.news-list { list-style: none; margin: var(--space-4) 0 0; padding: 0; display: grid; gap: var(--space-3); }
.news-item { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: var(--space-4); }
.news-item.inactive { opacity: 0.65; }
.news-item.has-image { display: flex; gap: var(--space-4); align-items: flex-start; }
.news-item.has-image .news-body { flex: 1; min-width: 0; }
.news-thumb {
  flex: 0 0 160px;
  width: 160px;
  aspect-ratio: 16 / 9;
  height: auto;
  overflow: hidden;
  border-radius: var(--radius);
  background: var(--bg);
}
.news-thumb img {
  display: block;
  width: 160px;
  height: 100%;
  object-fit: cover;
  color: transparent;
}
.news-item h2 { margin: 0 0 var(--space-2); font-size: 1.05rem; }
.news-item .body { margin: 0 0 var(--space-3); }
.news-item .stamp { color: var(--muted); font-size: 0.82rem; margin: var(--space-2) 0 0; }
.news-attr { margin: var(--space-5) 0 0; }
`;

function titleCaseHyphenated(slug) {
  return String(slug)
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function extractSurviveTheArkSlug(text) {
  if (!text) return null;
  const match = String(text).match(/articles\.html\/([a-z0-9-]+)/i);
  if (!match) return null;
  return match[1].replace(/-r\d+$/i, '');
}

function humanizeArticleSlug(slug) {
  const crunch = String(slug).match(/^community-crunch-(\d+)-(.+)$/i);
  if (crunch) return `Community Crunch ${crunch[1]}: ${titleCaseHyphenated(crunch[2])}`;
  return titleCaseHyphenated(slug);
}

function humanizeDlcName(name) {
  return String(name)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim();
}

function actionTarget(action) {
  if (!action) return null;
  const sep = String(action).indexOf('::');
  return sep === -1 ? String(action) : String(action).slice(sep + 2);
}

function isLinkAction(action) {
  return typeof action === 'string' && action.startsWith('Link::');
}

function isDlcAction(action) {
  return typeof action === 'string' && action.startsWith('DLC::');
}

function displayTitle(entry) {
  if (!entry) return 'Announcement';
  if (entry.title) return entry.title;
  const slug = extractSurviveTheArkSlug(entry.url) || extractSurviveTheArkSlug(entry.action);
  if (slug) return humanizeArticleSlug(slug);
  if (isDlcAction(entry.action)) {
    const name = actionTarget(entry.action);
    if (name && !/^https?:/i.test(name)) return humanizeDlcName(name);
  }
  const target = actionTarget(entry.action);
  if (target && !/^https?:/i.test(target)) return humanizeDlcName(target);
  return 'Announcement';
}

function formatWhen(iso) {
  if (!iso) return '\u2014';
  return String(iso).replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

function formatFirstSeen(iso) {
  if (!iso) return null;
  const day = String(iso).slice(0, 10);
  return day || formatWhen(iso);
}

function isAllowedCdnHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'cdn2.arkdedicated.com' || host.endsWith('.arkdedicated.com');
}

function resolveNewsImageUrl(imagePath) {
  if (imagePath == null) return null;
  const raw = String(imagePath).trim();
  if (!raw || raw.includes('..')) return null;

  if (/^https?:\/\//i.test(raw)) {
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      return null;
    }
    if (parsed.protocol !== 'https:') return null;
    if (!isAllowedCdnHost(parsed.hostname)) return null;
    return parsed.href;
  }

  const relative = raw.replace(/^\/+/, '');
  if (!relative) return null;
  let parsed;
  try {
    parsed = new URL(relative, `${CDN_ORIGIN}/`);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (!isAllowedCdnHost(parsed.hostname)) return null;
  return parsed.href;
}

function renderNewsEntry(entry) {
  const title = displayTitle(entry);
  const body = entry && entry.body ? `<p class="body">${escapeHtml(entry.body)}</p>` : '';
  const link =
    entry && isLinkAction(entry.action) && entry.url
      ? `<p><a href="${escapeHtml(entry.url)}" rel="noopener noreferrer">${escapeHtml(entry.url)}</a></p>`
      : '';
  const seen = formatFirstSeen(entry && entry.firstSeen);
  const stamp = seen ? `<p class="stamp">first seen ${escapeHtml(seen)}</p>` : '';
  const inactive = entry && entry.active === false ? ' inactive' : '';
  const text = `<h2>${escapeHtml(title)}</h2>
    ${body}
    ${link}
    ${stamp}`;
  const imageUrl = resolveNewsImageUrl(entry && entry.imagePath);
  if (!imageUrl) {
    return `<li class="news-item${inactive}">
    ${text}
  </li>`;
  }
  const alt = title || 'ARK news image';
  return `<li class="news-item has-image${inactive}">
    <div class="news-thumb"><img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async"></div>
    <div class="news-body">
    ${text}
    </div>
  </li>`;
}

function renderNewsPage({ feedAvailable, feed, account = null, live = null }) {
  if (!feedAvailable || !feed || !Array.isArray(feed.entries)) {
    return renderPage({
      title: 'ARK news \u2014 ArkHelper',
      currentPath: '/news',
      account,
      live,
      extraCss: PAGE_CSS,
      body: `<h1>ARK news</h1>
  <p>News data isn't available right now (the discovery service may not be running, or it hasn't fetched the CDN feed yet).</p>
  <p class="note news-attr">${escapeHtml(ATTRIBUTION)}</p>`,
    });
  }

  const items =
    feed.entries.length === 0
      ? `<p class="note">No news entries recorded yet.</p>`
      : `<ul class="news-list">${feed.entries.map(renderNewsEntry).join('')}</ul>`;

  return renderPage({
    title: 'ARK news \u2014 ArkHelper',
    description: 'Official ARK: Survival Ascended launcher news — titles, links, and announcement images from Wildcard\'s public feed.',
    currentPath: '/news',
    account,
    live,
    extraCss: PAGE_CSS,
    body: `<h1>ARK news</h1>
  <p class="note">Titles and links from Wildcard's public news feed.</p>
  ${items}
  <p class="note news-attr">${escapeHtml(ATTRIBUTION)}</p>`,
  });
}

module.exports = {
  renderNewsPage,
  resolveNewsImageUrl,
  displayTitle,
  humanizeArticleSlug,
  humanizeDlcName,
  extractSurviveTheArkSlug,
};
