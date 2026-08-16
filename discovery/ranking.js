#!/usr/bin/env node
'use strict';

/**
 * ranking.js
 *
 * Pure composite rank score for one server. Callers gather the inputs
 * (uptime %, ping, average population %, history age) and pass them in;
 * this module does not touch the DB, the network, or the clock.
 *
 * Weights live here as named constants so they can be retuned in one
 * place without hunting through callers.
 */

const WEIGHTS = {
  RELIABILITY: 40,
  CONNECTION: 25,
  ACTIVITY: 25,
  CONFIDENCE: 10,
};

const RANKING_WINDOW_DAYS = 7;

const PING_FULL_MS = 60; // at or below this: full connection points
const PING_MID_MS = 150; // linear falloff from full to PING_MID_FRACTION
const PING_HIGH_MS = 300; // linear falloff from mid fraction to PING_HIGH_FRACTION
const PING_MID_FRACTION = 0.6; // 60% of connection points at 150ms
const PING_HIGH_FRACTION = 0.2; // 20% of connection points at 300ms
const PING_ABOVE_FRACTION = 0.1; // 10% of connection points above 300ms

function round1(n) {
  return Math.round(n * 10) / 10;
}

function clampPercent(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

function clampNonNegative(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return value;
}

function lerp(from, to, t) {
  return from + (to - from) * t;
}

function scoreReliability(uptimePercent) {
  return (clampPercent(uptimePercent) / 100) * WEIGHTS.RELIABILITY;
}

function scoreConnection(pingMs) {
  if (typeof pingMs !== 'number' || !Number.isFinite(pingMs) || pingMs < 0) return 0;

  const full = WEIGHTS.CONNECTION;
  if (pingMs <= PING_FULL_MS) return full;

  if (pingMs <= PING_MID_MS) {
    const t = (pingMs - PING_FULL_MS) / (PING_MID_MS - PING_FULL_MS);
    return full * lerp(1, PING_MID_FRACTION, t);
  }

  if (pingMs <= PING_HIGH_MS) {
    const t = (pingMs - PING_MID_MS) / (PING_HIGH_MS - PING_MID_MS);
    return full * lerp(PING_MID_FRACTION, PING_HIGH_FRACTION, t);
  }

  return full * PING_ABOVE_FRACTION;
}

function scoreActivity(avgPopulationPercent) {
  return (clampPercent(avgPopulationPercent) / 100) * WEIGHTS.ACTIVITY;
}

function scoreConfidence(historyAgeDays) {
  const age = clampNonNegative(historyAgeDays);
  const fraction = Math.min(1, age / RANKING_WINDOW_DAYS);
  return fraction * WEIGHTS.CONFIDENCE;
}

/**
 * @param {{ uptimePercent?: number, pingMs?: number|null, avgPopulationPercent?: number, historyAgeDays?: number }} input
 * @returns {{ rankScore: number, components: { reliability: number, connection: number, activity: number, confidence: number } }}
 */
function scoreServer(input = {}) {
  const reliability = round1(scoreReliability(input.uptimePercent));
  const connection = round1(scoreConnection(input.pingMs));
  const activity = round1(scoreActivity(input.avgPopulationPercent));
  const confidence = round1(scoreConfidence(input.historyAgeDays));
  return {
    rankScore: round1(reliability + connection + activity + confidence),
    components: { reliability, connection, activity, confidence },
  };
}

module.exports = {
  WEIGHTS,
  RANKING_WINDOW_DAYS,
  PING_FULL_MS,
  PING_MID_MS,
  PING_HIGH_MS,
  PING_MID_FRACTION,
  PING_HIGH_FRACTION,
  PING_ABOVE_FRACTION,
  scoreServer,
};
