#!/usr/bin/env node
'use strict';

/**
 * mods_page.js
 *
 * /mods — live mod adoption across currently listed unofficial ASA
 * servers. /mods/:id — metadata plus the listed servers running it.
 * Thumbnails are hotlinked from ForgeCDN via an allowlist only.
 * Unofficial server names are plain text (no detail pages yet).
 */

const { escapeHtml } = require('./theme.js');
const { renderPage } = require('./layout.js');

const CURSEFORGE_ASA = 'https://www.curseforge.com/ark-survival-ascended';

const PAGE_CSS = `
.mods-attr { margin: 0 0 var(--space-4); }
.mods-thumb { width: 24px; height: 24px; object-fit: cover; border-radius: 3px; vertical-align: middle; }
.mod-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: var(--space-4); margin: 0 0 var(--space-5); display: grid; grid-template-columns: auto 1fr; gap: var(--space-4); align-items: start; }
.mod-card .mod-card-thumb { width: 64px; height: 64px; object-fit: cover; border-radius: var(--radius); }
.mod-card .meta { color: var(--muted); font-size: 0.9rem; }
.mod-card .summary { margin: var(--space-3) 0 0; }
`;

function formatWhen(iso) {
  if (!iso) return '\u2014';
  return String(iso).replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

function formatDownloads(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '\u2014';
  return n.toLocaleString('en-US');
}

function formatCount(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '\u2014';
  return n.toLocaleString('en-US');
}

function displayModName(mod) {
  if (mod && typeof mod.name === 'string' && mod.name.trim()) return mod.name;
  const id = mod && (mod.mod_id != null ? mod.mod_id : mod.id);
  return `Mod ${id}`;
}

function resolveForgecdnUrl(raw) {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text) return null;
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  const host = String(parsed.hostname || '').toLowerCase();
  if (host !== 'media.forgecdn.net' && host !== 'edge.forgecdn.net') return null;
  return parsed.href;
}

function resolveCurseForgeUrl(raw) {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text) return null;
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  const host = String(parsed.hostname || '').toLowerCase();
  if (host !== 'www.curseforge.com' && host !== 'curseforge.com') return null;
  return parsed.href;
}

function attributionHtml() {
  return `<p class="note mods-attr">Mod data provided by <a href="${CURSEFORGE_ASA}" rel="noopener noreferrer">CurseForge</a>.</p>`;
}

function renderThumb(url, { size = 24 } = {}) {
  const src = resolveForgecdnUrl(url);
  if (!src) return '';
  const cls = size === 24 ? 'mods-thumb' : 'mod-card-thumb';
  return `<img class="${cls}" src="${escapeHtml(src)}" alt="" width="${size}" height="${size}" loading="lazy" decoding="async">`;
}

function curseForgeLink(url) {
  const href = resolveCurseForgeUrl(url);
  if (!href) return '\u2014';
  return `<a href="${escapeHtml(href)}" rel="noopener noreferrer">CurseForge \u2197</a>`;
}

function renderModsPage({ feedAvailable, summary, listedCount = null, account = null, live = null }) {
  if (!feedAvailable || !summary || !Array.isArray(summary.mods)) {
    return renderPage({
      title: 'ArkHelper \u2014 Mod Adoption',
      description: 'Live mod adoption across unofficial ARK: Survival Ascended servers.',
      currentPath: '/mods',
      account,
      live,
      extraCss: PAGE_CSS,
      body: `<h1>Mod adoption</h1>
  ${attributionHtml()}
  <p>Mod adoption data isn't available right now (the discovery service may not be running).</p>`,
    });
  }

  const mods = summary.mods;
  const listed =
    typeof listedCount === 'number' && Number.isFinite(listedCount) ? formatCount(listedCount) : '\u2014';
  const updated = formatWhen(summary.lastFetchAt);
  const intro = `<p class="note">Adoption is measured across unofficial servers currently listed (${escapeHtml(listed)} listed). Last updated ${escapeHtml(updated)}.</p>`;

  let table;
  if (mods.length === 0) {
    table = `<p class="note">Mod resolution has not run yet.</p>`;
  } else {
    const rows = mods
      .map((mod, i) => {
        const id = mod && mod.mod_id != null ? mod.mod_id : '';
        const name = displayModName(mod);
        const author = mod && mod.author ? mod.author : '\u2014';
        const thumb = renderThumb(mod && mod.logo_url);
        return `<tr>
            <td class="num">${i + 1}</td>
            <td>${thumb}</td>
            <td><a href="/mods/${encodeURIComponent(String(id))}">${escapeHtml(name)}</a></td>
            <td>${escapeHtml(author)}</td>
            <td class="num">${escapeHtml(formatCount(mod && mod.server_count))}</td>
            <td class="num">${escapeHtml(formatCount(mod && mod.players_now))}</td>
            <td class="num">${escapeHtml(formatDownloads(mod && mod.download_count))}</td>
            <td>${curseForgeLink(mod && mod.website_url)}</td>
          </tr>`;
      })
      .join('');
    table = `<table>
      <thead><tr><th>#</th><th></th><th>Mod</th><th>Author</th><th>Servers</th><th>Players now</th><th>CF downloads</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  return renderPage({
    title: 'ArkHelper \u2014 Mod Adoption',
    description: 'Live mod adoption across unofficial ARK: Survival Ascended servers.',
    currentPath: '/mods',
    account,
    live,
    extraCss: PAGE_CSS,
    body: `<h1>Mod adoption</h1>
  ${intro}
  ${attributionHtml()}
  ${table}`,
  });
}

function renderModDetailPage({ mod, account = null, live = null }) {
  const name = displayModName(mod);
  const author = mod && mod.author ? mod.author : '\u2014';
  const summary = mod && mod.summary ? `<p class="summary">${escapeHtml(mod.summary)}</p>` : '';
  const downloads = formatDownloads(mod && mod.download_count);
  const thumb = renderThumb(mod && mod.logo_url, { size: 64 });
  const cf = curseForgeLink(mod && mod.website_url);
  const servers = mod && Array.isArray(mod.servers) ? mod.servers : [];
  const table =
    servers.length === 0
      ? `<p class="note">No currently listed unofficial servers are running this mod.</p>`
      : `<table>
      <thead><tr><th>Server</th><th>Map</th><th>Players</th></tr></thead>
      <tbody>${servers
        .map(
          (s) => `<tr>
            <td>${escapeHtml(s && s.name ? s.name : '(unnamed)')}</td>
            <td>${escapeHtml(s && s.map ? s.map : '\u2014')}</td>
            <td class="num">${escapeHtml(formatCount(s && s.players_now))}</td>
          </tr>`
        )
        .join('')}</tbody>
    </table>`;

  return renderPage({
    title: `${name} \u2014 ArkHelper`,
    description: `Unofficial ARK: Survival Ascended servers running ${name}.`,
    currentPath: `/mods/${mod && mod.mod_id != null ? mod.mod_id : ''}`,
    account,
    live,
    extraCss: PAGE_CSS,
    body: `<h1>${escapeHtml(name)}</h1>
  ${attributionHtml()}
  <section class="mod-card">
    <div>${thumb}</div>
    <div>
      <div class="meta">Author ${escapeHtml(author)} \u00b7 CF downloads ${escapeHtml(downloads)} \u00b7 ${cf}</div>
      ${summary}
    </div>
  </section>
  <h2>Currently listed servers</h2>
  ${table}
  <p class="note"><a href="/mods">All mods</a></p>`,
  });
}

function renderModNotFoundPage({ modId, account = null, live = null } = {}) {
  return renderPage({
    title: 'Mod not found \u2014 ArkHelper',
    description: 'That ArkHelper mod page does not exist.',
    currentPath: `/mods/${modId || ''}`,
    account,
    live,
    extraCss: PAGE_CSS,
    body: `<h1>Mod not found</h1>
  <p>No mod matches <code>${escapeHtml(String(modId || ''))}</code>. See the <a href="/mods">mod adoption list</a>.</p>`,
  });
}

module.exports = {
  renderModsPage,
  renderModDetailPage,
  renderModNotFoundPage,
  resolveForgecdnUrl,
  resolveCurseForgeUrl,
  displayModName,
};
