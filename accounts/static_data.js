#!/usr/bin/env node
'use strict';

/**
 * static_data.js
 *
 * Content-hashed static JSON assets. Build steps write
 * `<logical-name>.<12-hex-sha256>.json` and update the committed
 * manifest. Accounts reads the manifest once at boot and serves the
 * hashed files from memory — never opened per request. The manifest
 * itself is server-side only; the browser never fetches it.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_DATA_DIR = path.join(__dirname, 'data');
const MANIFEST_NAME = 'manifest.json';
const REQUIRED_KEYS = ['crafting-costs', 'demolish-refunds'];
const HASHED_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const HASH_LENGTH = 12;
const LOGICAL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function contentHash(content) {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, HASH_LENGTH);
}

function hashedFileName(logicalName, content) {
  return `${logicalName}.${contentHash(content)}.json`;
}

function hashedNamePattern(logicalName) {
  return new RegExp(`^${logicalName}\\.[a-f0-9]{${HASH_LENGTH}}\\.json$`);
}

function resolveDataDir(outArg, fallback = DEFAULT_DATA_DIR) {
  if (!outArg) return fallback;
  const resolved = path.resolve(outArg);
  if (resolved.toLowerCase().endsWith('.json')) return path.dirname(resolved);
  return resolved;
}

function readManifestFile(dir) {
  const manifestPath = path.join(dir, MANIFEST_NAME);
  let raw;
  try {
    raw = fs.readFileSync(manifestPath, 'utf8');
  } catch {
    throw new Error(`static data manifest missing: ${manifestPath}`);
  }
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (err) {
    throw new Error(`static data manifest unreadable: ${manifestPath}: ${err.message}`);
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error(`static data manifest is not an object: ${manifestPath}`);
  }
  return { manifest, manifestPath };
}

function writeManifest(dir, manifest) {
  const manifestPath = path.join(dir, MANIFEST_NAME);
  const ordered = {};
  for (const key of Object.keys(manifest).sort()) ordered[key] = manifest[key];
  fs.writeFileSync(manifestPath, `${JSON.stringify(ordered, null, 2)}\n`);
  return manifestPath;
}

function publishStaticAsset({ dir, logicalName, content }) {
  if (!LOGICAL_NAME_RE.test(logicalName || '')) {
    throw new Error(`invalid static data logical name: ${logicalName}`);
  }
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const filename = hashedFileName(logicalName, buffer);
  const filePath = path.join(dir, filename);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, buffer);

  let manifest = {};
  const manifestPath = path.join(dir, MANIFEST_NAME);
  if (fs.existsSync(manifestPath)) {
    manifest = readManifestFile(dir).manifest;
  }
  manifest[logicalName] = filename;
  writeManifest(dir, manifest);

  const pattern = hashedNamePattern(logicalName);
  const deleted = [];
  for (const entry of fs.readdirSync(dir)) {
    if (entry === filename || !pattern.test(entry)) continue;
    fs.unlinkSync(path.join(dir, entry));
    deleted.push(entry);
  }
  return {
    logicalName,
    filename,
    filePath,
    hash: contentHash(buffer),
    deleted,
    manifestPath,
  };
}

function loadStaticData(dir = DEFAULT_DATA_DIR, keys = REQUIRED_KEYS) {
  const { manifest, manifestPath } = readManifestFile(dir);
  const assets = new Map();
  for (const key of keys) {
    const filename = manifest[key];
    if (!filename || typeof filename !== 'string') {
      throw new Error(`static data manifest missing key "${key}" in ${manifestPath}`);
    }
    const filePath = path.join(dir, filename);
    let body;
    try {
      body = fs.readFileSync(filePath);
    } catch {
      throw new Error(`static data file missing for "${key}": ${filePath}`);
    }
    assets.set(key, {
      filename,
      body,
      url: `/data/${filename}`,
    });
  }
  return { manifest, assets, manifestPath };
}

function resolveDataUrl(key, loaded) {
  const data = loaded || loadStaticData();
  const asset = data.assets.get(key);
  if (!asset) {
    throw new Error(`static data manifest missing key "${key}"`);
  }
  return asset.url;
}

function loadGeneratedJson(key, dir = DEFAULT_DATA_DIR) {
  const { assets } = loadStaticData(dir, [key]);
  return JSON.parse(assets.get(key).body.toString('utf8'));
}

module.exports = {
  DEFAULT_DATA_DIR,
  MANIFEST_NAME,
  REQUIRED_KEYS,
  HASHED_CACHE_CONTROL,
  HASH_LENGTH,
  contentHash,
  hashedFileName,
  resolveDataDir,
  publishStaticAsset,
  loadStaticData,
  resolveDataUrl,
  loadGeneratedJson,
};
