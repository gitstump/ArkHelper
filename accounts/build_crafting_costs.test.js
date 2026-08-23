'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  EXPECTED_KEEP_COUNT,
  EXPECTED_EXCLUDE_COUNT,
} = require('./crafting_cost.js');
const { buildFromFiles, formatDuplicateDnames } = require('./build_crafting_costs.js');

function tripwireRows(opts = {}) {
  const keepCount = opts.keepCount ?? EXPECTED_KEEP_COUNT;
  const excludeCount = opts.excludeCount ?? EXPECTED_EXCLUDE_COUNT;
  const keepRes = opts.keepRes || 'PrimalItemResource_Stone_C';
  const rows = [];
  for (let i = 0; i < keepCount; i += 1) {
    rows.push({
      name: opts.keepName ? opts.keepName(i) : `PrimalItemResource_Keep${i}`,
      dname: `Keep ${i}`,
      pkg: '/Game/PrimalEarth/CoreBlueprints/Resources/Keep',
      result: 'OK',
      reqs: [{ qty: 1, res: keepRes }],
    });
  }
  for (let i = 0; i < excludeCount - 1; i += 1) {
    rows.push({
      name: `PrimalItem_Exclude${i}`,
      dname: `Exclude ${i}`,
      pkg: '/Game/PrimalEarth/CoreBlueprints/Weapons/Exclude',
      result: 'OK',
      reqs: [{ qty: 1, res: 'PrimalItemResource_Hide_C' }],
    });
  }
  rows.push({
    name: 'PrimalItemResource_Stone',
    dname: 'Stone',
    pkg: '/Game/PrimalEarth/CoreBlueprints/Resources/Stone',
    reqs: [],
  });
  return rows;
}

function writeTempBuild(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkhelper-craft-'));
  const fullPath = path.join(dir, 'items_full.jsonl');
  const yieldPath = path.join(dir, 'items_yield2.jsonl');
  const engramPath = path.join(dir, 'Engrams.json');
  const outPath = path.join(dir, 'crafting_costs.json');
  fs.writeFileSync(fullPath, files.full || '');
  fs.writeFileSync(yieldPath, files.yield || '');
  fs.writeFileSync(engramPath, files.engrams || '{}');
  return { dir, fullPath, yieldPath, engramPath, outPath };
}

test('build fails when keep-rule counts do not match the tripwire', () => {
  const { fullPath, yieldPath, engramPath, outPath } = writeTempBuild({});
  assert.throws(
    () => buildFromFiles(fullPath, yieldPath, engramPath, outPath),
    /KEEP 0 EXCLUDED 0/
  );
});

test('build fails listing classes with no display name', () => {
  const rows = tripwireRows({ keepRes: 'PrimalItemResource_Missing_C' });
  const yields = rows.slice(0, EXPECTED_KEEP_COUNT).map((row) => ({
    name: row.name,
    result: 'OK',
    qty_made: 1,
    extra: [],
    stations: [],
  }));
  const { fullPath, yieldPath, engramPath, outPath } = writeTempBuild({
    full: `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`,
    yield: `${yields.map((row) => JSON.stringify(row)).join('\n')}\n`,
    engrams: '{}',
  });
  assert.throws(
    () => buildFromFiles(fullPath, yieldPath, engramPath, outPath),
    /missing display names: PrimalItemResource_Missing_C/
  );
});

test('build fails when a display-name override targets an absent class', () => {
  const rows = tripwireRows();
  const yields = rows.slice(0, EXPECTED_KEEP_COUNT).map((row) => ({
    name: row.name,
    result: 'OK',
    qty_made: 1,
    extra: [],
    stations: [],
  }));
  const { fullPath, yieldPath, engramPath, outPath } = writeTempBuild({
    full: `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`,
    yield: `${yields.map((row) => JSON.stringify(row)).join('\n')}\n`,
    engrams: '{}',
  });
  assert.throws(
    () => buildFromFiles(fullPath, yieldPath, engramPath, outPath),
    /stale display-name overrides: PrimalItemResource_ElementDustFromShards/
  );
});

test('formatDuplicateDnames lists colliding pairs for the Owner', () => {
  assert.equal(
    formatDuplicateDnames([
      { dname: 'Water Jar', names: ['A', 'B'] },
      { dname: 'Canteen', names: ['C', 'D'] },
    ]),
    '"Water Jar": A, B\n"Canteen": C, D'
  );
});
