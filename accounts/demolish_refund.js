#!/usr/bin/env node
'use strict';

/**
 * demolish_refund.js
 *
 * Pure filter / math / dataset builder for the demolish-refund
 * calculator. Reads extracted item records; does not touch the
 * network or the filesystem. The generated JSON is produced by
 * build_demolish_refunds.js and served as a static asset.
 */

function parseItemsJsonl(text) {
  const items = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    items.push(JSON.parse(line));
  }
  return items;
}

function isInScope(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.result !== 'OK') return false;
  if (item.struct == null || item.struct === '') return false;
  if (!Array.isArray(item.reqs) || item.reqs.length === 0) return false;
  if (item.justdestroy === true) return false;
  if (!(Number(item.demo_pct) > 0)) return false;
  const name = String(item.name || '');
  if (name.includes('Skin')) return false;
  if (name.startsWith('PrimalItemStructure_Base')) return false;
  return true;
}

function collectNodemoNames(items) {
  const names = [];
  const seen = new Set();
  for (const item of items) {
    if (!item || item.nodemo !== true || typeof item.name !== 'string' || !item.name) continue;
    if (seen.has(item.name)) continue;
    seen.add(item.name);
    names.push(item.name);
  }
  return names;
}

function stripClassSuffix(res) {
  if (typeof res !== 'string') return '';
  return res.endsWith('_C') ? res.slice(0, -2) : res;
}

function resourceId(res) {
  if (typeof res !== 'string' || !res) return '';
  return stripClassSuffix(res).replace(/^PrimalItemResource_/, '');
}

function perUnitRefund(qty, demoPct, nodemo) {
  if (nodemo) return 0;
  return Math.floor(Number(qty) * Number(demoPct));
}

function scaleRefunds(refunds, count) {
  const n = Number(count);
  const qty = Number.isFinite(n) ? n : 0;
  return (Array.isArray(refunds) ? refunds : []).map((row) => ({
    id: row.id,
    res: row.res,
    label: row.label,
    qty: row.qty,
    refund: row.refund,
    nodemo: row.nodemo === true,
    total: row.refund * qty,
  }));
}

function sumRows(rows) {
  const totals = new Map();
  for (const row of rows || []) {
    for (const part of scaleRefunds(row.refunds, row.count)) {
      const prev = totals.get(part.id);
      if (!prev) {
        totals.set(part.id, {
          id: part.id,
          res: part.res,
          label: part.label,
          total: part.total,
          nodemo: part.nodemo,
        });
      } else {
        prev.total += part.total;
      }
    }
  }
  return [...totals.values()];
}

function shortName(name) {
  return String(name || '').replace(/^PrimalItemStructure_/, '').replace(/_/g, ' ');
}

function assignLabels(structures) {
  const byDname = new Map();
  for (const structure of structures) {
    const key = structure.dname || structure.name;
    if (!byDname.has(key)) byDname.set(key, []);
    byDname.get(key).push(structure);
  }
  const collisions = [];
  for (const [dname, group] of byDname) {
    if (group.length === 1) {
      group[0].label = dname;
      continue;
    }
    collisions.push({ dname, names: group.map((s) => s.name) });
    for (const structure of group) {
      structure.label = `${dname} (${shortName(structure.name)})`;
    }
  }
  return collisions;
}

function labelForResource(res, byName) {
  const name = stripClassSuffix(res);
  const hit = byName.get(name);
  if (hit && typeof hit.dname === 'string' && hit.dname) return hit.dname;
  return resourceId(res) || res;
}

function computeRefunds(item, nodemoSet, byName) {
  const demoPct = item.demo_pct;
  const refunds = [];
  for (const req of item.reqs) {
    if (!req || typeof req.res !== 'string' || !req.res) continue;
    const nodemo = nodemoSet.has(stripClassSuffix(req.res));
    refunds.push({
      id: resourceId(req.res),
      res: req.res,
      label: labelForResource(req.res, byName),
      qty: req.qty,
      refund: perUnitRefund(req.qty, demoPct, nodemo),
      nodemo,
    });
  }
  return refunds;
}

function copyReqs(reqs) {
  return reqs.map((req) => ({
    qty: req && req.qty,
    res: req && req.res,
    exact: !!(req && req.exact),
  }));
}

function buildDataset(items) {
  const list = Array.isArray(items) ? items : [];
  const nodemo = collectNodemoNames(list);
  const nodemoSet = new Set(nodemo);
  const byName = new Map();
  for (const item of list) {
    if (item && typeof item.name === 'string' && item.name && !byName.has(item.name)) {
      byName.set(item.name, item);
    }
  }

  const structures = [];
  const seen = new Set();
  for (const item of list) {
    if (!isInScope(item)) continue;
    if (seen.has(item.name)) continue;
    seen.add(item.name);
    structures.push({
      name: item.name,
      dname: item.dname || item.name,
      demo_pct: item.demo_pct,
      justdestroy: item.justdestroy === true,
      reqs: copyReqs(item.reqs),
      refunds: computeRefunds(item, nodemoSet, byName),
    });
  }

  const collisions = assignLabels(structures);
  structures.sort((a, b) => {
    const byLabel = String(a.label).localeCompare(String(b.label));
    if (byLabel !== 0) return byLabel;
    return String(a.name).localeCompare(String(b.name));
  });

  return { nodemo, structures, collisions };
}

function findStructure(dataset, name) {
  if (!dataset || !Array.isArray(dataset.structures)) return null;
  return dataset.structures.find((s) => s.name === name) || null;
}

function refundTotalsFor(dataset, selections) {
  const rows = [];
  for (const sel of selections || []) {
    const structure = findStructure(dataset, sel.name);
    if (!structure) continue;
    rows.push({ refunds: structure.refunds, count: sel.count });
  }
  return sumRows(rows);
}

module.exports = {
  parseItemsJsonl,
  isInScope,
  collectNodemoNames,
  resourceId,
  perUnitRefund,
  scaleRefunds,
  sumRows,
  assignLabels,
  buildDataset,
  findStructure,
  refundTotalsFor,
};
