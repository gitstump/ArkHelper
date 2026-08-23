#!/usr/bin/env node
'use strict';

/**
 * build_crafting_costs.js
 *
 * Build-time step: read phase1/items_full.jsonl and
 * phase1/items_yield2.jsonl and write the static crafting-cost JSON
 * asset. Runtime never opens the JSONL.
 */

const fs = require('node:fs');
const path = require('node:path');
const { parseItemsJsonl, buildDataset } = require('./crafting_cost.js');

const DEFAULT_SOURCE_FULL = 'C:\\arkhelper_extract\\phase1\\items_full.jsonl';
const DEFAULT_SOURCE_YIELD = 'C:\\arkhelper_extract\\phase1\\items_yield2.jsonl';
const DEFAULT_OUT = path.join(__dirname, 'data', 'crafting_costs.json');

function buildFromFiles(fullPath, yieldPath, outPath) {
  const fullItems = parseItemsJsonl(fs.readFileSync(fullPath, 'utf8'));
  const yieldItems = parseItemsJsonl(fs.readFileSync(yieldPath, 'utf8'));
  const { stations, items, collisions, unresolved, excludedWrappers } = buildDataset(fullItems, yieldItems);
  const asset = { stations, unresolved, items };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(asset)}\n`);
  return {
    fullPath,
    yieldPath,
    outPath,
    itemCount: items.length,
    wrapperCount: excludedWrappers.length,
    unresolvedCount: unresolved.length,
    collisions,
    excludedWrappers,
  };
}

function main(argv = process.argv.slice(2)) {
  const fullPath = argv[0] || process.env.ARKHELPER_ITEMS_JSONL || DEFAULT_SOURCE_FULL;
  const yieldPath = argv[1] || process.env.ARKHELPER_ITEMS_YIELD_JSONL || DEFAULT_SOURCE_YIELD;
  const outPath = argv[2] || DEFAULT_OUT;
  const result = buildFromFiles(fullPath, yieldPath, outPath);
  process.stdout.write(
    `wrote ${result.itemCount} items, ${result.wrapperCount} excluded wrappers -> ${result.outPath}\n`
  );
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_SOURCE_FULL,
  DEFAULT_SOURCE_YIELD,
  DEFAULT_OUT,
  buildFromFiles,
  main,
};
