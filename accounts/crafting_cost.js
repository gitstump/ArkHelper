#!/usr/bin/env node
'use strict';

/**
 * crafting_cost.js
 *
 * Pure filter / math / dataset builder for the crafting-cost
 * calculator. Reads extracted item + yield records; does not touch
 * the network or the filesystem. The generated JSON is produced by
 * build_crafting_costs.js and served as a static asset.
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
    return name && nameIndex.has(name);
  });
}

function isMulticraftFamily(name) {
  return String(name || '').includes('MulticraftItem_');
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

function labelForResource(res, byName) {
  const name = stripClassSuffix(res);
  const hit = byName.get(name);
  if (hit && typeof hit.dname === 'string' && hit.dname) return hit.dname;
  return shortName(name) || res;
}

function copyReqs(reqs, nameIndex, byName) {
  const unresolved = [];
  const copied = (reqs || []).map((req) => {
    const id = stripClassSuffix(req && req.res);
    const resolved = nameIndex.has(id);
    if (!resolved) unresolved.push(req && req.res);
    return {
      qty: req && req.qty,
      res: req && req.res,
      exact: !!(req && req.exact),
      id,
      label: labelForResource(req && req.res, byName),
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

function buildDataset(fullItems, yieldItems) {
  const fullList = Array.isArray(fullItems) ? fullItems : [];
  const yieldList = Array.isArray(yieldItems) ? yieldItems : [];
  const nameIndex = collectNameIndex([fullList, yieldList]);
  const byNameFull = new Map();
  for (const item of fullList) {
    if (item && typeof item.name === 'string' && item.name && !byNameFull.has(item.name)) {
      byNameFull.set(item.name, item);
    }
  }
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
  for (const fullItem of fullList) {
    if (!fullItem || typeof fullItem.name !== 'string' || !fullItem.name) continue;
    if (seen.has(fullItem.name)) continue;
    const yieldItem = byNameYield.get(fullItem.name);
    if (!isInScope(fullItem, yieldItem, nameIndex)) continue;
    seen.add(fullItem.name);
    const copied = copyReqs(fullItem.reqs, nameIndex, byNameFull);
    for (const res of copied.unresolved) unresolved.push({ item: fullItem.name, res });
    items.push({
      name: fullItem.name,
      dname: fullItem.dname || fullItem.name,
      qty_made: Number(yieldItem.qty_made),
      chem_compare: referencesMortarAndPestle(yieldItem.stations),
      reqs: copied.reqs,
    });
  }

  const collisions = assignLabels(items);
  items.sort((a, b) => {
    const byLabel = String(a.label).localeCompare(String(b.label));
    if (byLabel !== 0) return byLabel;
    return String(a.name).localeCompare(String(b.name));
  });

  return {
    stations: STATIONS,
    items,
    collisions,
    unresolved,
    excludedWrappers,
  };
}

module.exports = {
  STATIONS,
  parseItemsJsonl,
  stripClassSuffix,
  extraItemName,
  extraResolvesToKnownOutput,
  isMulticraftFamily,
  referencesMortarAndPestle,
  isInScope,
  assignLabels,
  stationById,
  computeCraft,
  sumMaterials,
  findItem,
  craftTotalsFor,
  buildDataset,
};
