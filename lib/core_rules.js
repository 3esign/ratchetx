// The frozen rules of RatchetX Core v1, in JavaScript — the same integer math
// as onchain/ratchet-core/programs/ratchet-core/src/lib.rs, function for
// function. Golden vectors printed by the program (`vectors/core-rules-v1.json`)
// pin both sides to one answer in test/test_core_vectors.mjs.
//
// Why integers: the server used to compute XP in floats
// (`Math.round(base * Math.sqrt(stake / 100))`, `Math.round(xp * 1.15)`), and a
// float cannot be frozen into a program. 1.15 is really 1.1499999999999999, so
// 50 * 1.15 rounded to 57 while the rule says 57.5 rounds up to 58. Every
// function below rounds half up exactly, and the server calls these instead
// of its float shortcuts, so the ledger a wallet migrates on-chain with is the
// ledger the program would have written.
'use strict';

const STAKE_MIN = 100;
const STAKE_MAX = 1_000_000_000;
const XP_MULT_CAP = 20;
const XP_CAP_STAKE = STAKE_MIN * XP_MULT_CAP * XP_MULT_CAP;   // 40,000
const HIT_PAYOUT_NUM = 17, HIT_PAYOUT_DEN = 10;                 // 1.7x, floored
const SETTLE_XP = 1;
const STREAK_STEP_C = 15, STREAK_CAP_C = 200;                   // 1 + 0.15*streak, cap 2.00
const RANK_XP = [0, 300, 900, 2200, 5000];
const HORIZONS = [[5, 10], [10, 11], [15, 12], [30, 14], [60, 16], [360, 20], [1440, 24]];
const MAX_CONF_BPS = 200;
const SETTLE_DEADLINE_SECS = 900;
const REVEAL_DEADLINE_SECS = 3600;
const BURN_PER_MILLE = 700;
const PODIUM_PER_MILLE = [500, 300, 200];

// floor(sqrt(n)) for a non-negative integer n < 2^53, exact.
function isqrt(n) {
  if (!Number.isInteger(n) || n < 0) throw new RangeError('isqrt: non-negative integer expected');
  if (n < 2) return n;
  let x = Math.floor(Math.sqrt(n));
  while (x * x > n) x--;
  while ((x + 1) * (x + 1) <= n) x++;
  return x;
}

// max(1, round(base * min(20, sqrt(stake/100)))), rounded exactly: below the
// cap, with S = base^2 * stake, round(sqrt(S)/10) is the largest n with
// (n - 1/2)^2 <= S/100, i.e. 5(2n - 1) <= isqrt(S).
function sealXp(baseXp, stake) {
  if (stake >= XP_CAP_STAKE) return Math.max(1, baseXp * XP_MULT_CAP);
  const s = isqrt(baseXp * baseXp * stake);
  return Math.max(1, Math.floor((Math.floor(s / 5) + 1) / 2));
}

// max(1, round(xp * min(2, 1 + 0.15 * streak))), half up.
function skillXp(xpBase, streak) {
  const multC = Math.min(STREAK_CAP_C, 100 + STREAK_STEP_C * Math.max(0, streak | 0));
  return Math.max(1, Math.floor((xpBase * multC + 50) / 100));
}

// floor(stake * 17 / 10) — never a float product.
function hitPayout(stake) {
  return Math.floor((stake * HIT_PAYOUT_NUM) / HIT_PAYOUT_DEN);
}

function rankOf(xp) { let r = 0; RANK_XP.forEach((t, i) => { if (xp >= t) r = i; }); return r; }
function chambersFor(xp) { return Math.min(4, rankOf(xp) + 1) + 1; }
// min(60, max(30, round(0.15 * windowSeconds)))
function maxSealAge(minutes) { const w = minutes * 60; return Math.min(60, Math.max(30, Math.floor((w * 15 + 50) / 100))); }
function baseXpFor(minutes) { const h = HORIZONS.find(([m]) => m === minutes); return h ? h[1] : null; }

module.exports = {
  STAKE_MIN, STAKE_MAX, XP_MULT_CAP, XP_CAP_STAKE, HIT_PAYOUT_NUM, HIT_PAYOUT_DEN, SETTLE_XP,
  STREAK_STEP_C, STREAK_CAP_C, RANK_XP, HORIZONS, MAX_CONF_BPS, SETTLE_DEADLINE_SECS,
  REVEAL_DEADLINE_SECS, BURN_PER_MILLE, PODIUM_PER_MILLE,
  isqrt, sealXp, skillXp, hitPayout, rankOf, chambersFor, maxSealAge, baseXpFor,
};
