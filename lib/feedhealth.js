// ============================================================
//  lib/feedhealth.js — what the oracle actually did, measured by someone
//  with money on it.
//
//  WHY THIS EXISTS.
//  RATCHET settles real bets off Pyth's sponsored push feeds on Solana. That
//  makes us an unusual kind of consumer: adversarial, continuous, and unable
//  to look away when a feed misbehaves, because a late publish is not a
//  logging nuisance here — it is a voided bet and a refunded stake.
//
//  Nobody publishes third-party measurements of sponsored feed behaviour.
//  The advertised parameters (60s heartbeat, 0.5% deviation trigger) are
//  published; the observed ones are not. We are already sampling every
//  minute for settlement, so the data is a by-product we were throwing away.
//
//  So: keep it, compute it, publish it, and let Pyth read it. Everything in
//  here is measurement, not opinion, and every number carries its own
//  limitation (see LIMITS below) so it cannot be quoted as more than it is.
//
//  LIMITS — stated up front because a metric without its blind spot is a
//  claim, not a measurement:
//    · We sample once per minute. If a feed publishes five times inside our
//      minute we see one. So the gap distribution is a LOWER bound on update
//      frequency and an ACCURATE measure of the stale tail — which is the
//      half that can cost someone a settlement.
//    · Missing samples can be our fault (a cold instance, a dead RPC) as
//      easily as the feed's. We separate the two: `srcMix` says how often we
//      were reading Pyth at all; `misses` counts feeds absent from a sample
//      we did successfully take from Pyth.
//    · Divergence is measured against Coinbase spot, itself one venue with
//      its own lag. Divergence is not error. It is disagreement, and either
//      side can be the one that is right.
// ============================================================
// STRICT reads, deliberately. getJSON() swallows a backend failure and returns
// null, which for a game means "no data yet" and is harmless. Here it would
// mean publishing "0 samples, 0 stale windows" — a confident, flattering, and
// completely false statement about somebody else's infrastructure — at the
// exact moment we could not see. A measurement page must fail loudly instead.
const { getJSONStrict, hall, hincr } = require('./kv.js');
const { bucketKey, FEEDS, SAMPLE_MS } = require('./pxlog.js');
const { MAX_AGE_S } = require('./onchain_px.js');

// THE ATTRIBUTION RULE.
// Two consecutive observations of a feed can only tell us something about the
// feed if they are actually consecutive in time. If we stopped looking for
// forty minutes — a cold serverless fleet, a dead RPC, a stretch on the
// fallback source — the publish_time will have moved a long way, and a naive
// difference reports OUR outage as THEIR stall. That is the single easiest
// way for a page like this to publish a false accusation, so: any pair of
// observations more than two sample intervals apart is thrown away and
// counted as a window we were blind for. Blindness is our failure and it is
// reported as ours.
// One and a half sample intervals: consecutive minutes count, and a single
// skipped look does not. The strict choice on purpose — if we missed a minute
// we cannot tell a real two-minute stall from our own gap, so we decline to
// call it either way and record it as blindness. A feed that is genuinely
// unusable still shows up, in the USABLE column, which is measured directly
// and needs no inference at all.
const BLIND_MS = 1.5 * SAMPLE_MS;

const HEALTH_H = 'g:fh';          // lifetime settlement-consequence counters

/** Settlement consequences. Called from the settle path — best effort, and
 *  never allowed to break a settlement, because a broken settlement is a
 *  real problem and a missing statistic is not. */
async function noteSettle(feed, kind) {
  if (!feed || !kind) return;
  try { await hincr(HEALTH_H, `${kind}:${feed}`, 1); } catch {}
}

const num = a => a.filter(Number.isFinite).sort((x, y) => x - y);
/** Nearest-rank percentile. p in [0,1]. */
function pct(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[i];
}
const r2 = v => (v == null ? null : +v.toFixed(2));

/** Every recorded sample between two timestamps, oldest first. */
async function rowsBetween(from, to) {
  const out = [];
  const start = Math.floor(from / 3600e3) * 3600e3;
  for (let h = start; h <= to; h += 3600e3) {
    const rows = await getJSONStrict(bucketKey(h));   // throws if the store is unreachable
    if (!rows) continue;                               // null here means the hour is genuinely empty
    for (const r of rows) if (r && r.t >= from && r.t <= to) out.push(r);
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/**
 * The report. Pure function of the stored samples plus the lifetime counters.
 * @param {number} hours  window, capped at 72 (buckets live 4 days)
 */
async function report(hours = 24, now = Date.now()) {
  // A nonsense window must land on the documented default, not on the tightest
  // window we happen to support — asking for -5 hours should not silently
  // return a 1-hour report labelled as what you asked for.
  let H = Math.floor(Number(hours));
  if (!Number.isFinite(H) || H < 1) H = 24;
  H = Math.min(72, H);
  const from = now - H * 3600e3;
  const rows = await rowsBetween(from, now);

  // How often were we reading Pyth at all? This is OUR availability, and it
  // has to be separated from the feeds' or every number below is unreadable.
  const srcMix = {};
  for (const r of rows) srcMix[r.src || 'unknown'] = (srcMix[r.src || 'unknown'] || 0) + 1;
  const pythRows = rows.filter(r => r.src === 'pyth-onchain');

  const feeds = {};
  for (const f of FEEDS) {
    const ages = [], confs = [], divs = [], pubs = [];
    let present = 0, misses = 0, lastPub = null, lastPx = null;

    for (const r of pythRows) {
      const px = r[f];
      if (!Number.isFinite(px)) { misses++; continue; }   // Pyth answered, this feed did not
      present++;
      lastPx = px;
      if (r.ag && Number.isFinite(r.ag[f])) ages.push(r.ag[f]);
      if (r.cf && Number.isFinite(r.cf[f])) confs.push(r.cf[f]);
      // (sample time, publish time) pairs — the sample time is what lets us
      // tell a stalled feed from a sleeping observer.
      if (r.pt && Number.isFinite(r.pt[f])) { pubs.push([r.t, r.pt[f]]); lastPub = r.pt[f]; }
      if (r.cb && Number.isFinite(r.cb[f]) && r.cb[f] > 0) {
        divs.push(Math.abs(px - r.cb[f]) / r.cb[f] * 10000);   // bps
      }
    }

    // PUBLISH GAPS — an UPPER BOUND, and only where we can attribute it.
    // Between two adjacent observations the publish_time advanced by d. The
    // feed may have published more than once in that interval and we would
    // only ever see the latest, so d overstates the true gap by at most the
    // spacing of our own samples. We publish it as a bound and label it one.
    let blind = 0, rewinds = 0;
    const gaps = [];
    for (let i = 1; i < pubs.length; i++) {
      const dt = pubs[i][0] - pubs[i - 1][0];
      if (dt > BLIND_MS) { blind++; continue; }          // we were not looking: not their gap
      const d = pubs[i][1] - pubs[i - 1][1];
      if (d > 0) gaps.push(d);
      else if (d < 0) rewinds++;                         // publish_time went backwards; should be 0
    }
    const gs = num(gaps);
    const as = num(ages), cs = num(confs), ds = num(divs);

    feeds[f] = {
      account: null,                       // filled by the caller that knows ACCOUNTS
      samples: present,
      misses,                              // Pyth read OK, this feed unusable
      coverage: pythRows.length ? r2(present / pythRows.length * 100) : null,
      updates: gs.length,                  // publish_time advances we could attribute
      blindWindows: blind,                 // OUR gaps, kept out of every figure above
      rewinds,                             // publish_time moving backwards: never expected
      gapMedS: pct(gs, 0.5), gapP95S: pct(gs, 0.95), gapMaxS: gs.length ? gs[gs.length - 1] : null,
      // Attributable intervals longer than our own freshness bound. An upper
      // bound like every gap figure, and the one that actually costs money.
      staleWindows: gs.filter(g => g > MAX_AGE_S).length,
      ageMedS: pct(as, 0.5), ageP95S: pct(as, 0.95), ageMaxS: as.length ? as[as.length - 1] : null,
      confMedBps: r2(pct(cs, 0.5)), confP95Bps: r2(pct(cs, 0.95)), confMaxBps: r2(cs.length ? cs[cs.length - 1] : null),
      divSamples: ds.length,
      divMedBps: r2(pct(ds, 0.5)), divP95Bps: r2(pct(ds, 0.95)), divMaxBps: r2(ds.length ? ds[ds.length - 1] : null),
      lastPublish: lastPub, lastPx,
    };
  }

  // Also unguarded: if we cannot read the counters we do not get to print zero.
  const counters = (await hall(HEALTH_H)) || {};
  const settle = {};
  for (const f of FEEDS) {
    settle[f] = {
      settled: Number(counters[`set:${f}`]) || 0,
      deferred: Number(counters[`wait:${f}`]) || 0,   // expiry passed, no sample yet
      voided: Number(counters[`void:${f}`]) || 0,     // grace closed with no sample: refunded
    };
  }

  const expected = Math.round(H * 3600e3 / 60_000);
  return {
    windowHours: H, from, to: now,
    samples: rows.length, expectedSamples: expected,
    ourDutyPct: expected ? r2(rows.length / expected * 100) : null,
    srcMix, pythSamples: pythRows.length,
    maxAgeS: MAX_AGE_S,
    feeds, settle,
    blindMs: BLIND_MS,
    limits: [
      'Gap figures are an UPPER BOUND. We sample once a minute and only ever see a feed’s latest publish_time, so an interval we measure may contain publishes we never saw.',
      'Gaps are only counted between observations less than ' + (BLIND_MS / 1000) + 's apart. Anything wider means we stopped looking, and is counted as a blind window of ours instead of a stall of theirs.',
      'Observed age is truncated by our own filter: a read older than ' + MAX_AGE_S + 's is discarded, so it lands in misses rather than in the age distribution.',
      'ourDutyPct is OUR sampling coverage, not the feeds’ uptime — a serverless instance that never woke up records nothing.',
      'misses counts a feed unusable in a sample where Pyth itself read fine (stale beyond ' + MAX_AGE_S + 's, wrong owner, wrong feed id, or account missing).',
      'Divergence is measured against Coinbase spot every 10 minutes. It is disagreement between two sources, not error in either.',
      'settle counters are lifetime totals from the moment this measurement shipped, not windowed.',
    ],
  };
}

module.exports = { report, noteSettle, rowsBetween, pct, HEALTH_H };
