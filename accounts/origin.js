#!/usr/bin/env node
'use strict';

/**
 * origin.js
 *
 * Single place to resolve the public site origin. Badge embed snippets
 * and Discord alert dispatch both use this so the env parsing cannot
 * drift between call sites.
 */

const DEFAULT_ORIGIN = 'https://arkhelper.info';

function siteOrigin(origin, env = process.env) {
  const source = origin !== undefined ? origin : env && env.SITE_ORIGIN;
  const raw = source == null || source === '' ? DEFAULT_ORIGIN : String(source);
  return raw.replace(/\/+$/, '') || DEFAULT_ORIGIN;
}

module.exports = {
  DEFAULT_ORIGIN,
  siteOrigin,
};
