'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const generated = require('./data/demolish_refunds.json');
const { findStructure, refundTotalsFor, perUnitRefund, scaleRefunds, sumRows } = require('./demolish_refund.js');

function amountsById(parts) {
  const out = {};
  for (const part of parts) out[part.id] = part.total;
  return out;
}

function structureTotals(name, count) {
  const structure = findStructure(generated, name);
  assert.ok(structure, `missing structure ${name}`);
  return amountsById(scaleRefunds(structure.refunds, count));
}

test('Thatch Wall & Doorway x1 refunds Thatch 5, Wood 1, Fibers 3', () => {
  assert.deepEqual(structureTotals('PrimalItemStructure_ThatchWall', 1), {
    Thatch: 5,
    Wood: 1,
    Fibers: 3,
  });
});

test('Thatch Wall & Doorway x2 floors per structure then multiplies (Fibers 6, not 7)', () => {
  assert.deepEqual(structureTotals('PrimalItemStructure_ThatchWall', 2), {
    Thatch: 10,
    Wood: 2,
    Fibers: 6,
  });
  assert.notEqual(structureTotals('PrimalItemStructure_ThatchWall', 2).Fibers, 7);
});

test('Thatch Wall & Doorway x1000 refunds Thatch 5000, Wood 1000, Fibers 3000', () => {
  assert.deepEqual(structureTotals('PrimalItemStructure_ThatchWall', 1000), {
    Thatch: 5000,
    Wood: 1000,
    Fibers: 3000,
  });
});

test('Campfire x1 refunds Thatch 6, Stone 8, Wood 1, Flint 0', () => {
  assert.deepEqual(structureTotals('PrimalItemStructure_Campfire', 1), {
    Thatch: 6,
    Flint: 0,
    Stone: 8,
    Wood: 1,
  });
});

test('Stone Wall, Doorways & Windowframe x1 refunds Stone 20, Wood 10, Thatch 7', () => {
  assert.deepEqual(structureTotals('PrimalItemStructure_StoneWall', 1), {
    Stone: 20,
    Wood: 10,
    Thatch: 7,
  });
});

test('Tek Roof, Ramp & Stairs x1 returns Element 0', () => {
  const totals = structureTotals('PrimalItemStructure_Ramp_Tek', 1);
  assert.equal(totals.MetalIngot, 35);
  assert.equal(totals.Polymer, 10);
  assert.equal(totals.Crystal, 10);
  assert.equal(totals.Element, 0);
});

test('Tek Fence Foundation & Support x1 floors MetalIngot 2.5 to 2 and ElementShard 0', () => {
  const totals = structureTotals('PrimalItemStructure_TekFenceFoundation', 1);
  assert.equal(totals.MetalIngot, 2);
  assert.equal(totals.ChitinPaste, 1);
  assert.equal(totals.ElementShard, 0);
});

test('generated dataset has no Skin in any name', () => {
  for (const entry of generated.structures) {
    assert.equal(String(entry.name).includes('Skin'), false, entry.name);
  }
});

test('generated dataset has no justdestroy == true entry', () => {
  for (const entry of generated.structures) {
    assert.notEqual(entry.justdestroy, true, entry.name);
  }
});

test('generated dataset has no demo_pct == 0 entry', () => {
  for (const entry of generated.structures) {
    assert.notEqual(entry.demo_pct, 0, entry.name);
  }
});

test('every generated entry has a non-empty reqs', () => {
  for (const entry of generated.structures) {
    assert.ok(Array.isArray(entry.reqs) && entry.reqs.length > 0, entry.name);
  }
});

test('Underwater Mine is absent from the generated dataset', () => {
  assert.equal(findStructure(generated, 'PrimalItemStructure_SeaMine'), null);
  assert.equal(
    generated.structures.some((s) => s.dname === 'Underwater Mine'),
    false
  );
});

test('no PrimalItemStructure_Base* Club ARK entry is present', () => {
  for (const entry of generated.structures) {
    assert.equal(/^PrimalItemStructure_Base/.test(entry.name), false, entry.name);
  }
});

test('no generated reqs entry has a null or missing res', () => {
  for (const entry of generated.structures) {
    for (const req of entry.reqs) {
      assert.equal(typeof req.res, 'string', entry.name);
      assert.ok(req.res, entry.name);
    }
  }
});

test('every generated refund equals floor(qty * demo_pct)', () => {
  for (const entry of generated.structures) {
    for (const part of entry.refunds) {
      const expected = part.nodemo ? 0 : Math.floor(part.qty * entry.demo_pct);
      assert.equal(part.refund, expected, `${entry.name} ${part.res}`);
    }
  }
});

test('Tek Trough x1 refunds Black Pearl 22', () => {
  assert.equal(structureTotals('PrimalItemStructure_TekTrough', 1).BlackPearl, 22);
});

test('Tek Trough x2 refunds Black Pearl 44', () => {
  assert.equal(structureTotals('PrimalItemStructure_TekTrough', 2).BlackPearl, 44);
});

test('every in-scope entry demo_pct is exactly 0.5', () => {
  for (const entry of generated.structures) {
    assert.equal(entry.demo_pct, 0.5, entry.name);
  }
});

test('nodemo set is non-empty and contains PrimalItemResource_Element', () => {
  assert.ok(Array.isArray(generated.nodemo) && generated.nodemo.length > 0);
  assert.ok(generated.nodemo.includes('PrimalItemResource_Element'));
});

test('two different structures sum per-resource, carrying unique resources through', () => {
  const totals = amountsById(
    refundTotalsFor(generated, [
      { name: 'PrimalItemStructure_ThatchWall', count: 1 },
      { name: 'PrimalItemStructure_Campfire', count: 1 },
    ])
  );
  assert.equal(totals.Thatch, 11);
  assert.equal(totals.Wood, 2);
  assert.equal(totals.Fibers, 3);
  assert.equal(totals.Stone, 8);
  assert.equal(totals.Flint, 0);
});

test('perUnitRefund floors after the percent and zeros nodemo', () => {
  assert.equal(perUnitRefund(7, 0.5, false), 3);
  assert.equal(perUnitRefund(1, 0.5, false), 0);
  assert.equal(perUnitRefund(50, 0.5, true), 0);
});

test('sumRows carries a resource that appears in only one row', () => {
  const totals = amountsById(
    sumRows([
      { count: 2, refunds: [{ id: 'Wood', refund: 1, nodemo: false }] },
      { count: 1, refunds: [{ id: 'Stone', refund: 8, nodemo: false }, { id: 'Wood', refund: 1, nodemo: false }] },
    ])
  );
  assert.equal(totals.Wood, 3);
  assert.equal(totals.Stone, 8);
});
