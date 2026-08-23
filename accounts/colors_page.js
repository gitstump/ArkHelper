#!/usr/bin/env node
'use strict';

/**
 * colors_page.js
 *
 * /colors — base palette, dyes, and creature-to-set lookup.
 * /colors/sets/:slug — one page per color set (regions 0–5).
 * Data is boot-loaded once; this module never opens the file.
 */

const fs = require('node:fs');
const path = require('node:path');
const { escapeHtml } = require('./theme.js');
const { renderPage } = require('./layout.js');

const DEFAULT_COLORS_PATH = path.join(__dirname, '..', 'data', 'colors.json');
const COLORS_MAX_BYTES = 5 * 1024 * 1024;

const PAGE_CSS = `
.swatch { display: inline-block; width: 1.15rem; height: 1.15rem; border: 1px solid var(--border); border-radius: 3px; vertical-align: middle; }
.color-hex { font-family: var(--font-mono); font-size: 0.85rem; }
.dye-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(11.5rem, 1fr)); gap: var(--space-2); list-style: none; padding: 0; margin: var(--space-3) 0 0; }
.dye-grid li { display: flex; align-items: center; gap: var(--space-2); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: var(--space-2) var(--space-3); }
.region-block { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: var(--space-3) var(--space-4); margin: 0 0 var(--space-3); }
.region-block h3 { margin: 0 0 var(--space-2); font-size: 1rem; }
.region-meta { color: var(--muted); font-size: 0.85rem; margin: 0 0 var(--space-2); }
.swatch-grid { display: flex; flex-wrap: wrap; gap: var(--space-2); list-style: none; padding: 0; margin: 0; }
.swatch-grid li { display: flex; align-items: center; gap: var(--space-2); background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); padding: 4px 8px; font-size: 0.85rem; }
.badge-unresolved { display: inline-block; font-size: 0.7rem; font-weight: 600; letter-spacing: 0.02em; color: var(--degraded); border: 1px solid var(--degraded); border-radius: 999px; padding: 0 7px; }
.used-by { list-style: none; padding: 0; margin: 0 0 var(--space-4); }
.used-by li { padding: var(--space-1) 0; border-bottom: 1px solid var(--border); }
.used-by li:last-child { border-bottom: none; }
.creature-filter { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; margin-top: var(--space-3); }
.creature-filter input { min-width: 16rem; }
.caveat { color: var(--degraded); font-size: 0.9rem; }
#creature-table td { font-family: var(--font-mono); font-size: 0.88rem; }
`;

const FILTER_JS = `
(function () {
  var input = document.getElementById('creature-filter');
  var rows = document.querySelectorAll('#creature-table tbody tr');
  if (!input || !rows.length) return;
  input.addEventListener('input', function () {
    var q = String(input.value || '').toLowerCase();
    for (var i = 0; i < rows.length; i++) {
      var hay = rows[i].getAttribute('data-search') || '';
      rows[i].hidden = q !== '' && hay.indexOf(q) === -1;
    }
  });
})();
`;

function genderLabel(gender) {
  if (gender === 'male') return ' (male)';
  if (gender === 'female') return ' (female)';
  return '';
}

function indexColorsData(data) {
  const bySlug = new Map();
  const creatures = new Map();
  const sets = Array.isArray(data && data.sets) ? data.sets : [];
  for (const set of sets) {
    if (!set || !set.slug) continue;
    bySlug.set(set.slug, set);
    for (const entry of Array.isArray(set.used_by) ? set.used_by : []) {
      if (!entry || !entry.char) continue;
      if (!creatures.has(entry.char)) creatures.set(entry.char, []);
      creatures.get(entry.char).push({
        slug: set.slug,
        name: set.name,
        gender: entry.gender == null ? null : entry.gender,
      });
    }
  }
  return { data, bySlug, creatures };
}

function loadColorsData(filePath = DEFAULT_COLORS_PATH) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    throw new Error(`colors data missing: ${filePath}`);
  }
  if (stat.size > COLORS_MAX_BYTES) {
    throw new Error(`colors data too large: ${stat.size} bytes (max ${COLORS_MAX_BYTES})`);
  }
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    throw new Error(`colors data unreadable: ${filePath}`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(`colors data unreadable: ${filePath}: ${err.message}`);
  }
  if (!data || !Array.isArray(data.colors) || !Array.isArray(data.dyes) || !Array.isArray(data.sets)) {
    throw new Error(`colors data missing required arrays: ${filePath}`);
  }
  return indexColorsData(data);
}

function resolveColorSet(store, slug) {
  if (!store || !store.bySlug) return null;
  return store.bySlug.get(slug) || null;
}

function swatchHtml(hex) {
  if (!hex) return '';
  const safe = escapeHtml(hex);
  return `<span class="swatch" style="background:${safe}" title="${safe}"></span>`;
}

function renderPaletteTable(colors) {
  const rows = (Array.isArray(colors) ? colors : [])
    .map(
      (c) => `<tr>
      <td class="num">${escapeHtml(String(c.id))}</td>
      <td>${swatchHtml(c.hex)}</td>
      <td>${escapeHtml(c.name)}</td>
      <td class="color-hex">${escapeHtml(c.hex)}</td>
    </tr>`
    )
    .join('');
  return `<table>
    <thead><tr><th>ID</th><th></th><th>Name</th><th>Hex</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderDyeGrid(dyes) {
  const items = (Array.isArray(dyes) ? dyes : [])
    .map((d) => `<li>${swatchHtml(d.hex)} <span>${escapeHtml(d.name)}</span></li>`)
    .join('');
  return `<ul class="dye-grid">${items}</ul>`;
}

function creatureRows(store) {
  const names = [...(store.creatures || new Map()).keys()].sort((a, b) => a.localeCompare(b));
  return names.map((char) => {
    const refs = store.creatures.get(char) || [];
    const links = refs
      .map((ref) => {
        const mark = genderLabel(ref.gender);
        return `<a href="/colors/sets/${escapeHtml(ref.slug)}">${escapeHtml(ref.name)}</a>${escapeHtml(mark)}`;
      })
      .join(', ');
    const search = `${char} ${refs.map((r) => `${r.name} ${r.gender || ''}`).join(' ')}`.toLowerCase();
    return `<tr data-search="${escapeHtml(search)}"><td>${escapeHtml(char)}</td><td>${links}</td></tr>`;
  });
}

function renderCreatureTable(store) {
  const rows = creatureRows(store);
  if (!rows.length) return `<p class="note">No creature color-set joins in this dataset.</p>`;
  return `<div class="creature-filter">
    <label>Filter creatures <input type="search" id="creature-filter" placeholder="Blueprint name"></label>
  </div>
  <table id="creature-table">
    <thead><tr><th>Creature blueprint</th><th>Color set</th></tr></thead>
    <tbody>${rows.join('')}</tbody>
  </table>`;
}

function renderColorsIndexPage({ store, account = null, live = null } = {}) {
  const data = store && store.data ? store.data : { colors: [], dyes: [], sets: [] };
  const body = `<h1>Creature Colors</h1>
  <p class="note">In-game color IDs, dye swatches, and the color set each creature blueprint actually uses. Region labels on set pages are display strings only — the region number (0–5) is the stable key.</p>
  <h2>Base color palette</h2>
  <p class="note">IDs 1–100 are the in-game color IDs. Swatches are converted from the game's linear channel values to sRGB.</p>
  ${renderPaletteTable(data.colors)}
  <h2>Dyes</h2>
  <p class="note">Display names and swatches for every extracted dye. Dye-to-color-ID pairing is not listed here.</p>
  ${renderDyeGrid(data.dyes)}
  <h2>Creature lookup</h2>
  <p class="note">Each row is a creature blueprint joined to the color set (or sets) recorded on that blueprint — names are never inferred.</p>
  ${renderCreatureTable(store)}`;

  return renderPage({
    title: 'Creature Colors \u2014 ArkHelper',
    description: 'ARK: Survival Ascended creature color IDs, dyes, and per-creature color sets.',
    currentPath: '/colors',
    account,
    live,
    extraCss: PAGE_CSS,
    extraJs: FILTER_JS,
    body,
  });
}

function renderRegionColors(region) {
  const colors = Array.isArray(region && region.colors) ? region.colors : [];
  if (!region || !region.used || !colors.length) {
    return `<p class="note">No colors in this region.</p>`;
  }
  const items = colors
    .map((c) => {
      if (c.resolved && c.hex) {
        return `<li>${swatchHtml(c.hex)} <span>${escapeHtml(c.name)}</span></li>`;
      }
      return `<li><span>${escapeHtml(c.name)}</span> <span class="badge-unresolved">unresolved reference</span></li>`;
    })
    .join('');
  return `<ul class="swatch-grid">${items}</ul>`;
}

function renderColorSetPage({ set, account = null, live = null } = {}) {
  if (!set) return renderColorSetNotFoundPage({ slug: '', account, live });
  const usedBy = Array.isArray(set.used_by) ? set.used_by : [];
  const usedList = usedBy.length
    ? `<ul class="used-by">${usedBy
        .map((u) => `<li>${escapeHtml(u.char)}${escapeHtml(genderLabel(u.gender))}</li>`)
        .join('')}</ul>`
    : `<p class="note">No creature blueprints in this extract reference this set.</p>`;
  const regions = (Array.isArray(set.regions) ? set.regions : [])
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((region) => {
      const state = region.used ? 'used' : 'unused';
      const caveat = region.weight_mismatch
        ? `<p class="caveat">The game's own weight data is inconsistent for this region.</p>`
        : '';
      return `<section class="region-block">
        <h3>Region ${escapeHtml(String(region.index))} — ${escapeHtml(region.label)}</h3>
        <p class="region-meta">${escapeHtml(state)}</p>
        ${caveat}
        ${renderRegionColors(region)}
      </section>`;
    })
    .join('');

  return renderPage({
    title: `${set.name} \u2014 Creature Colors | ArkHelper`,
    description: `Color regions for ${set.name} in ARK: Survival Ascended.`,
    currentPath: `/colors/sets/${set.slug}`,
    account,
    live,
    extraCss: PAGE_CSS,
    body: `<p class="note"><a href="/colors">All creature colors</a></p>
  <h1>${escapeHtml(set.name)}</h1>
  <p class="note">Region numbers 0–5 are the stable key. Labels come from the color-set asset and are not reliable identifiers.</p>
  <h2>Used by</h2>
  ${usedList}
  <h2>Regions</h2>
  ${regions}`,
  });
}

function renderColorSetNotFoundPage({ slug, account = null, live = null } = {}) {
  return renderPage({
    title: 'Color set not found \u2014 ArkHelper',
    description: 'That creature color set does not exist.',
    currentPath: `/colors/sets/${slug || ''}`,
    account,
    live,
    extraCss: PAGE_CSS,
    body: `<h1>Color set not found</h1>
  <p>No color set matches <code>${escapeHtml(slug || '')}</code>.</p>
  <p class="note"><a href="/colors">All creature colors</a></p>`,
  });
}

module.exports = {
  DEFAULT_COLORS_PATH,
  COLORS_MAX_BYTES,
  loadColorsData,
  indexColorsData,
  resolveColorSet,
  renderColorsIndexPage,
  renderColorSetPage,
  renderColorSetNotFoundPage,
};
