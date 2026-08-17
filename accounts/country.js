#!/usr/bin/env node
'use strict';

/**
 * country.js
 *
 * Shared country helpers for the official roster. Discovery may stamp
 * `country` (ISO 3166-1 alpha-2) and `countryName`; both are optional.
 * Flag glyphs are Unicode regional-indicator pairs — no image assets.
 */

const REGIONAL_INDICATOR_A = 0x1f1e6;

function normalizeCountryCode(code) {
  if (typeof code !== 'string') return null;
  const trimmed = code.trim();
  if (!/^[A-Za-z]{2}$/.test(trimmed)) return null;
  return trimmed.toUpperCase();
}

function flagEmoji(code) {
  const iso = normalizeCountryCode(code);
  if (!iso) return '';
  return String.fromCodePoint(
    ...[...iso].map((ch) => REGIONAL_INDICATOR_A + ch.charCodeAt(0) - 65)
  );
}

function regionLabel(code) {
  const iso = normalizeCountryCode(code);
  if (!iso) return '\u2014';
  const flag = flagEmoji(iso);
  return flag ? `${flag} ${iso}` : iso;
}

function countryDisplayName(server) {
  if (!server || typeof server !== 'object') return null;
  const iso = normalizeCountryCode(server.country);
  if (!iso) return null;
  const name = typeof server.countryName === 'string' ? server.countryName.trim() : '';
  return name || iso;
}

function getDistinctCountries(servers) {
  const byCode = new Map();
  for (const s of Array.isArray(servers) ? servers : []) {
    const code = normalizeCountryCode(s && s.country);
    if (!code) continue;
    const name = countryDisplayName(s) || code;
    const prev = byCode.get(code);
    if (!prev || prev.name === code) byCode.set(code, { code, name });
  }
  return [...byCode.values()].sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code));
}

module.exports = {
  normalizeCountryCode,
  flagEmoji,
  regionLabel,
  countryDisplayName,
  getDistinctCountries,
};
