#!/usr/bin/env node
'use strict';

/**
 * guides_page.js
 *
 * /guides index and /guides/:slug article pages. Content comes from
 * the static registry in guides.js — no markdown, no live roster.
 */

const { escapeHtml } = require('./theme.js');
const { renderPage } = require('./layout.js');
const { GUIDE_REGISTRY, resolveGuide } = require('./guides.js');

const PAGE_CSS = `
.guide-index { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: var(--space-3); list-style: none; padding: 0; margin: var(--space-4) 0 0; }
.guide-card { display: block; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: var(--space-4); text-decoration: none; color: inherit; }
.guide-card:hover { border-color: var(--accent); }
.guide-card h2 { margin: 0 0 var(--space-3); font-size: 1.05rem; }
.guide-card .desc { margin: 0 0 var(--space-3); color: var(--muted); }
.guide-card .verified { margin: 0; color: var(--muted); font-size: 0.75rem; }
.guide-article .verified { margin: 0 0 var(--space-4); color: var(--muted); font-size: 0.85rem; }
.guide-article .callout { background: var(--surface); border: 1px solid var(--border); border-left: 4px solid var(--accent); border-radius: var(--radius); padding: var(--space-3) var(--space-4); margin: var(--space-3) 0; }
.guide-article .guide-links { list-style: none; padding: 0; margin: var(--space-3) 0 0; }
.guide-article .guide-links li { margin: 0; padding: var(--space-2) 0; border-bottom: 1px solid var(--border); }
.guide-article .guide-links li:last-child { border-bottom: none; }
.guide-related { margin: var(--space-6) 0 0; }
.guide-related ul { list-style: none; padding: 0; margin: 0; }
.guide-related li { margin: 0 0 var(--space-2); }
.guide-available { list-style: none; padding: 0; margin: var(--space-3) 0 0; }
.guide-available li { margin: 0 0 var(--space-2); }
`;

const INDEX_DESCRIPTION =
  'Original ARK: Survival Ascended guides on ArkHelper: pick a server, survive the first hour, place a bed, and take a first tame.';

function renderBlock(block) {
  if (!block || typeof block !== 'object') return '';
  if (block.type === 'p') {
    return `<p>${escapeHtml(block.text)}</p>`;
  }
  if (block.type === 'list') {
    const items = Array.isArray(block.items) ? block.items : [];
    if (!items.length) return '';
    return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
  }
  if (block.type === 'callout') {
    return `<p class="callout">${escapeHtml(block.text)}</p>`;
  }
  if (block.type === 'links') {
    const items = Array.isArray(block.items) ? block.items : [];
    if (!items.length) return '';
    return `<ul class="guide-links">${items
      .map((item) => {
        const href = item && item.href != null ? String(item.href) : '';
        const label = item && item.label != null ? String(item.label) : '';
        const note = item && item.note != null && item.note !== '' ? ` \u2014 ${escapeHtml(String(item.note))}` : '';
        return `<li><a href="${href}">${escapeHtml(label)}</a>${note}</li>`;
      })
      .join('')}</ul>`;
  }
  return '';
}

function renderSections(sections) {
  return (Array.isArray(sections) ? sections : [])
    .map((section) => {
      const heading = section && section.heading ? `<h2>${escapeHtml(section.heading)}</h2>` : '';
      const blocks = (section && Array.isArray(section.blocks) ? section.blocks : []).map(renderBlock).join('');
      return `${heading}${blocks}`;
    })
    .join('');
}

function renderRelatedFooter(related) {
  const items = (Array.isArray(related) ? related : []).map((slug) => resolveGuide(slug)).filter(Boolean);
  if (!items.length) return '';
  return `<nav class="guide-related" aria-label="Related guides">
    <h2>Related guides</h2>
    <ul>${items
      .map((g) => `<li><a href="/guides/${escapeHtml(g.slug)}">${escapeHtml(g.shortTitle)}</a></li>`)
      .join('')}</ul>
  </nav>`;
}

function renderAvailableGuides() {
  if (!GUIDE_REGISTRY.length) return `<p class="note">No guides yet.</p>`;
  return `<ul class="guide-available">${GUIDE_REGISTRY.map(
    (g) => `<li><a href="/guides/${escapeHtml(g.slug)}">${escapeHtml(g.shortTitle)}</a></li>`
  ).join('')}</ul>`;
}

function renderGuidesIndexPage({ account = null, live = null } = {}) {
  const cards =
    GUIDE_REGISTRY.length === 0
      ? `<p class="note">No guides yet.</p>`
      : `<ul class="guide-index">${GUIDE_REGISTRY.map(
          (g) => `<li><a class="guide-card" href="/guides/${escapeHtml(g.slug)}">
          <h2>${escapeHtml(g.shortTitle)}</h2>
          <p class="desc">${escapeHtml(g.description)}</p>
          <p class="verified">Last verified ${escapeHtml(g.lastVerified)}</p>
        </a></li>`
        ).join('')}</ul>`;

  return renderPage({
    title: 'Guides \u2014 ArkHelper',
    description: INDEX_DESCRIPTION,
    currentPath: '/guides',
    account,
    live,
    extraCss: PAGE_CSS,
    body: `<h1>Guides</h1>
  <p class="note">Original ArkHelper writing for ARK: Survival Ascended \u2014 how to get onto a server, through the first night, and to a first tame.</p>
  ${cards}`,
  });
}

function renderGuidePage({ guide, account = null, live = null } = {}) {
  if (!guide) {
    return renderGuideNotFoundPage({ slug: '', account, live });
  }
  const title = guide.title || guide.shortTitle || 'Guide';
  const description = guide.description || INDEX_DESCRIPTION;
  const slug = guide.slug || '';

  return renderPage({
    title: `${title} \u2014 ArkHelper`,
    description,
    currentPath: `/guides/${slug}`,
    account,
    live,
    extraCss: PAGE_CSS,
    body: `<article class="guide-article">
  <h1>${escapeHtml(title)}</h1>
  <p class="verified">Last verified ${escapeHtml(guide.lastVerified)}</p>
  ${renderSections(guide.sections)}
  ${renderRelatedFooter(guide.related)}
</article>`,
  });
}

function renderGuideNotFoundPage({ slug, account = null, live = null } = {}) {
  return renderPage({
    title: 'Guide not found \u2014 ArkHelper',
    description: 'That ArkHelper guide does not exist.',
    currentPath: `/guides/${slug || ''}`,
    account,
    live,
    extraCss: PAGE_CSS,
    body: `<h1>Guide not found</h1>
  <p>No guide matches <code>${escapeHtml(slug || '')}</code>. Available guides:</p>
  ${renderAvailableGuides()}
  <p class="note"><a href="/guides">All guides</a></p>`,
  });
}

module.exports = {
  renderGuidesIndexPage,
  renderGuidePage,
  renderGuideNotFoundPage,
};
