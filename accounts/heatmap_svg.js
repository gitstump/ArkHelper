#!/usr/bin/env node
'use strict';

/**
 * heatmap_svg.js
 *
 * Renders the 168-bucket (7 days x 24 hours, UTC) grids from
 * history.js's computePeakTimes/computeDowntimePatterns as inline SVG.
 * No client JS — per-cell tooltips use native SVG <title> elements,
 * which browsers show on hover for free.
 */

const { escapeHtml } = require('./home_page.js');

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const CELL_SIZE = 16;
const GAP = 2;
const LABEL_WIDTH = 32;
const HEADER_HEIGHT = 16;

// ---------------------------------------------------------------------
// Shared grid renderer. `grid` is the 168-entry array from history.js;
// `valueKey` picks which field holds the cell's value (avgPlayers or
// downtimePercent); `colorForValue` maps a value to a fill color.
// ---------------------------------------------------------------------
function renderHeatmapGrid({ grid, valueKey, maxValue, colorForValue, formatValue }) {
  const width = LABEL_WIDTH + 24 * (CELL_SIZE + GAP);
  const height = HEADER_HEIGHT + 7 * (CELL_SIZE + GAP);

  let cells = '';
  for (const cell of grid) {
    const x = LABEL_WIDTH + cell.hour * (CELL_SIZE + GAP);
    const y = HEADER_HEIGHT + cell.dayOfWeek * (CELL_SIZE + GAP);
    const value = cell[valueKey];
    const hasData = value !== null && value !== undefined;
    const fill = hasData ? colorForValue(value, maxValue) : '#241f19';
    const label = `${DAY_LABELS[cell.dayOfWeek]} ${String(cell.hour).padStart(2, '0')}:00 UTC \u2014 ${hasData ? formatValue(value) : 'no data'}`;
    cells += `<rect x="${x}" y="${y}" width="${CELL_SIZE}" height="${CELL_SIZE}" fill="${fill}" rx="2"><title>${escapeHtml(label)}</title></rect>`;
  }

  let dayLabels = '';
  for (let d = 0; d < 7; d += 1) {
    const y = HEADER_HEIGHT + d * (CELL_SIZE + GAP) + CELL_SIZE / 2 + 4;
    dayLabels += `<text x="0" y="${y}" font-size="9" fill="#b8b3a8">${DAY_LABELS[d]}</text>`;
  }

  let hourLabels = '';
  for (let h = 0; h < 24; h += 3) {
    const x = LABEL_WIDTH + h * (CELL_SIZE + GAP);
    hourLabels += `<text x="${x}" y="10" font-size="8" fill="#b8b3a8">${h}</text>`;
  }

  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" font-family="system-ui, sans-serif">${hourLabels}${dayLabels}${cells}</svg>`;
}

// ---------------------------------------------------------------------
// Color scales
// ---------------------------------------------------------------------
function playersColor(value, maxValue) {
  const ratio = maxValue > 0 ? Math.min(1, value / maxValue) : 0;
  // Dark background -> green, scaling with population
  const g = Math.round(60 + ratio * 140);
  return `rgb(30, ${g}, 60)`;
}

function downtimeColor(percent) {
  const ratio = Math.min(1, percent / 100);
  // Dark background -> red, scaling with downtime severity
  const r = Math.round(60 + ratio * 150);
  return `rgb(${r}, 40, 40)`;
}

// ---------------------------------------------------------------------
// Public renderers
// ---------------------------------------------------------------------
function renderPeakTimesHeatmap(grid) {
  const values = grid.map((c) => c.avgPlayers).filter((v) => typeof v === 'number');
  const maxValue = values.length > 0 ? Math.max(...values) : 0;
  return renderHeatmapGrid({
    grid,
    valueKey: 'avgPlayers',
    maxValue,
    colorForValue: playersColor,
    formatValue: (v) => `${v} avg players`,
  });
}

function renderDowntimeHeatmap(grid) {
  return renderHeatmapGrid({
    grid,
    valueKey: 'downtimePercent',
    maxValue: 100,
    colorForValue: downtimeColor,
    formatValue: (v) => `${v}% down`,
  });
}

// A grid where every bucket is empty (no history yet).
function hasAnyData(grid) {
  return grid.some((c) => c.sampleCount > 0 || c.totalRuns > 0);
}

module.exports = {
  renderHeatmapGrid,
  renderPeakTimesHeatmap,
  renderDowntimeHeatmap,
  hasAnyData,
  playersColor,
  downtimeColor,
};
