#!/usr/bin/env node
'use strict';

/**
 * build_crafting_costs.js
 *
 * Build-time step: read phase1/items_full.jsonl, phase1/items_yield2.jsonl,
 * and phase1/Engrams.json and write the content-hashed crafting-cost
 * JSON asset plus manifest. Runtime never opens the JSONL or Engrams file.
 */

const fs = require('node:fs');
const {
  parseItemsJsonl,
  buildDataset,
  collectEngramClassSet,
  assertCalculatorRuleCounts,
  assertNoDuplicateDnames,
  assertOverridesPresent,
} = require('./crafting_cost.js');
const {
  DEFAULT_DATA_DIR,
  publishStaticAsset,
  resolveDataDir,
} = require('./static_data.js');

const DEFAULT_SOURCE_FULL = 'C:\\arkhelper_extract\\phase1\\items_full.jsonl';
const DEFAULT_SOURCE_YIELD = 'C:\\arkhelper_extract\\phase1\\items_yield2.jsonl';
const DEFAULT_SOURCE_ENGRAMS = 'C:\\arkhelper_extract\\phase1\\Engrams.json';
const DEFAULT_OUT = DEFAULT_DATA_DIR;
const LOGICAL_NAME = 'crafting-costs';

function buildFromFiles(fullPath, yieldPath, engramPath, outPath) {
  const fullItems = parseItemsJsonl(fs.readFileSync(fullPath, 'utf8'));
  const yieldItems = parseItemsJsonl(fs.readFileSync(yieldPath, 'utf8'));
  const engrams = JSON.parse(fs.readFileSync(engramPath, 'utf8'));
  assertCalculatorRuleCounts(fullItems, collectEngramClassSet(engrams));
  const dataset = buildDataset(fullItems, yieldItems, engrams);
  if (dataset.missingLabels.length) {
    throw new Error(`missing display names: ${dataset.missingLabels.join(', ')}`);
  }
  assertOverridesPresent(dataset.items);
  assertNoDuplicateDnames(dataset.items);
  const asset = {
    stations: dataset.stations,
    unresolved: dataset.unresolved,
    labels: dataset.labels,
    items: dataset.items,
  };
  const outDir = resolveDataDir(outPath, DEFAULT_DATA_DIR);
  const published = publishStaticAsset({
    dir: outDir,
    logicalName: LOGICAL_NAME,
    content: Buffer.from(`${JSON.stringify(asset)}\n`),
  });
  return {
    fullPath,
    yieldPath,
    engramPath,
    outPath: published.filePath,
    filename: published.filename,
    deleted: published.deleted,
    itemCount: dataset.items.length,
    wrapperCount: dataset.excludedWrappers.length,
    unresolvedCount: dataset.unresolved.length,
    ruleKeepCount: dataset.ruleKeepCount,
    ruleExcludeCount: dataset.ruleExcludeCount,
    missingLabels: dataset.missingLabels,
    staleOverrides: dataset.staleOverrides,
    duplicateDnames: dataset.duplicateDnames,
    collisions: dataset.collisions,
    excludedWrappers: dataset.excludedWrappers,
  };
}

function formatDuplicateDnames(collisions) {
  return (collisions || [])
    .map((row) => `${JSON.stringify(row.dname)}: ${row.names.join(', ')}`)
    .join('\n');
}

function main(argv = process.argv.slice(2)) {
  const fullPath = argv[0] || process.env.ARKHELPER_ITEMS_JSONL || DEFAULT_SOURCE_FULL;
  const yieldPath = argv[1] || process.env.ARKHELPER_ITEMS_YIELD_JSONL || DEFAULT_SOURCE_YIELD;
  const engramPath = argv[2] || process.env.ARKHELPER_ENGRAMS_JSON || DEFAULT_SOURCE_ENGRAMS;
  const outPath = argv[3] || DEFAULT_OUT;
  const result = buildFromFiles(fullPath, yieldPath, engramPath, outPath);
  process.stdout.write(
    `wrote ${result.itemCount} items (rule KEEP ${result.ruleKeepCount} / EXCLUDED ${result.ruleExcludeCount}), ` +
      `${result.wrapperCount} excluded wrappers -> ${result.outPath}\n`
  );
  process.stdout.write(
    result.deleted.length
      ? `removed superseded: ${result.deleted.join(', ')}\n`
      : 'removed superseded: (none)\n'
  );
  if (result.duplicateDnames.length) {
    process.stdout.write(
      `duplicate dnames among rule-kept items (${result.duplicateDnames.length} groups):\n` +
        `${formatDuplicateDnames(result.duplicateDnames)}\n`
    );
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_SOURCE_FULL,
  DEFAULT_SOURCE_YIELD,
  DEFAULT_SOURCE_ENGRAMS,
  DEFAULT_OUT,
  buildFromFiles,
  formatDuplicateDnames,
  main,
};
