#!/usr/bin/env node
'use strict';

/**
 * build_demolish_refunds.js
 *
 * Build-time step: read phase1/items_full.jsonl and write the static
 * hashed demolish-refund JSON asset plus manifest. Runtime never
 * opens the JSONL.
 */

const fs = require('node:fs');
const { parseItemsJsonl, buildDataset } = require('./demolish_refund.js');
const {
  DEFAULT_DATA_DIR,
  publishStaticAsset,
  resolveDataDir,
} = require('./static_data.js');

const DEFAULT_SOURCE = 'C:\\arkhelper_extract\\phase1\\items_full.jsonl';
const DEFAULT_OUT = DEFAULT_DATA_DIR;
const LOGICAL_NAME = 'demolish-refunds';

function buildFromFile(sourcePath, outPath) {
  const text = fs.readFileSync(sourcePath, 'utf8');
  const items = parseItemsJsonl(text);
  const { nodemo, structures, collisions } = buildDataset(items);
  const asset = { nodemo, structures };
  const outDir = resolveDataDir(outPath, DEFAULT_DATA_DIR);
  const published = publishStaticAsset({
    dir: outDir,
    logicalName: LOGICAL_NAME,
    content: Buffer.from(`${JSON.stringify(asset)}\n`),
  });
  return {
    sourcePath,
    outPath: published.filePath,
    filename: published.filename,
    deleted: published.deleted,
    structureCount: structures.length,
    nodemoCount: nodemo.length,
    collisions,
  };
}

function main(argv = process.argv.slice(2)) {
  const sourcePath = argv[0] || process.env.ARKHELPER_ITEMS_JSONL || DEFAULT_SOURCE;
  const outPath = argv[1] || DEFAULT_OUT;
  const result = buildFromFile(sourcePath, outPath);
  process.stdout.write(
    `wrote ${result.structureCount} structures, ${result.nodemoCount} nodemo resources -> ${result.outPath}\n`
  );
  process.stdout.write(
    result.deleted.length
      ? `removed superseded: ${result.deleted.join(', ')}\n`
      : 'removed superseded: (none)\n'
  );
}

if (require.main === module) {
  main();
}

module.exports = { DEFAULT_SOURCE, DEFAULT_OUT, buildFromFile, main };
