'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const generated = require('./data/crafting_costs.json');
const {
  STATIONS,
  EXPECTED_KEEP_COUNT,
  EXPECTED_EXCLUDE_COUNT,
  DISPLAY_NAME_OVERRIDES,
  extraItemName,
  extraResolvesToKnownOutput,
  isMulticraftFamily,
  isInScope,
  isKeptByCalculatorRule,
  collectEngramClassSet,
  assertCalculatorRuleCounts,
  buildDisplayNameMap,
  collectReferencedClasses,
  findDuplicateDnames,
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
    { name: 'ok', result: 'OK', pkg: '/Game/x/Resources/ok', dname: 'Ok', reqs: [{ qty: 1, res: 'Stone_C' }] },
    { name: 'bad-full', result: 'NULL', pkg: '/Game/x/Resources/bad-full', dname: 'Bad', reqs: [{ qty: 1, res: 'Stone_C' }] },
  ];
  const yields = [
    { name: 'ok', result: 'OK', qty_made: 1, extra: [], stations: [] },
    { name: 'bad-full', result: 'OK', qty_made: 1, extra: [], stations: [] },
    { name: 'bad-yield', result: 'NOLOAD', qty_made: 1, extra: [], stations: [] },
  ];
  const fullWithBadYield = [
    ...full,
    { name: 'bad-yield', result: 'OK', pkg: '/Game/x/Resources/bad-yield', dname: 'BadYield', reqs: [{ qty: 1, res: 'Stone_C' }] },
  ];
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

function hatchetEngrams() {
  return collectEngramClassSet({
    '/Game/Engrams/EngramEntry_MetalHatchet': {
      props: {
        blue_print_entry: {
          __ref: '/Game/PrimalEarth/CoreBlueprints/Weapons/PrimalItem_WeaponMetalHatchet.PrimalItem_WeaponMetalHatchet_C',
        },
      },
    },
    '/Game/Engrams/EngramEntry_Costume': {
      props: {
        blue_print_entry: {
          __ref: '/Game/ASA/Dinos/ShoulderDragon/PrimalItemCostume_ShoulderDragonLost.PrimalItemCostume_ShoulderDragonLost_C',
        },
      },
    },
  });
}

test('keep-rule excludes Admin Blink Rifle (reqs>0, not in scope)', () => {
  assert.equal(
    isKeptByCalculatorRule(
      {
        name: 'PrimalItem_WeaponAdminBlinkRifle',
        dname: 'Admin Blink Rifle',
        pkg: '/Game/Extinction/Weapon_AdminBlinkRifle/PrimalItem_WeaponAdminBlinkRifle',
        reqs: [{ qty: 10, res: 'PrimalItemResource_Hide_C' }],
      },
      hatchetEngrams()
    ),
    false
  );
});

test('keep-rule excludes legacy egg kibble (reqs=0)', () => {
  assert.equal(
    isKeptByCalculatorRule(
      {
        name: 'PrimalItemConsumable_Kibble_DodoEgg',
        dname: 'Kibble (Dodo Egg)',
        pkg: '/Game/PrimalEarth/CoreBlueprints/Items/Consumables/PrimalItemConsumable_Kibble_DodoEgg',
        reqs: [],
      },
      hatchetEngrams()
    ),
    false
  );
});

test('keep-rule keeps tiered kibble Kibble_Base_Small (reqs>0, rescued from junk)', () => {
  assert.equal(
    isKeptByCalculatorRule(
      {
        name: 'PrimalItemConsumable_Kibble_Base_Small',
        dname: 'Simple Kibble',
        pkg: '/Game/PrimalEarth/CoreBlueprints/Items/Consumables/PrimalItemConsumable_Kibble_Base_Small',
        reqs: [{ qty: 1, res: 'PrimalItemConsumableEatable_WaterContainer_C' }],
      },
      hatchetEngrams()
    ),
    true
  );
});

test('keep-rule excludes costume (engram-linked, reqs=0)', () => {
  assert.equal(
    isKeptByCalculatorRule(
      {
        name: 'PrimalItemCostume_ShoulderDragonLost',
        dname: 'Lost Drakeling Costume',
        pkg: '/Game/ASA/Dinos/ShoulderDragon/Variants/Lost/PrimalItemCostume_ShoulderDragonLost',
        reqs: [],
      },
      hatchetEngrams()
    ),
    false
  );
});

test('keep-rule excludes RecipeNote (reqs>0, name match)', () => {
  assert.equal(
    isKeptByCalculatorRule(
      {
        name: 'PrimalItem_RecipeNote_StaminaSoup',
        dname: 'Rockwell Recipes: Energy Brew',
        pkg: '/Game/PrimalEarth/CoreBlueprints/Items/Notes/PrimalItem_RecipeNote_StaminaSoup',
        reqs: [{ qty: 3, res: 'PrimalItemResource_Thatch_C' }],
      },
      collectEngramClassSet({
        e: {
          props: {
            blue_print_entry: {
              __ref: '/Game/Notes/PrimalItem_RecipeNote_StaminaSoup.PrimalItem_RecipeNote_StaminaSoup_C',
            },
          },
        },
      })
    ),
    false
  );
});

test('keep-rule excludes CustomFoodRecipe with custom but empty reqs', () => {
  assert.equal(
    isKeptByCalculatorRule(
      {
        name: 'PrimalItemCustomFoodRecipe_Type_BdayCake',
        dname: 'A Food Recipe',
        pkg: '/Game/PrimalEarth/CoreBlueprints/Items/Consumables/PrimalItemCustomFoodRecipe_Type_BdayCake',
        reqs: [],
        custom: [{ qty: 3, res: 'PrimalItemConsumable_SweetVeggieCake_C' }],
      },
      hatchetEngrams()
    ),
    false
  );
});

test('keep-rule keeps Flint (reqs>0, Resources folder)', () => {
  assert.equal(
    isKeptByCalculatorRule(
      {
        name: 'PrimalItemResource_Flint',
        dname: 'Flint',
        pkg: '/Game/PrimalEarth/CoreBlueprints/Resources/PrimalItemResource_Flint',
        reqs: [{ qty: 2, res: 'PrimalItemResource_Stone_C' }],
      },
      new Set()
    ),
    true
  );
});

test('keep-rule keeps Metal Hatchet base (engram-linked, reqs>0)', () => {
  assert.equal(
    isKeptByCalculatorRule(
      {
        name: 'PrimalItem_WeaponMetalHatchet',
        dname: 'Metal Hatchet',
        pkg: '/Game/PrimalEarth/CoreBlueprints/Weapons/PrimalItem_WeaponMetalHatchet',
        reqs: [{ qty: 8, res: 'PrimalItemResource_MetalIngot_C' }],
      },
      hatchetEngrams()
    ),
    true
  );
});

test('keep-rule excludes Gauntlet Metal Hatchet (reqs>0, Mission folder, no engram)', () => {
  assert.equal(
    isKeptByCalculatorRule(
      {
        name: 'PrimalItem_WeaponMetalHatchet_Gauntlet',
        dname: 'Metal Hatchet',
        pkg: '/Game/Genesis/CoreBlueprints/Weapons/Mission/PrimalItem_WeaponMetalHatchet_Gauntlet',
        reqs: [{ qty: 8, res: 'PrimalItemResource_MetalIngot_C' }],
      },
      hatchetEngrams()
    ),
    false
  );
});

test('keep-rule count tripwire is 711 kept and 2686 excluded', () => {
  assert.equal(EXPECTED_KEEP_COUNT, 711);
  assert.equal(EXPECTED_EXCLUDE_COUNT, 2686);
  assert.throws(
    () => assertCalculatorRuleCounts([], new Set()),
    /KEEP 0 EXCLUDED 0/
  );
});

test('keep-rule excludes CustomDrinkRecipe placeholder', () => {
  assert.equal(
    isKeptByCalculatorRule(
      {
        name: 'PrimalItemCustomDrinkRecipe_Type1',
        dname: 'A Food Recipe',
        pkg: '/Game/PrimalEarth/CoreBlueprints/Items/Consumables/PrimalItemCustomDrinkRecipe_Type1',
        reqs: [{ qty: 1, res: 'PrimalItemResource_Thatch_C' }],
      },
      new Set()
    ),
    false
  );
});

test('keep-rule excludes Refill as an entry but still resolves it as an ingredient label', () => {
  assert.equal(
    isKeptByCalculatorRule(
      {
        name: 'PrimalItemConsumable_WaterJarRefill',
        dname: 'Water Jar',
        pkg: '/Game/PrimalEarth/CoreBlueprints/Items/Consumables/PrimalItemConsumable_WaterJarRefill',
        reqs: [{ qty: 1, res: 'PrimalItemResource_Fibers_C' }],
      },
      new Set()
    ),
    false
  );
  const beer = {
    name: 'PrimalItemConsumable_BeerJarAlt',
    dname: 'Beer Jar',
    pkg: '/Game/PrimalEarth/CoreBlueprints/Items/Consumables/Beer',
    result: 'OK',
    reqs: [{ qty: 1, res: 'PrimalItemConsumable_WaterJarRefill_C' }],
  };
  const refill = {
    name: 'PrimalItemConsumable_WaterJarRefill',
    dname: 'Water Jar',
    pkg: '/Game/PrimalEarth/CoreBlueprints/Items/Consumables/Refill',
    reqs: [],
  };
  const { labels, missing } = buildDisplayNameMap([beer, refill], collectReferencedClasses([beer]));
  assert.deepEqual(missing, []);
  assert.equal(labels.PrimalItemConsumable_WaterJarRefill_C, 'Water Jar');
});

test('keep-rule excludes Crafted_ taffy and keeps Craftable_ taffy', () => {
  const crafted = {
    name: 'PrimalItemConsumable_Crafted_FourthOfJulyDinoCandy',
    dname: 'Summer Swirl Taffy',
    pkg: '/Game/PrimalEarth/CoreBlueprints/Items/Consumables/Crafted',
    reqs: [{ qty: 1, res: 'PrimalItemResource_Polymer_C' }],
  };
  const craftable = {
    name: 'PrimalItemConsumable_Craftable_FourthOfJulyDinoCandy',
    dname: 'Summer Swirl Taffy',
    pkg: '/Game/PrimalEarth/CoreBlueprints/Items/Consumables/Craftable',
    reqs: [{ qty: 1, res: 'PrimalItemResource_Polymer_C' }],
  };
  assert.equal(isKeptByCalculatorRule(crafted, new Set()), false);
  assert.equal(isKeptByCalculatorRule(craftable, new Set()), true);
});

test('display-name override renders the verbatim §2 name on the kept item', () => {
  const beer = {
    name: 'PrimalItemConsumable_BeerJar',
    dname: 'Beer Jar',
    pkg: '/Game/PrimalEarth/CoreBlueprints/Items/Consumables/Beer',
    result: 'OK',
    reqs: [{ qty: 1, res: 'PrimalItemResource_Beer_C' }],
  };
  const beerRes = { name: 'PrimalItemResource_Beer', dname: 'Beer', reqs: [] };
  const yields = [{ name: beer.name, result: 'OK', qty_made: 1, extra: [], stations: [] }];
  const dataset = buildDataset([beer, beerRes], yields);
  assert.equal(dataset.items.length, 1);
  assert.equal(dataset.items[0].dname, 'Beer Jar (from crafted Water Jar)');
  assert.equal(dataset.items[0].label, 'Beer Jar (from crafted Water Jar)');
  assert.equal(DISPLAY_NAME_OVERRIDES.PrimalItemConsumable_BeerJar, 'Beer Jar (from crafted Water Jar)');
});

test('display-name map resolves name+_C to dname and lists missing without inventing', () => {
  const items = [
    { name: 'PrimalItemResource_Hide', dname: 'Hide' },
    { name: 'PrimalItemResource_Empty', dname: '' },
  ];
  const referenced = ['PrimalItemResource_Hide_C', 'PrimalItemResource_Empty_C', 'Unknown_C'];
  const { labels, missing } = buildDisplayNameMap(items, referenced);
  assert.deepEqual(labels, { PrimalItemResource_Hide_C: 'Hide' });
  assert.deepEqual(missing, ['PrimalItemResource_Empty_C', 'Unknown_C']);
});

test('display-name map collects reqs and custom refs from kept items', () => {
  const refs = collectReferencedClasses([
    {
      reqs: [{ res: 'PrimalItemResource_Hide_C' }],
      custom: [{ res: 'PrimalItemConsumable_Honey_C' }],
    },
  ]);
  assert.deepEqual([...refs].sort(), ['PrimalItemConsumable_Honey_C', 'PrimalItemResource_Hide_C']);
});

test('every generated req has a non-empty label from the display-name map', () => {
  assert.ok(generated.labels && typeof generated.labels === 'object');
  for (const entry of generated.items) {
    for (const req of entry.reqs) {
      assert.equal(typeof req.label, 'string');
      assert.ok(req.label, `${entry.name} ${req.res}`);
      assert.equal(generated.labels[req.res], req.label, `${entry.name} ${req.res}`);
    }
  }
});

test('duplicate dname detector reports colliding pairs without renaming dnames', () => {
  const items = [
    { name: 'PrimalItem_WeaponMetalHatchet', dname: 'Metal Hatchet' },
    { name: 'PrimalItem_WeaponMetalHatchet_Gauntlet', dname: 'Metal Hatchet' },
    { name: 'PrimalItemResource_Flint', dname: 'Flint' },
  ];
  assert.deepEqual(findDuplicateDnames(items), [
    { dname: 'Metal Hatchet', names: ['PrimalItem_WeaponMetalHatchet', 'PrimalItem_WeaponMetalHatchet_Gauntlet'] },
  ]);
  assert.deepEqual(items.map((item) => item.dname), ['Metal Hatchet', 'Metal Hatchet', 'Flint']);
});

test('generated dataset excludes Admin Blink Rifle, RecipeNotes, and Gauntlet hatchet', () => {
  assert.equal(findItem(generated, 'PrimalItem_WeaponAdminBlinkRifle'), null);
  assert.equal(findItem(generated, 'PrimalItem_RecipeNote_StaminaSoup'), null);
  assert.equal(findItem(generated, 'PrimalItem_WeaponMetalHatchet_Gauntlet'), null);
  assert.ok(findItem(generated, 'PrimalItem_WeaponMetalHatchet'));
  assert.ok(findItem(generated, 'PrimalItemResource_Flint'));
  assert.ok(findItem(generated, 'PrimalItemConsumable_Kibble_Base_Small'));
});

test('generated dataset excludes drink placeholders, Refill entries, and Crafted_ taffy', () => {
  assert.equal(findItem(generated, 'PrimalItemCustomDrinkRecipe_Type1'), null);
  assert.equal(findItem(generated, 'PrimalItemCustomDrinkRecipe_Type2'), null);
  assert.equal(findItem(generated, 'PrimalItemConsumable_WaterJarRefill'), null);
  assert.equal(findItem(generated, 'PrimalItemConsumable_Crafted_FourthOfJulyDinoCandy'), null);
  assert.ok(findItem(generated, 'PrimalItemConsumable_Craftable_FourthOfJulyDinoCandy'));
  const beer = findItem(generated, 'PrimalItemConsumable_BeerJarAlt');
  assert.ok(beer);
  const refillReq = beer.reqs.find((req) => req.res === 'PrimalItemConsumable_WaterJarRefill_C');
  assert.ok(refillReq);
  assert.equal(refillReq.label, 'Water Jar');
});

test('final dataset has zero dname collisions after overrides', () => {
  assert.deepEqual(findDuplicateDnames(generated.items), []);
  assert.equal(findItem(generated, 'PrimalItemResource_ElementDustFromElement').dname, 'Crafted Element Dust (from Element)');
});

