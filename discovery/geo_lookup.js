#!/usr/bin/env node
'use strict';

/**
 * geo_lookup.js
 *
 * Country lookups for server IPs, using MaxMind's free GeoLite2-Country
 * database via the `maxmind` npm package. This is the one piece of the
 * toolkit so far that isn't zero-dependency Node built-ins — parsing the
 * .mmdb binary format isn't something worth hand-rolling, and `maxmind`
 * is the standard, actively-maintained library for it.
 *
 * Verified directly against the installed package (not guessed): its
 * README and TypeScript definitions confirm `maxmind.open(filepath)`
 * returns a Reader whose `.get(ip)` returns either null or an object
 * shaped like `{ country: { iso_code, names: { en, ... } }, ... }`.
 *
 * SETUP NEEDED (blocking, an account you have to create — not something
 * I can do for you):
 * 1. Free MaxMind account: https://www.maxmind.com/en/geolite2/signup
 * 2. Generate a license key from the account page
 * 3. Download the GeoLite2-Country database (.mmdb file) — either the
 *    direct download link on your account page, or automate it later
 *    with MaxMind's own `geoipupdate` tool / the `geolite2` npm package.
 * 4. Point this module at the .mmdb file's path (see openCountryDb).
 *
 * Until that's done, discovery still works fine — country enrichment is
 * wired in as optional, not a hard dependency.
 */

const maxmind = require('maxmind');

// ---------------------------------------------------------------------
// Opening the database. Injectable so tests never need a real .mmdb file.
// ---------------------------------------------------------------------
async function openCountryDb(dbPath, { openFn = maxmind.open } = {}) {
  if (!dbPath) throw new Error('openCountryDb: no database path given');
  return openFn(dbPath);
}

// ---------------------------------------------------------------------
// Single lookup. `reader` is anything with a .get(ip) method — the real
// maxmind Reader, or a fake in tests.
// ---------------------------------------------------------------------
function lookupCountry(reader, ip) {
  if (!reader || typeof ip !== 'string' || ip.length === 0) return null;

  let result;
  try {
    result = reader.get(ip);
  } catch {
    // Malformed IP, reserved/private range, or anything else the
    // library chokes on — treat as "no answer," never crash the batch.
    return null;
  }

  if (!result || !result.country) return null;
  const { iso_code, names } = result.country;
  return {
    code: iso_code || null,
    name: (names && names.en) || null,
  };
}

// ---------------------------------------------------------------------
// Batch enrichment — adds `country` (ISO code) and `countryName` to each
// server. Servers without a resolvable IP or with no match just get
// nulls, never dropped from the list.
// ---------------------------------------------------------------------
function enrichServersWithCountry(servers, reader) {
  return servers.map((server) => {
    const geo = server.ip ? lookupCountry(reader, server.ip) : null;
    return {
      ...server,
      country: geo ? geo.code : null,
      countryName: geo ? geo.name : null,
    };
  });
}

module.exports = {
  openCountryDb,
  lookupCountry,
  enrichServersWithCountry,
};
