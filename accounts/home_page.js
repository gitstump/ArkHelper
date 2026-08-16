#!/usr/bin/env node
'use strict';

/**
 * home_page.js
 *
 * "/" is the server browser (same render path as /servers) with a
 * hero stat band above the table. escapeHtml stays here so existing
 * imports keep working; the implementation lives in theme.js.
 */

const { escapeHtml } = require('./theme.js');
const { realHttpGetLocal, fetchJsonSafe } = require('./local_fetch.js');
const { renderBrowserPage } = require('./server_browser.js');

function renderHomepage({ account, rosterMeta, status, page, filters, sort, dir, counters, mapOptions, rosterAvailable, presets, loggedIn, shareOrigin, currentQuery, presetError, live }) {
  return renderBrowserPage({
    account,
    rosterMeta,
    live: live || rosterMeta,
    status,
    page,
    filters,
    sort,
    dir,
    counters,
    mapOptions,
    rosterAvailable: Boolean(rosterAvailable),
    presets,
    loggedIn: loggedIn ?? Boolean(account),
    shareOrigin,
    currentQuery,
    presetError,
    currentPath: '/',
    showHero: true,
  });
}

const fetchRosterMetaSafe = fetchJsonSafe;

module.exports = {
  escapeHtml,
  renderHomepage,
  fetchRosterMetaSafe,
  realHttpGetLocal,
};
