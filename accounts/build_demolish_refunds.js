#!/usr/bin/env node
'use strict';

/**
 * build_demolish_refunds.js
 *
 * Build-time step: read phase1/items_full.jsonl and write the static
 * demolish-refund JSON asset. Runtime never opens the JSONL.
 */

const fs = require('node:fs');
const path = require('node:path');
const { parseItemsJsonl, buildDataset } = require('./demolish_refund.js');

const DEFAULT_SOURCE = 'C:\\arkhelper_extract\\phase1\\items_full.jsonl';
const DEFAULT_OUT = path.join(__dirname, 'data', 'demolish_refunds.json');

function buildFromFile(sourcePath, outPath) {
  const text = fs.readFileSync(sourcePath, 'utf8');
  const items = parseItemsJsonl(text);
  const { nodemo, structures, collisions } = buildDataset(items);
  const asset = { nodemo, structures };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(asset)}\n`);
  return { sourcePath, outPath, structureCount: structures.length, nodemoCount: nodemo.length, collisions };
}

function main(argv = process.argv.slice(2)) {
  const sourcePath = argv[0] || process.env.ARKHELPER_ITEMS_JSONL || DEFAULT_SOURCE;
  const outPath = argv[1] || DEFAULT_OUT;
  const result = buildFromFile(sourcePath, outPath);
  process.stdout.write(
    `wrote ${result.structureCount} structures, ${result.nodemoCount} nodemo resources -> ${result.outPath}\n`
  );
}

if (require.main === module) {
  main();
}

module.exports = { DEFAULT_SOURCE, DEFAULT_OUT, buildFromFile, main };
