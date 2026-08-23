#!/usr/bin/env node
'use strict';

/**
 * crafting_cost_page.js
 *
 * /tools/crafting-cost — server-rendered shell. Item data is fetched
 * client-side from the static JSON asset; Node does not open that
 * file per request.
 */

const { escapeHtml } = require('./theme.js');
const { renderPage } = require('./layout.js');

const PAGE_TITLE = 'Crafting Cost Calculator';
const INTRO =
  "Work out exactly what a batch costs before you start farming. Pick what you're making, set how many you need, and this lists the materials the way the game does — the direct ingredients, not a full breakdown down to stone and flint. Add as many items as you like and the totals stack up across all of them.";
const CHEM_NOTE =
  "The Chemistry Bench is the only station in ARK that changes what a craft costs. It takes four times the materials and gives back six, which works out to one and a half times more product for the same resources. Everything else — industrial forges, cookers, the steam forge — only changes how fast the job runs, not what it takes. If you're making Cementing Paste in bulk, the bench is worth building.";
const OVERFLOW_NOTE =
  "Some recipes make more than one at a time, so you'll sometimes end up with a few spare. Sparkpowder comes two per craft, so asking for five means running three crafts and finishing with six. The extras are shown so the count isn't a surprise.";
const SCOPE_NOTE =
  "This lists direct ingredients only, matching what the game shows you in a crafting menu. Making bullets tells you that you need gunpowder and an ingot; it doesn't walk you back through what gunpowder is made from.";

const PAGE_CSS = `
.craft-intro, .craft-scope, .craft-overflow, .craft-chem { max-width: 46rem; }
.craft-chem {
  background: var(--surface);
  border: 1px solid var(--border);
  border-left: 4px solid var(--accent);
  border-radius: var(--radius);
  padding: var(--space-3) var(--space-4);
  margin: var(--space-5) 0 var(--space-3);
}
.craft-builder { margin: var(--space-5) 0; }
.craft-picker { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: flex-end; }
.craft-picker label { display: block; color: var(--muted); font-size: 0.82rem; margin-bottom: 4px; }
.craft-search-wrap { position: relative; flex: 1 1 18rem; min-width: 12rem; }
.craft-search-wrap input { width: 100%; }
.craft-choices {
  list-style: none;
  margin: 4px 0 0;
  padding: var(--space-1);
  position: absolute;
  left: 0;
  right: 0;
  max-height: 16rem;
  overflow: auto;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  z-index: 20;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.35);
}
.craft-choices[hidden] { display: none; }
.craft-choices button {
  display: block;
  width: 100%;
  text-align: left;
  background: transparent;
  border: none;
  padding: var(--space-2) var(--space-3);
  border-radius: 4px;
}
.craft-choices button:hover, .craft-choices button[aria-selected="true"] { background: var(--bg); color: var(--accent); }
.craft-rows { list-style: none; margin: var(--space-4) 0 0; padding: 0; }
.craft-rows li {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: center;
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--border);
}
.craft-rows .name { flex: 1 1 12rem; font-weight: 600; }
.craft-rows input[type="number"] { width: 6.5rem; }
.craft-rows .overflow { color: var(--muted); font-size: 0.85rem; flex: 1 1 100%; }
.craft-results { margin-top: var(--space-4); }
.craft-results table { background: var(--surface); border: 1px solid var(--border); }
.craft-overflow-list { list-style: none; margin: 0 0 var(--space-3); padding: 0; color: var(--muted); }
.craft-load-error { color: var(--offline); }
`;

const PAGE_JS = `
(function () {
  var DATA_URL = '/data/crafting-costs.json';
  var data = null;
  var rows = [];
  var highlight = 0;

  var search = document.getElementById('craft-search');
  var choices = document.getElementById('craft-choices');
  var addBtn = document.getElementById('craft-add');
  var rowList = document.getElementById('craft-rows');
  var results = document.getElementById('craft-results');
  var overflowList = document.getElementById('craft-overflow-list');
  var totalsHead = document.getElementById('craft-totals-head');
  var totalsBody = document.getElementById('craft-totals');
  var chemNote = document.getElementById('chem-note');
  var loadError = document.getElementById('craft-load-error');

  function stationById(id) {
    if (!data || !data.stations) return null;
    for (var i = 0; i < data.stations.length; i++) {
      if (data.stations[i].id === id) return data.stations[i];
    }
    return null;
  }

  function computeCraft(item, target, station) {
    var qtyMade = Number(item.qty_made);
    var qMul = Number(station.quantity_multiplier);
    var rMul = Number(station.requirements_multiplier);
    var rawTarget = Number(target);
    var targetQty = isFinite(rawTarget) && rawTarget > 0 ? rawTarget : 0;
    var effectiveYield = qtyMade * qMul;
    var crafts = targetQty <= 0 || !(effectiveYield > 0) ? 0 : Math.ceil(targetQty / effectiveYield);
    var produced = crafts * effectiveYield;
    var overflow = produced - targetQty;
    var materials = (item.reqs || []).map(function (req) {
      return { id: req.id, res: req.res, label: req.label, qty: crafts * Number(req.qty) * rMul };
    });
    return { crafts: crafts, produced: produced, overflow: overflow, materials: materials };
  }

  function matches(item, q) {
    if (!q) return true;
    var hay = ((item.label || '') + ' ' + (item.dname || '') + ' ' + (item.name || '')).toLowerCase();
    return hay.indexOf(q) !== -1;
  }

  function filtered() {
    var q = (search.value || '').trim().toLowerCase();
    return data.items.filter(function (item) { return matches(item, q); });
  }

  function hideChoices() {
    choices.hidden = true;
    choices.innerHTML = '';
  }

  function showChoices() {
    if (!data) return;
    var list = filtered().slice(0, 40);
    choices.innerHTML = '';
    if (!list.length) {
      hideChoices();
      return;
    }
    if (highlight >= list.length) highlight = 0;
    list.forEach(function (item, i) {
      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = item.label;
      btn.setAttribute('aria-selected', i === highlight ? 'true' : 'false');
      btn.addEventListener('mousedown', function (e) {
        e.preventDefault();
        addItem(item.name);
      });
      li.appendChild(btn);
      choices.appendChild(li);
    });
    choices.hidden = false;
  }

  function addItem(name) {
    var existing = rows.filter(function (r) { return r.name === name; })[0];
    if (existing) {
      existing.count += 1;
    } else {
      rows.push({ name: name, count: 1 });
    }
    search.value = '';
    hideChoices();
    renderRows();
    renderTotals();
  }

  function addHighlighted() {
    if (!data) return;
    var list = filtered();
    if (!list.length) return;
    addItem(list[Math.min(highlight, list.length - 1)].name);
  }

  function findRowItem(name) {
    return data.items.filter(function (item) { return item.name === name; })[0];
  }

  function renderRowOverflow(node, item, count) {
    var mortar = stationById('mortar_and_pestle');
    var cost = computeCraft(item, count, mortar);
    if (cost.overflow > 0) {
      node.hidden = false;
      node.textContent = 'Produces ' + cost.produced + ' (asked for ' + count + ')';
    } else {
      node.hidden = true;
      node.textContent = '';
    }
  }

  function renderRows() {
    rowList.innerHTML = '';
    rows.forEach(function (row, index) {
      var item = findRowItem(row.name);
      if (!item) return;
      var li = document.createElement('li');

      var name = document.createElement('span');
      name.className = 'name';
      name.textContent = item.label;
      li.appendChild(name);

      var qtyLabel = document.createElement('label');
      qtyLabel.textContent = 'Qty ';
      var input = document.createElement('input');
      input.type = 'number';
      input.min = '1';
      input.step = '1';
      input.value = String(row.count);
      input.addEventListener('input', function () {
        var n = parseInt(input.value, 10);
        row.count = Number.isFinite(n) && n > 0 ? n : 0;
        renderRowOverflow(extra, item, row.count);
        renderTotals();
      });
      qtyLabel.appendChild(input);
      li.appendChild(qtyLabel);

      var remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.addEventListener('click', function () {
        rows.splice(index, 1);
        renderRows();
        renderTotals();
      });
      li.appendChild(remove);

      var extra = document.createElement('span');
      extra.className = 'overflow';
      renderRowOverflow(extra, item, row.count);
      li.appendChild(extra);

      rowList.appendChild(li);
    });
  }

  function sumMaterials(materialSets) {
    var totals = [];
    var byId = {};
    materialSets.forEach(function (materials) {
      materials.forEach(function (part) {
        var prev = byId[part.id];
        if (!prev) {
          prev = { id: part.id, label: part.label, qty: part.qty };
          byId[part.id] = prev;
          totals.push(prev);
        } else {
          prev.qty += part.qty;
        }
      });
    });
    return totals;
  }

  function renderTotals() {
    totalsBody.innerHTML = '';
    overflowList.innerHTML = '';
    if (!rows.length) {
      results.hidden = true;
      if (chemNote) chemNote.hidden = true;
      return;
    }
    results.hidden = false;

    var mortar = stationById('mortar_and_pestle');
    var bench = stationById('chemistry_bench');
    var defaultSets = [];
    var chemSets = [];
    var anyChem = false;

    rows.forEach(function (row) {
      var item = findRowItem(row.name);
      if (!item) return;
      var atMortar = computeCraft(item, row.count, mortar);
      defaultSets.push(atMortar.materials);
      if (item.chem_compare) {
        anyChem = true;
        chemSets.push(computeCraft(item, row.count, bench).materials);
      } else {
        chemSets.push(atMortar.materials);
      }
      if (atMortar.overflow > 0) {
        var li = document.createElement('li');
        li.textContent = item.label + ': ' + atMortar.produced + ' produced (asked for ' + row.count + ')';
        overflowList.appendChild(li);
      }
    });

    if (chemNote) chemNote.hidden = !anyChem;

    totalsHead.innerHTML = '';
    var headRow = document.createElement('tr');
    var resourceTh = document.createElement('th');
    resourceTh.textContent = 'Resource';
    headRow.appendChild(resourceTh);
    if (anyChem) {
      var mortarTh = document.createElement('th');
      mortarTh.className = 'num';
      mortarTh.textContent = 'Mortar and Pestle';
      var benchTh = document.createElement('th');
      benchTh.className = 'num';
      benchTh.textContent = 'Chemistry Bench';
      headRow.appendChild(mortarTh);
      headRow.appendChild(benchTh);
    } else {
      var neededTh = document.createElement('th');
      neededTh.className = 'num';
      neededTh.textContent = 'Needed';
      headRow.appendChild(neededTh);
    }
    totalsHead.appendChild(headRow);

    var defaultTotals = sumMaterials(defaultSets);
    var chemTotals = sumMaterials(chemSets);
    var chemById = {};
    chemTotals.forEach(function (part) { chemById[part.id] = part; });

    defaultTotals.forEach(function (part) {
      var tr = document.createElement('tr');
      var nameTd = document.createElement('td');
      nameTd.textContent = part.label;
      tr.appendChild(nameTd);
      var qtyTd = document.createElement('td');
      qtyTd.className = 'num';
      qtyTd.textContent = String(part.qty);
      tr.appendChild(qtyTd);
      if (anyChem) {
        var chemTd = document.createElement('td');
        chemTd.className = 'num';
        chemTd.textContent = String((chemById[part.id] && chemById[part.id].qty) || 0);
        tr.appendChild(chemTd);
      }
      totalsBody.appendChild(tr);
    });
  }

  if (search) {
    search.addEventListener('input', function () {
      highlight = 0;
      showChoices();
    });
    search.addEventListener('focus', showChoices);
    search.addEventListener('blur', function () {
      setTimeout(hideChoices, 150);
    });
    search.addEventListener('keydown', function (e) {
      if (!data) return;
      var list = filtered().slice(0, 40);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        highlight = list.length ? (highlight + 1) % list.length : 0;
        showChoices();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        highlight = list.length ? (highlight - 1 + list.length) % list.length : 0;
        showChoices();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        addHighlighted();
      } else if (e.key === 'Escape') {
        hideChoices();
      }
    });
  }
  if (addBtn) addBtn.addEventListener('click', addHighlighted);

  fetch(DATA_URL)
    .then(function (res) {
      if (!res.ok) throw new Error('unavailable');
      return res.json();
    })
    .then(function (json) {
      data = json;
      if (loadError) loadError.hidden = true;
    })
    .catch(function () {
      if (loadError) loadError.hidden = false;
    });
})();
`.trim();

function renderCraftingCostPage({ account = null, live = null } = {}) {
  const body = `<h1>${escapeHtml(PAGE_TITLE)}</h1>
  <p class="craft-intro">${escapeHtml(INTRO)}</p>
  <p class="craft-scope">${escapeHtml(SCOPE_NOTE)}</p>
  <p class="craft-overflow">${escapeHtml(OVERFLOW_NOTE)}</p>
  <section class="craft-builder" id="craft-builder">
    <div class="craft-picker">
      <div class="craft-search-wrap">
        <label for="craft-search">Item</label>
        <input id="craft-search" type="search" placeholder="Search items" autocomplete="off">
        <ul id="craft-choices" class="craft-choices" hidden></ul>
      </div>
      <button type="button" id="craft-add">Add item</button>
    </div>
    <p id="craft-load-error" class="note craft-load-error" hidden>Item data isn't available right now.</p>
    <noscript><p class="note">This calculator needs JavaScript to load the item list.</p></noscript>
    <ul id="craft-rows" class="craft-rows"></ul>
  </section>
  <section id="craft-results" class="craft-results" hidden>
    <h2>Materials needed</h2>
    <ul id="craft-overflow-list" class="craft-overflow-list"></ul>
    <table>
      <thead id="craft-totals-head"></thead>
      <tbody id="craft-totals"></tbody>
    </table>
  </section>
  <p id="chem-note" class="craft-chem" hidden>${escapeHtml(CHEM_NOTE)}</p>`;

  return renderPage({
    title: `${PAGE_TITLE} \u2014 ArkHelper`,
    description: 'Work out the materials a craft costs in ARK: Survival Ascended — first-level ingredients, including the Chemistry Bench saving.',
    currentPath: '/tools/crafting-cost',
    account,
    live,
    extraCss: PAGE_CSS,
    extraJs: PAGE_JS,
    body,
  });
}

module.exports = {
  PAGE_TITLE,
  INTRO,
  CHEM_NOTE,
  OVERFLOW_NOTE,
  SCOPE_NOTE,
  renderCraftingCostPage,
};
