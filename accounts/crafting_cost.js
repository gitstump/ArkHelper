#!/usr/bin/env node
'use strict';

/**
 * crafting_cost.js
 *
 * Pure filter / math / dataset builder for the crafting-cost
 * calculator. Reads extracted item + yield + Engrams records; does
 * not touch the network or the filesystem. The generated JSON is
 * produced by build_crafting_costs.js and served as a static asset.
 */

const STATIONS = [
  { id: 'mortar_and_pestle', label: 'Mortar and Pestle', quantity_multiplier: 1, requirements_multiplier: 1 },
  { id: 'chemistry_bench', label: 'Chemistry Bench', quantity_multiplier: 6, requirements_multiplier: 4 },
  { id: 'cooking_pot', label: 'Cooking Pot', quantity_multiplier: 1, requirements_multiplier: 1 },
  { id: 'industrial_cooker', label: 'Industrial Cooker', quantity_multiplier: 1, requirements_multiplier: 1 },
  { id: 'refining_forge', label: 'Refining Forge', quantity_multiplier: 1, requirements_multiplier: 1 },
  { id: 'industrial_forge', label: 'Industrial Forge', quantity_multiplier: 1, requirements_multiplier: 1 },
];

function parseItemsJsonl(text) {
  const items = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    items.push(JSON.parse(line));
  }
  return items;
}

function stripClassSuffix(res) {
  if (typeof res !== 'string') return '';
  return res.endsWith('_C') ? res.slice(0, -2) : res;
}

function extraItemName(path) {
  if (typeof path !== 'string' || !path) return '';
  const last = path.split('/').pop() || '';
  const cls = last.includes('.') ? last.slice(last.lastIndexOf('.') + 1) : last;
  return stripClassSuffix(cls);
}

function extraResolvesToKnownOutput(extra, nameIndex) {
  if (!Array.isArray(extra) || extra.length === 0) return false;
  return extra.some((path) => {
    const name = extraItemName(path);
    return name && nameIndex.has(name) && !EXCLUDED_EXACT_CLASSES.has(name);
  });
}

const EXPECTED_KEEP_COUNT = 711;
const EXPECTED_EXCLUDE_COUNT = 2686;
const KIBBLE_BASE_RESCUE_PREFIX = 'PrimalItemConsumable_Kibble_Base_';

// Byte-identical recipe to PrimalItemConsumable_Craftable_FourthOfJulyDinoCandy;
// a duplicate, not an alternate. Keep the Craftable_ class.
const EXCLUDED_EXACT_CLASSES = new Set([
  'PrimalItemConsumable_Crafted_FourthOfJulyDinoCandy',
]);

const DISPLAY_NAME_OVERRIDES = {
  PrimalItemResource_ElementDustFromShards: 'Crafted Element Dust (from Element Shards)',
  PrimalItemResource_ElementDustFromElement: 'Crafted Element Dust (from Element)',
  PrimalItemResource_ElementPowerNode: 'Element (from Power Node)',
  PrimalItemStructure_PokerTableSH: 'Saloon Table (Poker)',
  PrimalItemConsumable_BeerJarAlt: 'Beer Jar (from filled Water Jar)',
  PrimalItemConsumable_BeerJar: 'Beer Jar (from crafted Water Jar)',
};

function isMulticraftFamily(name) {
  return String(name || '').includes('MulticraftItem_');
}

function collectEngramClassSet(engrams) {
  const set = new Set();
  if (!engrams) return set;
  const entries = Array.isArray(engrams) ? engrams : Object.values(engrams);
  for (const entry of entries) {
    const ref = entry && entry.props && entry.props.blue_print_entry && entry.props.blue_print_entry.__ref;
    if (typeof ref !== 'string' || !ref) continue;
    const cls = ref.slice(ref.lastIndexOf('.') + 1);
    if (cls) set.add(cls);
  }
  return set;
}

function hasRecipe(item) {
  return !!(item && Array.isArray(item.reqs) && item.reqs.length > 0);
}

function isInCalculatorScope(item, engramSet) {
  if (!item || typeof item !== 'object') return false;
  const pkg = String(item.pkg || '');
  if (pkg.includes('/Consumables/') || pkg.includes('/Resources/')) return true;
  const name = typeof item.name === 'string' ? item.name : '';
  return !!(name && engramSet && engramSet.has(`${name}_C`));
}

function isJunkClass(item) {
  if (!item || typeof item !== 'object') return true;
  const name = String(item.name || '');
  const pkg = String(item.pkg || '');
  if (name.startsWith(KIBBLE_BASE_RESCUE_PREFIX)) return false;
  if (name.startsWith('PrimalItemCustomFoodRecipe')) return true;
  if (name.startsWith('PrimalItemCustomDrinkRecipe')) return true;
  if (name.includes('RecipeNote')) return true;
  if (pkg.includes('/BaseBPs/')) return true;
  if (name.includes('Generic')) return true;
  if (name.endsWith('_Base')) return true;
  if (/_Base_[A-Z]/.test(name)) return true;
  return false;
}

function isRefillClass(item) {
  return String(item && item.name || '').includes('Refill');
}

function isExactExcludedClass(item) {
  return EXCLUDED_EXACT_CLASSES.has(item && item.name);
}

function isKeptByCalculatorRule(item, engramSet) {
  if (!hasRecipe(item) || !isInCalculatorScope(item, engramSet) || isJunkClass(item)) return false;
  if (isRefillClass(item) || isExactExcludedClass(item)) return false;
  return true;
}

function applyCalculatorRule(items, engramSet) {
  const kept = [];
  const excluded = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (isKeptByCalculatorRule(item, engramSet)) kept.push(item);
    else excluded.push(item);
  }
  return { kept, excluded };
}

function assertCalculatorRuleCounts(items, engramSet) {
  const { kept, excluded } = applyCalculatorRule(items, engramSet);
  if (kept.length !== EXPECTED_KEEP_COUNT || excluded.length !== EXPECTED_EXCLUDE_COUNT) {
    throw new Error(
      `calculator keep-rule counts changed: KEEP ${kept.length} EXCLUDED ${excluded.length} ` +
        `(expected KEEP ${EXPECTED_KEEP_COUNT} EXCLUDED ${EXPECTED_EXCLUDE_COUNT})`
    );
  }
  return { kept, excluded };
}

function collectReferencedClasses(items) {
  const set = new Set();
  for (const item of items || []) {
    for (const list of [item && item.reqs, item && item.custom]) {
      if (!Array.isArray(list)) continue;
      for (const req of list) {
        if (req && typeof req.res === 'string' && req.res) set.add(req.res);
      }
    }
  }
  return set;
}

function buildDisplayNameMap(fullItems, referencedClasses) {
  const byClass = new Map();
  for (const item of fullItems || []) {
    if (item && typeof item.name === 'string' && item.name && !byClass.has(`${item.name}_C`)) {
      byClass.set(`${item.name}_C`, item);
    }
  }
  const labels = {};
  const missing = [];
  for (const res of referencedClasses) {
    const rec = byClass.get(res);
    const dname = rec && typeof rec.dname === 'string' ? rec.dname : '';
    if (!rec || !dname) missing.push(res);
    else labels[res] = dname;
  }
  return { labels, missing };
}

function findDuplicateDnames(items) {
  const byDname = new Map();
  for (const item of items || []) {
    const dname = item && typeof item.dname === 'string' ? item.dname : '';
    if (!byDname.has(dname)) byDname.set(dname, []);
    byDname.get(dname).push(item && item.name);
  }
  const collisions = [];
  for (const [dname, names] of byDname) {
    if (names.length > 1) collisions.push({ dname, names });
  }
  collisions.sort((a, b) => String(a.dname).localeCompare(String(b.dname)));
  return collisions;
}

function applyDisplayNameOverrides(items, labels) {
  for (const item of items || []) {
    const override = item && DISPLAY_NAME_OVERRIDES[item.name];
    if (override) item.dname = override;
  }
  if (!labels) return;
  for (const [name, label] of Object.entries(DISPLAY_NAME_OVERRIDES)) {
    const key = `${name}_C`;
    if (Object.prototype.hasOwnProperty.call(labels, key)) labels[key] = label;
  }
}

function collectStaleOverrides(items) {
  const present = new Set();
  for (const item of items || []) {
    if (item && typeof item.name === 'string' && item.name) present.add(item.name);
  }
  return Object.keys(DISPLAY_NAME_OVERRIDES).filter((name) => !present.has(name));
}

function assertNoDuplicateDnames(items) {
  const collisions = findDuplicateDnames(items);
  if (collisions.length) {
    const detail = collisions
      .map((row) => `${JSON.stringify(row.dname)}: ${row.names.join(', ')}`)
      .join('; ');
    throw new Error(`duplicate dnames in final dataset: ${detail}`);
  }
  return collisions;
}

function assertOverridesPresent(items) {
  const stale = collectStaleOverrides(items);
  if (stale.length) {
    throw new Error(`stale display-name overrides: ${stale.join(', ')}`);
  }
  return stale;
}

function referencesMortarAndPestle(stations) {
  if (!Array.isArray(stations)) return false;
  return stations.some((station) => String(station).includes('MortarAndPestle'));
}

function collectNameIndex(lists) {
  const names = new Set();
  for (const list of lists) {
    for (const item of list || []) {
      if (item && typeof item.name === 'string' && item.name) names.add(item.name);
    }
  }
  return names;
}

function isInScope(fullItem, yieldItem, nameIndex) {
  if (!fullItem || typeof fullItem !== 'object') return false;
  if (!yieldItem || typeof yieldItem !== 'object') return false;
  if (fullItem.result !== 'OK' || yieldItem.result !== 'OK') return false;
  if (!Array.isArray(fullItem.reqs) || fullItem.reqs.length === 0) return false;
  if (fullItem.reqs.some((req) => !req || typeof req.res !== 'string' || !req.res)) return false;
  if (!(Number(yieldItem.qty_made) >= 1)) return false;
  if (extraResolvesToKnownOutput(yieldItem.extra, nameIndex)) return false;
  if (isMulticraftFamily(fullItem.name) || isMulticraftFamily(yieldItem.name)) return false;
  return true;
}

function shortName(name) {
  return String(name || '')
    .replace(/^PrimalItemConsumable_/, '')
    .replace(/^PrimalItemResource_/, '')
    .replace(/^PrimalItemStructure_/, '')
    .replace(/^PrimalItemArmor_/, '')
    .replace(/^PrimalItemAmmo_/, '')
    .replace(/^PrimalItemSkin_/, '')
    .replace(/^PrimalItem_/, '')
    .replace(/_/g, ' ');
}

function assignLabels(items) {
  const byDname = new Map();
  for (const item of items) {
    const key = item.dname || item.name;
    if (!byDname.has(key)) byDname.set(key, []);
    byDname.get(key).push(item);
  }
  const collisions = [];
  for (const [dname, group] of byDname) {
    if (group.length === 1) {
      group[0].label = dname;
      continue;
    }
    collisions.push({ dname, names: group.map((item) => item.name) });
    for (const item of group) {
      item.label = `${dname} (${shortName(item.name)})`;
    }
  }
  return collisions;
}

function labelForResource(res, labels) {
  if (!res || !labels || typeof labels[res] !== 'string' || !labels[res]) return '';
  return labels[res];
}

function copyReqs(reqs, labels) {
  const unresolved = [];
  const copied = (reqs || []).map((req) => {
    const res = req && req.res;
    const id = stripClassSuffix(res);
    const label = labelForResource(res, labels);
    const resolved = Boolean(label);
    if (!resolved) unresolved.push(res);
    return {
      qty: req && req.qty,
      res,
      exact: !!(req && req.exact),
      id,
      label,
      resolved,
    };
  });
  return { reqs: copied, unresolved };
}

function stationById(id) {
  return STATIONS.find((station) => station.id === id) || null;
}

function computeCraft(item, target, station) {
  const qtyMade = Number(item && item.qty_made);
  const qMul = Number(station && station.quantity_multiplier);
  const rMul = Number(station && station.requirements_multiplier);
  const rawTarget = Number(target);
  const targetQty = Number.isFinite(rawTarget) && rawTarget > 0 ? rawTarget : 0;
  const effectiveYield = qtyMade * qMul;
  const crafts = targetQty <= 0 || !(effectiveYield > 0) ? 0 : Math.ceil(targetQty / effectiveYield);
  const produced = crafts * effectiveYield;
  const overflow = produced - targetQty;
  const materials = (item && Array.isArray(item.reqs) ? item.reqs : []).map((req) => ({
    id: req.id,
    res: req.res,
    label: req.label,
    qty: crafts * Number(req.qty) * rMul,
  }));
  return { crafts, produced, overflow, materials, station };
}

function sumMaterials(rows) {
  const totals = new Map();
  for (const row of rows || []) {
    for (const part of row.materials || []) {
      const prev = totals.get(part.id);
      if (!prev) {
        totals.set(part.id, {
          id: part.id,
          res: part.res,
          label: part.label,
          qty: part.qty,
        });
      } else {
        prev.qty += part.qty;
      }
    }
  }
  return [...totals.values()];
}

function findItem(dataset, name) {
  if (!dataset || !Array.isArray(dataset.items)) return null;
  return dataset.items.find((item) => item.name === name) || null;
}

function craftTotalsFor(dataset, selections) {
  const defaultRows = [];
  const chemRows = [];
  const details = [];
  const mortar = stationById('mortar_and_pestle');
  const bench = stationById('chemistry_bench');
  for (const sel of selections || []) {
    const item = findItem(dataset, sel.name);
    if (!item) continue;
    const atMortar = computeCraft(item, sel.count, mortar);
    const atBench = item.chem_compare ? computeCraft(item, sel.count, bench) : atMortar;
    defaultRows.push({ materials: atMortar.materials });
    chemRows.push({ materials: atBench.materials });
    details.push({
      name: item.name,
      label: item.label,
      target: sel.count,
      chem_compare: item.chem_compare === true,
      default: atMortar,
      chemistry_bench: item.chem_compare ? atBench : null,
    });
  }
  return {
    default: sumMaterials(defaultRows),
    chemistry_bench: sumMaterials(chemRows),
    details,
  };
}

function collectExcludedWrappers(yieldItems, nameIndex) {
  const names = [];
  const seen = new Set();
  for (const item of yieldItems || []) {
    if (!extraResolvesToKnownOutput(item && item.extra, nameIndex)) continue;
    if (typeof item.name !== 'string' || !item.name || seen.has(item.name)) continue;
    seen.add(item.name);
    names.push(item.name);
  }
  return names;
}

function buildDataset(fullItems, yieldItems, engramEntries) {
  const fullList = Array.isArray(fullItems) ? fullItems : [];
  const yieldList = Array.isArray(yieldItems) ? yieldItems : [];
  const engramSet = collectEngramClassSet(engramEntries);
  const { kept: ruleKept } = applyCalculatorRule(fullList, engramSet);
  const labelsMap = buildDisplayNameMap(fullList, collectReferencedClasses(ruleKept));
  applyDisplayNameOverrides([], labelsMap.labels);
  const nameIndex = collectNameIndex([fullList, yieldList]);
  const byNameYield = new Map();
  for (const item of yieldList) {
    if (item && typeof item.name === 'string' && item.name && !byNameYield.has(item.name)) {
      byNameYield.set(item.name, item);
    }
  }

  const excludedWrappers = collectExcludedWrappers(yieldList, nameIndex);
  const items = [];
  const unresolved = [];
  const seen = new Set();
  for (const fullItem of ruleKept) {
    if (!fullItem || typeof fullItem.name !== 'string' || !fullItem.name) continue;
    if (seen.has(fullItem.name)) continue;
    const yieldItem = byNameYield.get(fullItem.name);
    const retainOverride = Object.prototype.hasOwnProperty.call(DISPLAY_NAME_OVERRIDES, fullItem.name);
    if (!isInScope(fullItem, yieldItem, nameIndex) && !retainOverride) continue;
    if (retainOverride && !(yieldItem && Number(yieldItem.qty_made) >= 1)) continue;
    seen.add(fullItem.name);
    const copied = copyReqs(fullItem.reqs, labelsMap.labels);
    for (const res of copied.unresolved) unresolved.push({ item: fullItem.name, res });
    items.push({
      name: fullItem.name,
      dname: fullItem.dname || fullItem.name,
      qty_made: Number(yieldItem.qty_made),
      chem_compare: referencesMortarAndPestle(yieldItem && yieldItem.stations),
      reqs: copied.reqs,
    });
  }

  applyDisplayNameOverrides(items, labelsMap.labels);
  const collisions = assignLabels(items);
  items.sort((a, b) => {
    const byLabel = String(a.label).localeCompare(String(b.label));
    if (byLabel !== 0) return byLabel;
    return String(a.name).localeCompare(String(b.name));
  });

  return {
    stations: STATIONS,
    items,
    labels: labelsMap.labels,
    missingLabels: labelsMap.missing,
    duplicateDnames: findDuplicateDnames(items),
    staleOverrides: collectStaleOverrides(items),
    ruleKeepCount: ruleKept.length,
    ruleExcludeCount: fullList.length - ruleKept.length,
    collisions,
    unresolved,
    excludedWrappers,
  };
}

module.exports = {
  STATIONS,
  EXPECTED_KEEP_COUNT,
  EXPECTED_EXCLUDE_COUNT,
  parseItemsJsonl,
  stripClassSuffix,
  extraItemName,
  extraResolvesToKnownOutput,
  isMulticraftFamily,
  referencesMortarAndPestle,
  collectEngramClassSet,
  hasRecipe,
  isInCalculatorScope,
  isJunkClass,
  isKeptByCalculatorRule,
  applyCalculatorRule,
  assertCalculatorRuleCounts,
  collectReferencedClasses,
  buildDisplayNameMap,
  findDuplicateDnames,
  applyDisplayNameOverrides,
  collectStaleOverrides,
  assertNoDuplicateDnames,
  assertOverridesPresent,
  DISPLAY_NAME_OVERRIDES,
  EXCLUDED_EXACT_CLASSES,
  isInScope,
  assignLabels,
  stationById,
  computeCraft,
  sumMaterials,
  findItem,
  craftTotalsFor,
  buildDataset,
};
