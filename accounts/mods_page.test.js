'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  renderModsPage,
  renderModDetailPage,
  renderModNotFoundPage,
  resolveForgecdnUrl,
  resolveCurseForgeUrl,
  displayModName,
} = require('./mods_page.js');

const GOOD_THUMB = 'https://media.forgecdn.net/avatars/thumb.png';
const EDGE_THUMB = 'https://edge.forgecdn.net/avatars/thumb.png';
const CF_URL = 'https://www.curseforge.com/ark-survival-ascended/mods/splus';

test('resolveForgecdnUrl accepts only https media.forgecdn.net and edge.forgecdn.net', () => {
  assert.equal(resolveForgecdnUrl(GOOD_THUMB), GOOD_THUMB);
  assert.equal(resolveForgecdnUrl(EDGE_THUMB), EDGE_THUMB);
  assert.equal(resolveForgecdnUrl(null), null);
  assert.equal(resolveForgecdnUrl(''), null);
  assert.equal(resolveForgecdnUrl('http://media.forgecdn.net/avatars/thumb.png'), null);
  assert.equal(resolveForgecdnUrl('https://evil.example/pwn.png'), null);
  assert.equal(resolveForgecdnUrl('https://media.forgecdn.net.evil.com/x.png'), null);
  assert.equal(resolveForgecdnUrl('https://cdn2.arkdedicated.com/x.png'), null);
});

test('resolveCurseForgeUrl accepts only https CurseForge hosts', () => {
  assert.equal(resolveCurseForgeUrl(CF_URL), CF_URL);
  assert.equal(resolveCurseForgeUrl('https://curseforge.com/ark-survival-ascended'), 'https://curseforge.com/ark-survival-ascended');
  assert.equal(resolveCurseForgeUrl('http://www.curseforge.com/x'), null);
  assert.equal(resolveCurseForgeUrl('https://www.curseforge.com.evil.com/x'), null);
  assert.equal(resolveCurseForgeUrl('https://evil.example/x'), null);
});

test('displayModName falls back to Mod <id> when unresolved', () => {
  assert.equal(displayModName({ mod_id: 11, name: 'S+' }), 'S+');
  assert.equal(displayModName({ mod_id: 11, name: null }), 'Mod 11');
  assert.equal(displayModName({ mod_id: 11 }), 'Mod 11');
});

test('renderModsPage includes attribution, unresolved names, and allowlisted thumbs', () => {
  const html = renderModsPage({
    feedAvailable: true,
    listedCount: 42,
    summary: {
      lastFetchAt: '2026-08-18T14:00:00.000Z',
      mods: [
        {
          mod_id: 11,
          name: null,
          author: 'A',
          server_count: 2,
          players_now: 9,
          download_count: 1234,
          logo_url: GOOD_THUMB,
          website_url: CF_URL,
        },
        {
          mod_id: 12,
          name: 'Known',
          author: 'B',
          server_count: 1,
          players_now: 3,
          download_count: null,
          logo_url: 'https://evil.example/x.png',
          website_url: 'https://evil.example/x',
        },
      ],
    },
  });
  assert.match(html, /<title>ArkHelper \u2014 Mod Adoption<\/title>/);
  assert.match(html, /Live mod adoption across unofficial ARK: Survival Ascended servers/);
  assert.match(html, /Mod data provided by <a href="https:\/\/www\.curseforge\.com\/ark-survival-ascended"/);
  const attrAt = html.indexOf('Mod data provided by');
  const tableAt = html.indexOf('<table');
  assert.ok(attrAt !== -1 && tableAt !== -1 && attrAt < tableAt);
  assert.match(html, /currently listed/);
  assert.match(html, /42 listed/);
  assert.match(html, /Mod 11/);
  assert.match(html, /href="\/mods\/11"/);
  assert.match(html, /Known/);
  assert.match(html, /src="https:\/\/media\.forgecdn\.net\/avatars\/thumb\.png"/);
  assert.match(html, /alt=""/);
  assert.match(html, /width="24"/);
  assert.doesNotMatch(html, /evil\.example/);
  assert.match(html, /1,234/);
  assert.match(html, /\u2014/);
  assert.match(html, /CurseForge \u2197/);
});

test('renderModsPage degraded and empty states', () => {
  const down = renderModsPage({ feedAvailable: false, summary: null });
  assert.match(down, /discovery service may not be running/);
  assert.match(down, /Mod data provided by/);
  const empty = renderModsPage({
    feedAvailable: true,
    listedCount: 10,
    summary: { mods: [], lastFetchAt: '2026-08-18T14:00:00.000Z' },
  });
  assert.match(empty, /Mod resolution has not run yet/);
  assert.doesNotMatch(empty, /<table/);
});

test('renderModDetailPage shows metadata and plain-text server names', () => {
  const html = renderModDetailPage({
    mod: {
      mod_id: 11,
      name: 'S+',
      author: 'Splus',
      summary: 'Build more.',
      download_count: 50,
      logo_url: EDGE_THUMB,
      website_url: CF_URL,
      servers: [
        { server_key: 'a', name: 'Alpha Box', map: 'TheIsland_WP', players_now: 6 },
        { server_key: 'b', name: 'Beta', map: 'Extinction_WP', players_now: 1 },
      ],
    },
  });
  assert.match(html, /<h1>S\+<\/h1>/);
  assert.match(html, /Splus/);
  assert.match(html, /Build more\./);
  assert.match(html, /Alpha Box/);
  assert.match(html, /TheIsland_WP/);
  assert.doesNotMatch(html, /href="\/servers\/a"/);
  assert.doesNotMatch(html, /href="\/servers\/b"/);
  assert.match(html, /src="https:\/\/edge\.forgecdn\.net\/avatars\/thumb\.png"/);
  assert.match(html, /Mod data provided by/);
});

test('renderModNotFoundPage is a 404-style HTML page', () => {
  const html = renderModNotFoundPage({ modId: 999 });
  assert.match(html, /Mod not found/);
  assert.match(html, /999/);
  assert.match(html, /href="\/mods"/);
});
