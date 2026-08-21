// ============================================================
//  lib/vol.js — realised volatility, measured.
//
//  WHY THIS EXISTS.
//  The Warden — the house's own stated-probability line — used to compute its
//  confidence from a hardcoded table:
//
//      const typicalHourly = { SOL: 0.0075, BTC: 0.0045, ETH: 0.0065 }[feed];
//      const zed = pct / (typicalHourly * Math.sqrt(mins / 60));
//
//  Every input on the right is a constant, so the output was a constant too:
//  36% on SOL, 35% on BTC, 35% on ETH, every hour, forever. It never looked at
//  the market. Because all three sit below 50 it always leaned the same way,
//  and over thirty settled calls it was right six times — a result about as
//  likely as 1 in 1,400 if it were flipping a coin. The reason text told
//  players the number came from "this pair's typical realised volatility",
//  which was not true of anything being computed.
//
//  We now keep a per-minute price record for settlement. So the volatility can
//  simply be measured, from the same samples a player can download and check.
//
//  METHOD, AND ITS LIMITS.
//  Samples are irregular — the sampler only runs when a request lands — so a
//  plain standard deviation of returns would silently mix one-minute moves
//  with ten-minute ones and understate the vol. Instead each consecutive pair
//  contributes r²/Δt, an estimate of variance PER UNIT TIME, and those are
//  averaged. That is the standard treatment for unevenly spaced observations
//  and it is unbiased under a random walk.
//
//  It is still realised, backward-looking volatility. It says what the market
//  has been doing, not what it will do, and it will be wrong exactly when
//  conditions change — which is the honest weakness of every such estimate and
//  is stated on the page rather than hidden in here.
// ============================================================
const { pathFor } = require('./pxlog.js');

// Below this the estimate is noise and the Warden declines to post a line at
// all. Same rule as everywhere else here: withhold rather than publish thin.
const MIN_SAMPLES = 40;
// A pair further apart than this spans one of our own sampling outages. The
// return across it is real but the elapsed time is dominated by our downtime,
// so it is dropped rather than allowed to flatten the estimate.
const MAX_DT_MS = 15 * 60_000;
const MIN_DT_MS = 20_000;

/** Standard normal CDF. Abramowitz & Stegun 7.1.26 on erf; plenty for a
 *  stated probability rounded to whole percent. */
function normCdf(z) {
  const s = z < 0 ? -1 : 1, x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + s * y);
}

/**
 * Realised volatility for one feed, from the price record.
 *
 * @returns {{ok:true, sigmaPerRootMs:number, pairs:number, spanMs:number,
 *            hourlyPct:number, from:number, to:number}}
 *        | {ok:false, reason:string, pairs:number}
 */
async function realisedVol(feed, hours = 24, now = Date.now()) {
  const from = now - Math.max(1, hours) * 3600e3;
  const rows = await pathFor(feed, from, now);
  if (rows.length < MIN_SAMPLES) {
    return { ok: false, reason: `only ${rows.length} samples in ${hours}h; need ${MIN_SAMPLES}`, pairs: 0 };
  }

  let sum = 0, pairs = 0;
  for (let i = 1; i < rows.length; i++) {
    const dt = rows[i][0] - rows[i - 1][0];
    if (dt < MIN_DT_MS || dt > MAX_DT_MS) continue;      // too close to be independent, or across our own gap
    const a = rows[i - 1][1], b = rows[i][1];
    if (!(a > 0) || !(b > 0)) continue;
    const r = Math.log(b / a);
    if (!Number.isFinite(r)) continue;
    sum += (r * r) / dt;                                  // variance per millisecond
    pairs++;
  }
  if (pairs < MIN_SAMPLES) {
    return { ok: false, reason: `only ${pairs} usable pairs; need ${MIN_SAMPLES}`, pairs };
  }

  const varPerMs = sum / pairs;
  const sigmaPerRootMs = Math.sqrt(varPerMs);
  if (!Number.isFinite(sigmaPerRootMs) || sigmaPerRootMs <= 0) {
    return { ok: false, reason: 'degenerate estimate', pairs };
  }
  return { ok: true, sigmaPerRootMs, pairs,
    spanMs: rows[rows.length - 1][0] - rows[0][0],
    hourlyPct: sigmaPerRootMs * Math.sqrt(3600e3) * 100,
    from: rows[0][0], to: rows[rows.length - 1][0] };
}

/** Volatility over a window of `ms`, as a fraction (0.012 = 1.2%). */
const sigmaOver = (v, ms) => v.sigmaPerRootMs * Math.sqrt(ms);

/**
 * P(price at expiry > threshold), assuming zero drift in log returns.
 *
 * ln(S_T/S_0) ~ N(0, sigma^2 T)  ->  P(S_T > K) = 1 - Phi( ln(K/S_0) / sigma_T )
 *
 * Zero drift is a choice, not a discovery: estimating drift from a few days of
 * minute bars produces a number dominated by whatever the last rally did, and
 * a house line that quietly extrapolates the recent trend is exactly the kind
 * of thing this game exists not to do.
 */
function probAbove(spot, thresh, sigmaWindow) {
  if (!(spot > 0) || !(thresh > 0) || !(sigmaWindow > 0)) return null;
  return 1 - normCdf(Math.log(thresh / spot) / sigmaWindow);
}

/** The threshold sitting `k` standard deviations from spot over the window. */
const threshAtSigma = (spot, sigmaWindow, k) => spot * Math.exp(k * sigmaWindow);

module.exports = { realisedVol, sigmaOver, probAbove, threshAtSigma, normCdf,
  MIN_SAMPLES, MAX_DT_MS };
