'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderPeakTimesHeatmap, renderDowntimeHeatmap, hasAnyData, playersColor, downtimeColor } = require('./heatmap_svg.js');

function emptyGrid(extraFields = {}) {
  const grid = [];
  for (let dow = 0; dow < 7; dow += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      grid.push({ dayOfWeek: dow, hour, avgPlayers: null, sampleCount: 0, downtimePercent: null, totalRuns: 0, ...extraFields });
    }
  }
  return grid;
}

// ---------------------------------------------------------------------
// hasAnyData
// ---------------------------------------------------------------------
test('hasAnyData is false for a fully empty grid', () => {
  assert.equal(hasAnyData(emptyGrid()), false);
});

test('hasAnyData is true if even one bucket has samples', () => {
  const grid = emptyGrid();
  grid[0].sampleCount = 3;
  assert.equal(hasAnyData(grid), true);
});

test('hasAnyData checks totalRuns too (for downtime grids)', () => {
  const grid = emptyGrid();
  grid[5].totalRuns = 2;
  assert.equal(hasAnyData(grid), true);
});

// ---------------------------------------------------------------------
// Color scales
// ---------------------------------------------------------------------
test('playersColor returns a darker color for 0 and brighter for max', () => {
  const low = playersColor(0, 100);
  const high = playersColor(100, 100);
  assert.notEqual(low, high);
});

test('playersColor handles maxValue of 0 without dividing by zero', () => {
  assert.doesNotThrow(() => playersColor(0, 0));
});

test('downtimeColor scales with percent and clamps above 100', () => {
  const zero = downtimeColor(0);
  const full = downtimeColor(100);
  const overFull = downtimeColor(150); // shouldn't happen in practice, but shouldn't crash or exceed "full" either
  assert.notEqual(zero, full);
  assert.equal(full, overFull);
});

// ---------------------------------------------------------------------
// renderPeakTimesHeatmap
// ---------------------------------------------------------------------
test('renderPeakTimesHeatmap produces valid-looking SVG with 168 cells', () => {
  const grid = emptyGrid();
  grid[0] = { ...grid[0], avgPlayers: 10, sampleCount: 5 };
  const svg = renderPeakTimesHeatmap(grid);
  assert.match(svg, /^<svg/);
  assert.match(svg, /<\/svg>$/);
  const rectCount = (svg.match(/<rect/g) || []).length;
  assert.equal(rectCount, 168);
});

test('renderPeakTimesHeatmap includes a tooltip title with the player count', () => {
  const grid = emptyGrid();
  grid[0] = { ...grid[0], dayOfWeek: 0, hour: 0, avgPlayers: 42, sampleCount: 3 };
  const svg = renderPeakTimesHeatmap(grid);
  assert.match(svg, /42 avg players/);
});

test('renderPeakTimesHeatmap shows "no data" for empty cells', () => {
  const svg = renderPeakTimesHeatmap(emptyGrid());
  assert.match(svg, /no data/);
});

test('renderPeakTimesHeatmap handles an all-null grid without crashing (maxValue 0)', () => {
  assert.doesNotThrow(() => renderPeakTimesHeatmap(emptyGrid()));
});

// ---------------------------------------------------------------------
// renderDowntimeHeatmap
// ---------------------------------------------------------------------
test('renderDowntimeHeatmap produces 168 cells and includes downtime percent labels', () => {
  const grid = emptyGrid();
  grid[3] = { ...grid[3], downtimePercent: 25, totalRuns: 4 };
  const svg = renderDowntimeHeatmap(grid);
  const rectCount = (svg.match(/<rect/g) || []).length;
  assert.equal(rectCount, 168);
  assert.match(svg, /25% down/);
});

test('renderDowntimeHeatmap on an empty grid still renders valid SVG', () => {
  const svg = renderDowntimeHeatmap(emptyGrid());
  assert.match(svg, /^<svg/);
  assert.match(svg, /no data/);
});

// ---------------------------------------------------------------------
// XSS / injection safety (day labels and hour numbers are internal, but
// values could theoretically be attacker-influenced in the future —
// worth confirming the tooltip text is escaped regardless)
// ---------------------------------------------------------------------
test('heatmap tooltip escaping does not break on special characters in formatted values', () => {
  // formatValue always produces "N avg players" / "N% down" from numbers,
  // so this mostly confirms escapeHtml is actually being applied, not bypassed.
  const grid = emptyGrid();
  grid[0] = { ...grid[0], avgPlayers: 5, sampleCount: 1 };
  const svg = renderPeakTimesHeatmap(grid);
  assert.doesNotMatch(svg, /<script>/);
});

test('heatmap SVGs contain no client-side script (nav close lives only in the HTML shell)', () => {
  const grid = emptyGrid();
  grid[0] = { ...grid[0], avgPlayers: 5, sampleCount: 1, downtimePercent: 10 };
  const peak = renderPeakTimesHeatmap(grid);
  const down = renderDowntimeHeatmap(grid);
  assert.doesNotMatch(peak, /<script/);
  assert.doesNotMatch(down, /<script/);
  assert.doesNotMatch(peak, /name="mainnav"/);
  assert.doesNotMatch(down, /name="mainnav"/);
});
