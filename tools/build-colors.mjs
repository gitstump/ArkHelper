#!/usr/bin/env node
/**
 * build-colors.mjs
 *
 * Reads DevKit extracts from C:\arkhelper_extract\phase1 and writes
 * data/colors.json. Raw extracts never enter the repo.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXTRACT_DIR = 'C:\\arkhelper_extract\\phase1';
const MAX_BYTES = 5 * 1024 * 1024;

export const DEF_RE =
  /\{region_name:\s*"(.*?)",\s*color_entry_names:\s*(?:\((.*?)\))?\s*,\s*random_weights:\s*(?:\(([^)]*)\))?\s*,\s*min_level:\s*(?:\(([^)]*)\))?\s*,\s*max_level:\s*(?:\(([^)]*)\))?\s*\}>?$/s;

const COLOR_NAME_RE = /"((?:[^"\\]|\\.)*)"/g;

export function linearToSrgb8(l) {
  const s = l <= 0.0031308 ? 12.92 * l : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, s)) * 255);
}

export function toHex(r, g, b) {
  const hex = (n) => linearToSrgb8(Number(n) || 0).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`.toUpperCase();
}

export function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function setNameFromPath(p) {
  const text = String(p || '');
  const seg = text.split('/').pop() || '';
  const dot = seg.indexOf('.');
  return dot === -1 ? seg : seg.slice(0, dot);
}

export function regionLabel(raw, index) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed || trimmed === 'Not Used' || trimmed.includes('"')) {
    return `Region ${index}`;
  }
  return trimmed.replace(/\s+/g, ' ');
}

export function parseColorNames(group2) {
  if (group2 == null || group2 === '') return [];
  const names = [];
  COLOR_NAME_RE.lastIndex = 0;
  let m;
  while ((m = COLOR_NAME_RE.exec(group2))) {
    names.push(m[1].replace(/\\"/g, '"'));
  }
  return names;
}

export function parseWeights(group3) {
  if (group3 == null || String(group3).trim() === '') return null;
  const weights = String(group3)
    .split(',')
    .map((s) => parseFloat(s.trim()))
    .filter((n) => Number.isFinite(n));
  return weights.length ? weights : null;
}

export function parseDefinition(defString) {
  const text = String(defString ?? '');
  const m = DEF_RE.exec(text);
  if (!m) return null;
  const names = parseColorNames(m[2]);
  const weights = parseWeights(m[3]);
  return {
    region_name: m[1],
    names,
    weights,
  };
}

export function parseJsonl(text) {
  const records = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    while (i < n && /\s/.test(text[i])) i++;
    if (i >= n) break;
    if (text[i] !== '{' && text[i] !== '[') {
      throw new Error(`Expected JSON value at ${i}`);
    }
    let depth = 0;
    let inStr = false;
    let esc = false;
    const start = i;
    for (; i < n; i++) {
      const c = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') {
        inStr = true;
        continue;
      }
      if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') {
        depth--;
        if (depth === 0) {
          i++;
          records.push(JSON.parse(text.slice(start, i)));
          break;
        }
      }
    }
  }
  return records;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readJsonl(filePath) {
  return parseJsonl(fs.readFileSync(filePath, 'utf8'));
}

export function buildColorsDataset({ colorSets, colorDefs, dyes, charRows, generated }) {
  const colorByName = new Map();
  const colors = [];
  for (const rec of colorDefs) {
    const hex = toHex(rec.r, rec.g, rec.b);
    colors.push({ id: rec.id, name: rec.name, hex });
    colorByName.set(rec.name, hex);
  }
  colors.sort((a, b) => a.id - b.id);

  const dyeList = dyes.map((d) => ({
    name: d.dname,
    hex: toHex(d.r, d.g, d.b),
  }));

  const unresolvedSet = new Set();
  let parseFailures = 0;
  let defCount = 0;
  let usedCount = 0;
  let unusedCount = 0;
  let weightMismatchCount = 0;
  const sets = [];
  const setByName = new Map();
  const slugs = new Set();

  for (const raw of colorSets) {
    const name = raw.name;
    const slug = slugify(name);
    if (!slug) throw new Error(`empty slug for set ${name}`);
    if (slugs.has(slug)) throw new Error(`duplicate slug: ${slug}`);
    slugs.add(slug);
    if (setByName.has(name)) throw new Error(`duplicate set name: ${name}`);

    const regions = [];
    const defs = Array.isArray(raw.color_set_definitions) ? raw.color_set_definitions : [];
    if (defs.length !== 6) {
      throw new Error(`set ${name} has ${defs.length} region defs, expected 6`);
    }
    for (let index = 0; index < 6; index++) {
      defCount++;
      const parsed = parseDefinition(defs[index]);
      if (!parsed) {
        parseFailures++;
        throw new Error(`failed to parse region ${index} of ${name}`);
      }
      const colorNames = parsed.names;
      const used = colorNames.length > 0;
      if (used) usedCount++;
      else unusedCount++;
      const weights = parsed.weights;
      const weight_mismatch = Boolean(used && weights && weights.length !== colorNames.length);
      if (weight_mismatch) weightMismatchCount++;
      const colorEntries = colorNames.map((cname) => {
        const hex = colorByName.get(cname);
        if (hex == null) {
          unresolvedSet.add(cname);
          return { name: cname, resolved: false };
        }
        return { name: cname, resolved: true, hex };
      });
      regions.push({
        index,
        label: regionLabel(parsed.region_name, index),
        used,
        colors: colorEntries,
        weights,
        weight_mismatch,
      });
    }

    const set = { name, slug, regions, used_by: [] };
    sets.push(set);
    setByName.set(name, set);
  }

  if (parseFailures !== 0) {
    throw new Error(`parse failures: ${parseFailures}`);
  }

  const unresolvedRefs = [];
  let skippedError = 0;
  let skippedEmpty = 0;
  let joined = 0;

  for (const row of charRows) {
    if (row && row.error != null) {
      skippedError++;
      continue;
    }
    const male = row.male ? String(row.male) : '';
    const female = row.female ? String(row.female) : '';
    if (!male && !female) {
      skippedEmpty++;
      continue;
    }
    const char = row.char;
    if (!char) throw new Error('char row missing char');
    joined++;

    function attach(pathStr, gender) {
      const setName = setNameFromPath(pathStr);
      const set = setByName.get(setName);
      if (!set) {
        unresolvedRefs.push({ char, setName, path: pathStr });
        return;
      }
      set.used_by.push({ char, gender });
    }

    if (male && female && male !== female) {
      attach(male, 'male');
      attach(female, 'female');
    } else {
      attach(male || female, null);
    }
  }

  if (unresolvedRefs.length) {
    const preview = unresolvedRefs
      .slice(0, 12)
      .map((r) => `${r.char} -> ${r.setName}`)
      .join('; ');
    throw new Error(`unresolved color-set references (${unresolvedRefs.length}): ${preview}`);
  }

  const unresolved_names = [...unresolvedSet].sort((a, b) => a.localeCompare(b));

  return {
    dataset: {
      generated: generated || new Date().toISOString(),
      colors,
      dyes: dyeList,
      sets,
      unresolved_names,
    },
    stats: {
      setCount: sets.length,
      defCount,
      usedCount,
      unusedCount,
      parseFailures,
      weightMismatchCount,
      unresolvedNameCount: unresolved_names.length,
      skippedError,
      skippedEmpty,
      joined,
    },
  };
}

export function loadExtracts(extractDir = EXTRACT_DIR) {
  const colorSets = readJson(path.join(extractDir, 'ColorSets.json'));
  const patch = readJsonl(path.join(extractDir, 'ColorSets_patch.jsonl'));
  const colorDefs = readJsonl(path.join(extractDir, 'ColorDefinitions.jsonl'));
  const dyes = readJsonl(path.join(extractDir, 'DyeDefinitions.jsonl'));
  const charRows = readJsonl(path.join(extractDir, 'CharColorSets.jsonl'));
  if (!Array.isArray(colorSets) || colorSets.length !== 276) {
    throw new Error(`ColorSets.json: expected 276 records, got ${colorSets && colorSets.length}`);
  }
  if (patch.length !== 2) {
    throw new Error(`ColorSets_patch.jsonl: expected 2 records, got ${patch.length}`);
  }
  if (colorDefs.length !== 100) {
    throw new Error(`ColorDefinitions.jsonl: expected 100 records, got ${colorDefs.length}`);
  }
  if (dyes.length !== 127) {
    throw new Error(`DyeDefinitions.jsonl: expected 127 records, got ${dyes.length}`);
  }
  if (charRows.length !== 980) {
    throw new Error(`CharColorSets.jsonl: expected 980 records, got ${charRows.length}`);
  }
  return { colorSets: [...colorSets, ...patch], colorDefs, dyes, charRows };
}

export function writeColorsJson(dataset, outPath) {
  const json = `${JSON.stringify(dataset)}\n`;
  const bytes = Buffer.byteLength(json);
  if (bytes > MAX_BYTES) {
    throw new Error(`colors.json is ${bytes} bytes; over the ${MAX_BYTES} cap`);
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, json);
  return bytes;
}

function isMain() {
  try {
    const self = fileURLToPath(import.meta.url);
    const invoked = process.argv[1] && path.resolve(process.argv[1]);
    if (!invoked) return false;
    return path.normalize(self).toLowerCase() === path.normalize(invoked).toLowerCase();
  } catch {
    return false;
  }
}

function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const outPath = path.join(here, '..', 'data', 'colors.json');
  const extracts = loadExtracts(EXTRACT_DIR);
  const { dataset, stats } = buildColorsDataset({
    ...extracts,
    generated: new Date().toISOString(),
  });
  const bytes = writeColorsJson(dataset, outPath);
  console.log(`[build-colors] wrote ${outPath} (${bytes} bytes)`);
  console.log(
    `[build-colors] sets=${stats.setCount} defs=${stats.defCount} used=${stats.usedCount} unused=${stats.unusedCount} weight_mismatch=${stats.weightMismatchCount} unresolved_names=${stats.unresolvedNameCount}`
  );
  console.log(`[build-colors] join: skipped_error=${stats.skippedError} skipped_empty=${stats.skippedEmpty} joined=${stats.joined}`);
}

if (isMain()) {
  try {
    main();
  } catch (err) {
    console.error(`[build-colors] ${err.message}`);
    process.exitCode = 1;
  }
}
