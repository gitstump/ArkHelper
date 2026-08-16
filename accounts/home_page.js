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

function renderHomepage(opts = {}) {
  return renderBrowserPage({
    ...opts,
    live: opts.live || opts.rosterMeta,
    rosterAvailable: Boolean(opts.rosterAvailable),
    loggedIn: opts.loggedIn ?? Boolean(opts.account),
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
