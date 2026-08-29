'use strict';

// One versioned outcome implementation for the live game, public record and
// independent verifier. A sealed prediction must never acquire a different
// meaning merely because a second consumer reimplemented the comparison.
const OUTCOME_RULE = 'strict-compare-v2';
const SETTLE_RULE = 'pyth-first-observed-after-v3';
const PRIOR_SETTLE_RULE = 'pyth-first-crossing-v2';
const LEGACY_EPS = 0.0004;

const usesPythTransition = rule => rule === SETTLE_RULE || rule === PRIOR_SETTLE_RULE;
const order = (a, b) => a > b ? 1 : a < b ? -1 : 0;

function questionOutcome(s, px, px2) {
  if (s.outcomeRule !== OUTCOME_RULE) {
    if (s.kind === 'thr')
      return Math.abs(px - s.thresh) / s.thresh < LEGACY_EPS ? 'VOID' : (px > s.thresh ? 'YES' : 'NO');
    if (s.kind === 'thrDown')
      return Math.abs(px - s.thresh) / s.thresh < LEGACY_EPS ? 'VOID' : (px < s.thresh ? 'YES' : 'NO');
    if (s.kind === 'range') {
      const d = Math.abs((px - s.entry) / s.entry);
      return Math.abs(d - s.pct) < LEGACY_EPS ? 'VOID' : (d >= s.pct ? 'YES' : 'NO');
    }
    if (s.kind === 'race') {
      const a = (px - s.entry) / s.entry, b = (px2 - s.entry2) / s.entry2;
      return Math.abs(a - b) < LEGACY_EPS ? 'VOID' : (a > b ? 'YES' : 'NO');
    }
    const d = (px - s.entry) / s.entry;
    return Math.abs(d) < LEGACY_EPS ? 'VOID' : (d > 0 ? 'YES' : 'NO');
  }
  let c;
  if (s.kind === 'thr') c = order(px, s.thresh);
  else if (s.kind === 'thrDown') c = -order(px, s.thresh);
  else if (s.kind === 'range') {
    const distance = Math.abs((px - s.entry) / s.entry);
    c = order(distance, s.pct);
  } else if (s.kind === 'race') {
    const a = (px - s.entry) / s.entry, b = (px2 - s.entry2) / s.entry2;
    c = order(a, b);
  } else c = order(px, s.entry);
  return c === 0 ? 'VOID' : c > 0 ? 'YES' : 'NO';
}

module.exports = { OUTCOME_RULE, SETTLE_RULE, PRIOR_SETTLE_RULE,
  LEGACY_EPS, usesPythTransition, order, questionOutcome };
