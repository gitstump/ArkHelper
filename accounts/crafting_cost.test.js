'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const generated = require('./data/crafting_costs.json');
const {
  STATIONS,
  extraItemName,
  extraResolvesToKnownOutput,
  isMulticraftFamily,
  isInScope,
  findItem,
  computeCraft,
  stationById,
  craftTotalsFor,
  buildDataset,
} = require('./crafting_cost.js');

function amountsByLabel(parts) {
  const out = {};
  for (const part of parts) out[part.label] = part.qty;
  return out;
}

function itemCost(name, count, stationId) {
  const item = findItem(generated, name);
  assert.ok(item, `missing item ${name}`);
  return computeCraft(item, count, stationById(stationId));
}

test('Sparkpowder x2 in a Mortar and Pestle is one craft of the data recipe', () => {
  const item = findItem(generated, 'PrimalItemResource_Sparkpowder');
  assert.ok(item);
  assert.equal(item.qty_made, 2);
  const cost = itemCost('PrimalItemResource_Sparkpowder', 2, 'mortar_and_pestle');
  assert.equal(cost.crafts, 1);
  assert.equal(cost.produced, 2);
  assert.equal(cost.overflow, 0);
  const amt = amountsByLabel(cost.materials);
  const expected = {};
  for (const req of item.reqs) expected[req.label] = req.qty;
  assert.deepEqual(amt, expected);
  assert.equal(amt.Stone, 1);
  assert.equal(amt.Flint, 2);
});

test('Sparkpowder x5 needs 3 crafts, produces 6, overflow of 1', () => {
  const cost = itemCost('PrimalItemResource_Sparkpowder', 5, 'mortar_and_pestle');
  assert.equal(cost.crafts, 3);
  assert.equal(cost.produced, 6);
  assert.equal(cost.overflow, 1);
});

test('Metal Ingot x10 is 10 crafts and Metal 20', () => {
  const cost = itemCost('PrimalItemResource_MetalIngot', 10, 'refining_forge');
  assert.equal(cost.crafts, 10);
  assert.equal(cost.produced, 10);
  assert.equal(amountsByLabel(cost.materials).Metal, 20);
});

test('Cementing Paste x1 in a Mortar and Pestle is Chitin/Keratin 4, Stone 8', () => {
  const cost = itemCost('PrimalItemResource_ChitinPaste', 1, 'mortar_and_pestle');
  assert.equal(cost.crafts, 1);
  const amt = amountsByLabel(cost.materials);
  assert.equal(amt['Chitin/Keratin'], 4);
  assert.equal(amt.Stone, 8);
});

test('Cementing Paste x6 in a Chemistry Bench is 1 craft, Chitin/Keratin 16, Stone 32', () => {
  const cost = itemCost('PrimalItemResource_ChitinPaste', 6, 'chemistry_bench');
  assert.equal(cost.crafts, 1);
  assert.equal(cost.produced, 6);
  const amt = amountsByLabel(cost.materials);
  assert.equal(amt['Chitin/Keratin'], 16);
  assert.equal(amt.Stone, 32);
});

test('Cementing Paste x600 is cheaper at the Chemistry Bench', () => {
  const mortar = amountsByLabel(itemCost('PrimalItemResource_ChitinPaste', 600, 'mortar_and_pestle').materials);
  const bench = amountsByLabel(itemCost('PrimalItemResource_ChitinPaste', 600, 'chemistry_bench').materials);
  assert.equal(mortar['Chitin/Keratin'], 2400);
  assert.equal(mortar.Stone, 4800);
  assert.equal(bench['Chitin/Keratin'], 1600);
  assert.equal(bench.Stone, 3200);
});

test('no generated item has a non-empty extra containing its own output', () => {
  const names = new Set(generated.items.map((item) => item.name));
  for (const entry of generated.items) {
    if (!Array.isArray(entry.extra) || entry.extra.length === 0) continue;
    assert.equal(
      extraResolvesToKnownOutput(entry.extra, names),
      false,
      entry.name
    );
  }
});

test('no MulticraftItem_ entry is present', () => {
  for (const entry of generated.items) {
    assert.equal(isMulticraftFamily(entry.name), false, entry.name);
  }
});

test('PrimalItemResource_MetalIngot_FromMegaForge is absent', () => {
  assert.equal(findItem(generated, 'PrimalItemResource_MetalIngot_FromMegaForge'), null);
});

test('every generated entry has qty_made >= 1 and a non-empty reqs', () => {
  for (const entry of generated.items) {
    assert.ok(Number(entry.qty_made) >= 1, entry.name);
    assert.ok(Array.isArray(entry.reqs) && entry.reqs.length > 0, entry.name);
  }
});

test('no generated entry has result != OK in either source file', () => {
  const full = [
    { name: 'ok', result: 'OK', reqs: [{ qty: 1, res: 'Stone' }] },
    { name: 'bad-full', result: 'NULL', reqs: [{ qty: 1, res: 'Stone' }] },
  ];
  const yields = [
    { name: 'ok', result: 'OK', qty_made: 1, extra: [], stations: [] },
    { name: 'bad-full', result: 'OK', qty_made: 1, extra: [], stations: [] },
    { name: 'bad-yield', result: 'NOLOAD', qty_made: 1, extra: [], stations: [] },
  ];
  const fullWithBadYield = [...full, { name: 'bad-yield', result: 'OK', reqs: [{ qty: 1, res: 'Stone' }] }];
  const names = new Set(['ok', 'bad-full', 'bad-yield', 'Stone']);
  assert.equal(isInScope(full[0], yields[0], names), true);
  assert.equal(isInScope(full[1], yields[1], names), false);
  assert.equal(isInScope(fullWithBadYield[2], yields[2], names), false);
  const dataset = buildDataset(fullWithBadYield, yields);
  assert.deepEqual(dataset.items.map((item) => item.name), ['ok']);
  for (const entry of generated.items) {
    if ('result' in entry) assert.equal(entry.result, 'OK', entry.name);
    if ('result_full' in entry) assert.equal(entry.result_full, 'OK', entry.name);
    if ('result_yield' in entry) assert.equal(entry.result_yield, 'OK', entry.name);
  }
});

test('every referenced resource in the generated dataset resolves to a known item name', () => {
  assert.deepEqual(generated.unresolved, []);
  for (const entry of generated.items) {
    for (const req of entry.reqs) {
      assert.equal(req.resolved, true, `${entry.name} ${req.res}`);
      assert.equal(typeof req.label, 'string');
      assert.ok(req.label, `${entry.name} ${req.res}`);
    }
  }
});

test('the station multiplier table matches the verified inventory CDO values', () => {
  assert.deepEqual(STATIONS, [
    { id: 'mortar_and_pestle', label: 'Mortar and Pestle', quantity_multiplier: 1, requirements_multiplier: 1 },
    { id: 'chemistry_bench', label: 'Chemistry Bench', quantity_multiplier: 6, requirements_multiplier: 4 },
    { id: 'cooking_pot', label: 'Cooking Pot', quantity_multiplier: 1, requirements_multiplier: 1 },
    { id: 'industrial_cooker', label: 'Industrial Cooker', quantity_multiplier: 1, requirements_multiplier: 1 },
    { id: 'refining_forge', label: 'Refining Forge', quantity_multiplier: 1, requirements_multiplier: 1 },
    { id: 'industrial_forge', label: 'Industrial Forge', quantity_multiplier: 1, requirements_multiplier: 1 },
  ]);
  assert.deepEqual(generated.stations, STATIONS);
});

test('no generated item carries its own crafting multiplier override', () => {
  for (const entry of generated.items) {
    assert.equal(entry.quantity_multiplier, undefined, entry.name);
    assert.equal(entry.requirements_multiplier, undefined, entry.name);
  }
});

test('two rows of different items sum per-resource, carrying unique resources through', () => {
  const totals = amountsByLabel(
    craftTotalsFor(generated, [
      { name: 'PrimalItemResource_Sparkpowder', count: 2 },
      { name: 'PrimalItemResource_MetalIngot', count: 10 },
    ]).default
  );
  assert.equal(totals.Flint, 2);
  assert.equal(totals.Stone, 1);
  assert.equal(totals.Metal, 20);
});

test('extra path resolution reads the trailing class name', () => {
  assert.equal(
    extraItemName('/Game/PrimalEarth/CoreBlueprints/Resources/PrimalItemResource_MetalIngot.PrimalItemResource_MetalIngot_C'),
    'PrimalItemResource_MetalIngot'
  );
});
