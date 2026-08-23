#!/usr/bin/env node
'use strict';

/**
 * demolish_refund_page.js
 *
 * /tools/demolish-refund — server-rendered shell. Structure data is
 * fetched client-side from the static JSON asset; Node does not open
 * that file per request.
 */

const { escapeHtml } = require('./theme.js');
const { renderPage } = require('./layout.js');
const { resolveDataUrl } = require('./static_data.js');

const PAGE_TITLE = 'Demolish Refund Calculator';
const INTRO =
  'Demolishing a structure returns half of what it cost to build, rounded down. That rounding happens on each structure individually, so the loss compounds: a Thatch Wall costs 7 Fibers and returns 3, and a thousand of them return 3,000 rather than 3,500. Pick your structures below to see exactly what a teardown puts back in your inventory.';
const OFFICIAL_NOTICE =
  'These numbers are for official servers. Unofficial and dedicated servers can change how refunds are calculated, so treat this as a baseline rather than a guarantee if you play anywhere else.';
const ELEMENT_NOTE =
  'Element and everything in its family — shards, dust, refined forms — never comes back from a demolish. The game marks these resources as non-refundable, so a Tek teardown returns the metal, polymer and crystal but none of the Element you spent. Those rows are shown as zero rather than hidden, because the gap is worth planning around.';
const ROUNDING_NOTE =
  'Anything a structure only needs one of will refund nothing at all, since half of one rounds down to zero. A Campfire gives back its Thatch, Stone and Wood, but not its Flint.';
const SCOPE_NOTE =
  'This calculator covers demolishing, which is one of two ways to take a structure down. The other is picking it up, and the two are exclusive: pickup hands you the structure back whole and ready to place again, but returns no materials whatsoever. Demolishing is the opposite trade — the structure is gone and you get a share of what it cost. Pickup is only available for a window after placement. On PvP, once that window closes, demolishing is the only way to recover anything, so these numbers are what a teardown actually gets you. PvE keeps pickup available past that point, which is usually the better deal if you intend to rebuild — a structure returned whole beats half its materials.';

const PAGE_CSS = `
.demo-intro, .demo-scope, .demo-official, .demo-rounding, .demo-element { max-width: 46rem; }
.demo-official {
  background: var(--surface);
  border: 1px solid var(--border);
  border-left: 4px solid var(--degraded);
  border-radius: var(--radius);
  padding: var(--space-3) var(--space-4);
  margin: var(--space-5) 0 var(--space-3);
}
.demo-builder { margin: var(--space-5) 0; }
.demo-picker { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: flex-end; }
.demo-picker label { display: block; color: var(--muted); font-size: 0.82rem; margin-bottom: 4px; }
.demo-search-wrap { position: relative; flex: 1 1 18rem; min-width: 12rem; }
.demo-search-wrap input { width: 100%; }
.demo-choices {
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
.demo-choices[hidden] { display: none; }
.demo-choices button {
  display: block;
  width: 100%;
  text-align: left;
  background: transparent;
  border: none;
  padding: var(--space-2) var(--space-3);
  border-radius: 4px;
}
.demo-choices button:hover, .demo-choices button[aria-selected="true"] { background: var(--bg); color: var(--accent); }
.demo-rows { list-style: none; margin: var(--space-4) 0 0; padding: 0; }
.demo-rows li {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: center;
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--border);
}
.demo-rows .name { flex: 1 1 12rem; font-weight: 600; }
.demo-rows input[type="number"] { width: 6.5rem; }
.demo-results { margin-top: var(--space-4); }
.demo-results table { background: var(--surface); border: 1px solid var(--border); }
.demo-results tr.nodemo td { color: var(--muted); }
.demo-results .zero-mark { color: var(--degraded); font-weight: 650; }
.demo-results .nodemo-flag { font-size: 0.82rem; }
.demo-element-ref { margin: var(--space-3) 0 0; }
.demo-load-error { color: var(--offline); }
`;

function pageJs(dataUrl) {
  return `
(function () {
  var DATA_URL = ${JSON.stringify(dataUrl)};
  var data = null;
  var rows = [];
  var highlight = 0;

  var search = document.getElementById('demo-search');
  var choices = document.getElementById('demo-choices');
  var addBtn = document.getElementById('demo-add');
  var rowList = document.getElementById('demo-rows');
  var results = document.getElementById('demo-results');
  var totalsBody = document.getElementById('demo-totals');
  var loadError = document.getElementById('demo-load-error');

  function matches(structure, q) {
    if (!q) return true;
    var hay = ((structure.label || '') + ' ' + (structure.dname || '') + ' ' + (structure.name || '')).toLowerCase();
    return hay.indexOf(q) !== -1;
  }

  function filtered() {
    var q = (search.value || '').trim().toLowerCase();
    return data.structures.filter(function (s) { return matches(s, q); });
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
    list.forEach(function (structure, i) {
      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = structure.label;
      btn.setAttribute('aria-selected', i === highlight ? 'true' : 'false');
      btn.addEventListener('mousedown', function (e) {
        e.preventDefault();
        addStructure(structure.name);
      });
      li.appendChild(btn);
      choices.appendChild(li);
    });
    choices.hidden = false;
  }

  function addStructure(name) {
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
    addStructure(list[Math.min(highlight, list.length - 1)].name);
  }

  function renderRows() {
    rowList.innerHTML = '';
    rows.forEach(function (row, index) {
      var structure = data.structures.filter(function (s) { return s.name === row.name; })[0];
      if (!structure) return;
      var li = document.createElement('li');

      var name = document.createElement('span');
      name.className = 'name';
      name.textContent = structure.label;
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

      rowList.appendChild(li);
    });
  }

  function scaleAndSum() {
    var totals = [];
    var byId = {};
    rows.forEach(function (row) {
      var structure = data.structures.filter(function (s) { return s.name === row.name; })[0];
      if (!structure) return;
      var n = Number(row.count);
      if (!Number.isFinite(n)) n = 0;
      structure.refunds.forEach(function (part) {
        var amount = part.refund * n;
        var prev = byId[part.id];
        if (!prev) {
          prev = { id: part.id, label: part.label, total: amount, nodemo: part.nodemo === true };
          byId[part.id] = prev;
          totals.push(prev);
        } else {
          prev.total += amount;
        }
      });
    });
    return totals;
  }

  function renderTotals() {
    totalsBody.innerHTML = '';
    if (!rows.length) {
      results.hidden = true;
      return;
    }
    results.hidden = false;
    scaleAndSum().forEach(function (part) {
      var tr = document.createElement('tr');
      if (part.nodemo) tr.className = 'nodemo';
      var nameTd = document.createElement('td');
      nameTd.textContent = part.label;
      if (part.nodemo) {
        var flag = document.createElement('sup');
        flag.className = 'nodemo-flag';
        var link = document.createElement('a');
        link.href = '#element-note';
        link.textContent = '*';
        flag.appendChild(link);
        nameTd.appendChild(document.createTextNode(' '));
        nameTd.appendChild(flag);
      }
      var qtyTd = document.createElement('td');
      qtyTd.className = 'num';
      qtyTd.textContent = String(part.total);
      if (part.total === 0) qtyTd.classList.add('zero-mark');
      tr.appendChild(nameTd);
      tr.appendChild(qtyTd);
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
}

function renderDemolishRefundPage({ account = null, live = null, dataUrl } = {}) {
  const resolvedUrl = dataUrl || resolveDataUrl('demolish-refunds');
  const body = `<h1>${escapeHtml(PAGE_TITLE)}</h1>
  <p class="demo-intro">${escapeHtml(INTRO)}</p>
  <p class="demo-scope">${escapeHtml(SCOPE_NOTE)}</p>
  <section class="demo-builder" id="demo-builder">
    <div class="demo-picker">
      <div class="demo-search-wrap">
        <label for="demo-search">Structure</label>
        <input id="demo-search" type="search" placeholder="Search structures" autocomplete="off">
        <ul id="demo-choices" class="demo-choices" hidden></ul>
      </div>
      <button type="button" id="demo-add">Add structure</button>
    </div>
    <p id="demo-load-error" class="note demo-load-error" hidden>Structure data isn't available right now.</p>
    <noscript><p class="note">This calculator needs JavaScript to load the structure list.</p></noscript>
    <ul id="demo-rows" class="demo-rows"></ul>
  </section>
  <p class="demo-official">${escapeHtml(OFFICIAL_NOTICE)}</p>
  <section id="demo-results" class="demo-results" hidden>
    <h2>Materials returned</h2>
    <table>
      <thead><tr><th>Resource</th><th class="num">Refund</th></tr></thead>
      <tbody id="demo-totals"></tbody>
    </table>
    <p class="note demo-element-ref"><a href="#element-note">* Never refunds — see the Element note.</a></p>
  </section>
  <p class="demo-rounding">${escapeHtml(ROUNDING_NOTE)}</p>
  <p id="element-note" class="demo-element">${escapeHtml(ELEMENT_NOTE)}</p>`;

  return renderPage({
    title: `${PAGE_TITLE} \u2014 ArkHelper`,
    description: 'See exactly which materials a structure demolish returns on official ARK: Survival Ascended servers.',
    currentPath: '/tools/demolish-refund',
    account,
    live,
    extraCss: PAGE_CSS,
    extraJs: pageJs(resolvedUrl),
    body,
  });
}

module.exports = {
  PAGE_TITLE,
  INTRO,
  OFFICIAL_NOTICE,
  ELEMENT_NOTE,
  ROUNDING_NOTE,
  SCOPE_NOTE,
  renderDemolishRefundPage,
};
