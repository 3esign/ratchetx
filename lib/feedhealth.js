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
const { getJSONStrict, getJSON, setJSON, setJSONEx, setnxJSON, hall, hincr } = require('./kv.js');
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

// HOW MANY OBSERVATIONS BEFORE WE ARE WILLING TO PUBLISH A DISTRIBUTION.
//
// This is not caution for its own sake. Price sampling has been running far
// longer than telemetry has: rows recorded before the observatory shipped
// carry a price but no publish_time, no confidence band and no age. So a feed
// can honestly report "257 usable reads, 100% coverage" while its gap figures
// rest on two observations — and a median computed from two observations is
// not a median, it is a number with a decimal point on it.
//
// Publishing "ETH median gap 103s" off one pair, on a page whose entire claim
// is that it measures somebody else's infrastructure carefully, would be
// worse than publishing nothing. Below these thresholds the statistic is
// withheld and the count is shown instead, so a reader sees a page that is
// still warming up rather than a page that is confidently wrong.
const MIN_OBS = 30;   // half an hour of telemetry before gap/age/confidence
const MIN_DIV = 6;    // an hour of ten-minute cross-checks before divergence
const MIN_FOLD_DAYS = 3;  // days before an all-time "typical" figure is published

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

/** Every recorded sample in the HALF-OPEN interval [from, to), oldest first.
 *
 *  Half-open, and it matters more than it looks. With an inclusive end, the
 *  sample landing exactly on midnight belongs to two days at once: it is
 *  counted in both daily rollups, and — worse — a day with no samples of its
 *  own borrows that one row from the next day and stops looking empty. A day
 *  we never observed must produce no summary at all, not a summary of one
 *  minute that happened after it ended. */
async function rowsBetween(from, to) {
  const out = [];
  const start = Math.floor(from / 3600e3) * 3600e3;
  for (let h = start; h < to + 3600e3; h += 3600e3) {
    const rows = await getJSONStrict(bucketKey(h));   // throws if the store is unreachable
    if (!rows) continue;                               // null here means the hour is genuinely empty
    for (const r of rows) if (r && r.t >= from && r.t < to) out.push(r);
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/**
 * Everything measurable about one window of samples. Pure: give it two
 * timestamps and it reads the record between them. Both the live report and
 * the durable daily rollup are built from this, so a day summarised months
 * ago was computed by exactly the same code as the last hour.
 */
async function computeWindow(from, to) {
  const rows = await rowsBetween(from, to);

  // How often were we reading Pyth at all? This is OUR availability, and it
  // has to be separated from the feeds' or every number below is unreadable.
  const srcMix = {};
  for (const r of rows) srcMix[r.src || 'unknown'] = (srcMix[r.src || 'unknown'] || 0) + 1;
  const pythRows = rows.filter(r => r.src === 'pyth-onchain');

  const feeds = {};
  for (const f of FEEDS) {
    const ages = [], confs = [], divs = [], pubs = [];
    let present = 0, misses = 0, lastPub = null, lastPx = null;
    // Reads that carried telemetry, as opposed to reads that carried a price.
    // The gap between these two numbers is the age of the observatory itself.
    let telemetry = 0;

    for (const r of pythRows) {
      const px = r[f];
      if (!Number.isFinite(px)) { misses++; continue; }   // Pyth answered, this feed did not
      present++;
      lastPx = px;
      if (r.ag && Number.isFinite(r.ag[f])) { ages.push(r.ag[f]); telemetry++; }
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
    // Withheld, not zeroed: a thin statistic is reported as absent so it can
    // never be quoted, and the observation count is published beside it so a
    // reader can see exactly why.
    const thin = telemetry < MIN_OBS;
    const thinDiv = ds.length < MIN_DIV;
    const g = v => (thin ? null : v);
    const dv = v => (thinDiv ? null : v);

    feeds[f] = {
      account: null,                       // filled by the caller that knows ACCOUNTS
      samples: present,
      misses,                              // Pyth read OK, this feed unusable
      coverage: pythRows.length ? r2(present / pythRows.length * 100) : null,
      telemetry,                           // reads carrying publish_time/confidence/age
      thin, minObs: MIN_OBS,               // below MIN_OBS the distributions are withheld
      updates: gs.length,                  // publish_time advances we could attribute
      blindWindows: blind,                 // OUR gaps, kept out of every figure above
      rewinds,                             // publish_time moving backwards: never expected
      gapMedS: g(pct(gs, 0.5)), gapP95S: g(pct(gs, 0.95)), gapMaxS: g(gs.length ? gs[gs.length - 1] : null),
      // Attributable intervals longer than our own freshness bound. An upper
      // bound like every gap figure, and the one that actually costs money.
      staleWindows: thin ? null : gs.filter(x => x > MAX_AGE_S).length,
      ageMedS: g(pct(as, 0.5)), ageP95S: g(pct(as, 0.95)), ageMaxS: g(as.length ? as[as.length - 1] : null),
      confMedBps: g(r2(pct(cs, 0.5))), confP95Bps: g(r2(pct(cs, 0.95))), confMaxBps: g(r2(cs.length ? cs[cs.length - 1] : null)),
      divSamples: ds.length,
      divMedBps: dv(r2(pct(ds, 0.5))), divP95Bps: dv(r2(pct(ds, 0.95))), divMaxBps: dv(r2(ds.length ? ds[ds.length - 1] : null)),
      lastPublish: lastPub, lastPx,
    };
  }

  const expected0 = Math.max(1, Math.round((to - from) / 60_000));
  return {
    from, to,
    samples: rows.length, expectedSamples: expected0,
    ourDutyPct: r2(rows.length / expected0 * 100),
    srcMix, pythSamples: pythRows.length,
    feeds,
  };
}

/**
 * The live report: a window ending now, plus the lifetime settlement counters
 * and the limits that travel with every number.
 */
async function report(hours = 24, now = Date.now()) {
  // A nonsense window must land on the documented default, not on the tightest
  // window we happen to support — asking for -5 hours should not silently
  // return a 1-hour report labelled as what you asked for.
  let H = Math.floor(Number(hours));
  if (!Number.isFinite(H) || H < 1) H = 24;
  H = Math.min(72, H);
  const from = now - H * 3600e3;
  const w = await computeWindow(from, now);
  const feeds = w.feeds;

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

  return {
    windowHours: H, from, to: now,
    samples: w.samples, expectedSamples: w.expectedSamples,
    ourDutyPct: w.ourDutyPct,
    srcMix: w.srcMix, pythSamples: w.pythSamples,
    maxAgeS: MAX_AGE_S,
    feeds, settle,
    blindMs: BLIND_MS, minObs: MIN_OBS, minDiv: MIN_DIV,
    limits: [
      'Price sampling predates this telemetry. A feed can report many usable reads while its gap, age and confidence figures rest on far fewer — `telemetry` is the count those distributions actually use, and below ' + MIN_OBS + ' of them the distributions are withheld rather than published thin.',
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

// ============================================================
//  THE ROLLUP — the only reason any of this is worth more tomorrow.
//
//  THE PROBLEM IT SOLVES, WHICH IS EASY TO MISS.
//  The raw price buckets carry a four-day TTL. They have to: they exist for
//  settlement, the longest chamber is 24 hours, and keeping every minute of
//  every feed forever would be a database made of noise. But it means the
//  live report can never look back further than 72 hours, and it means that
//  measuring carefully for a month produces exactly the same page as
//  measuring carefully for three days. The evidence expires faster than the
//  claim we want to make with it.
//
//  So each completed day is summarised once, while its buckets are still
//  alive, and the summary is kept for a year. The raw minutes still expire —
//  we are not hoarding them — but the shape of the day survives: how much we
//  sampled, what each feed's gaps and confidence bands looked like, what was
//  unusable, what went stale.
//
//  This is what turns "here is the last 24 hours" into "here is every day
//  since we started, and here is the worst thing we have ever seen." One is
//  a demo. The other is a reference, and it can only be built by having
//  started early. A day not rolled up before its buckets expire is a day
//  that cannot be recovered by any amount of later effort.
// ============================================================
const DAY_TTL = 400 * 24 * 3600;      // a year and change
const DAY_INDEX = 'g:fh:days';
const dayKey = d => `fh:d:${d}`;
const dayOf = ts => new Date(ts).toISOString().slice(0, 10);
const rgate = globalThis.__ratchet_fhgate || (globalThis.__ratchet_fhgate = { t: 0 });

/** Summarise one complete UTC day and keep it. Idempotent: the first writer
 *  wins and later callers cost one read. Returns true if WE wrote it. */
async function rollupDay(day, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const start = Date.parse(day + 'T00:00:00Z');
  if (!Number.isFinite(start)) return false;
  const end = start + 86400e3;
  if (end > now) return false;                       // never summarise a day still running
  if (await getJSONStrict(dayKey(day))) return false;

  const w = await computeWindow(start, end);
  if (!w.samples) return false;                      // a day we never saw is a gap, not a zero

  // Trimmed on purpose. A daily row is a summary, not a second copy of the
  // record — the raw minutes are still served from /api/game?action=path
  // while they live, and after that this is what remains.
  const feeds = {};
  for (const f of FEEDS) {
    const d = w.feeds[f];
    feeds[f] = { samples: d.samples, misses: d.misses, coverage: d.coverage,
      telemetry: d.telemetry, thin: d.thin, updates: d.updates,
      blindWindows: d.blindWindows, rewinds: d.rewinds,
      gapMedS: d.gapMedS, gapP95S: d.gapP95S, gapMaxS: d.gapMaxS,
      staleWindows: d.staleWindows,
      ageMedS: d.ageMedS, ageMaxS: d.ageMaxS,
      confMedBps: d.confMedBps, confP95Bps: d.confP95Bps,
      divSamples: d.divSamples, divMedBps: d.divMedBps, divMaxBps: d.divMaxBps };
  }
  const row = { d: day, samples: w.samples, expectedSamples: w.expectedSamples,
    ourDutyPct: w.ourDutyPct, pythSamples: w.pythSamples, srcMix: w.srcMix,
    minObs: MIN_OBS, feeds, rolledAt: now };

  if (!(await setnxJSON(`fhlock:${day}`, { t: now }, DAY_TTL))) return false;
  await setJSONEx(dayKey(day), row, DAY_TTL);
  const idx = (await getJSON(DAY_INDEX)) || [];
  if (!idx.includes(day)) { idx.push(day); idx.sort(); await setJSON(DAY_INDEX, idx.slice(-400)); }
  return true;
}

/** Roll up any complete day we can still see. Bounded by the bucket TTL:
 *  past three days back there is nothing left to summarise, which is exactly
 *  why this must run regularly rather than when someone remembers. */
async function ensureRollups(now = Date.now()) {
  if (now - rgate.t < 10 * 60_000) return 0;
  rgate.t = now;
  let made = 0;
  try {
    for (let back = 1; back <= 3; back++) {
      if (await rollupDay(dayOf(now - back * 86400e3), now)) made++;
    }
  } catch { rgate.t = now - 9 * 60_000; }
  return made;
}

/** Every day we kept, oldest first. */
async function history(days = 90) {
  const idx = (await getJSONStrict(DAY_INDEX)) || [];
  const want = idx.slice(-Math.max(1, Math.min(400, days)));
  const out = [];
  for (const d of want) {
    const r = await getJSONStrict(dayKey(d));
    if (r) out.push(r);
  }
  return out;
}

/** The all-time view, folded out of the daily rows. This is the number that
 *  can only get better by waiting, and the reason the rollup exists. */
function foldHistory(rows) {
  if (!rows || !rows.length) return null;
  const feeds = {};
  for (const f of FEEDS) {
    let samples = 0, misses = 0, telemetry = 0, stale = 0, blind = 0, rewinds = 0;
    let worstGap = null, worstGapDay = null, worstDiv = null, worstDivDay = null;
    const confs = [];
    for (const r of rows) {
      const d = (r.feeds || {})[f];
      if (!d) continue;
      samples += d.samples || 0; misses += d.misses || 0; telemetry += d.telemetry || 0;
      stale += d.staleWindows || 0; blind += d.blindWindows || 0; rewinds += d.rewinds || 0;
      if (d.gapMaxS != null && (worstGap == null || d.gapMaxS > worstGap)) { worstGap = d.gapMaxS; worstGapDay = r.d; }
      if (d.divMaxBps != null && (worstDiv == null || d.divMaxBps > worstDiv)) { worstDiv = d.divMaxBps; worstDivDay = r.d; }
      if (d.confMedBps != null) confs.push(d.confMedBps);
    }
    // TWO CAVEATS, BOTH PUBLISHED RATHER THAN BURIED.
    // (a) This is a median OF DAILY MEDIANS, not the median of every reading.
    //     It is a robust summary, but it is not the population median and
    //     the page has to say which one it is.
    // (b) With one or two days folded it is one day's median wearing the
    //     word "typical", sitting in a row whose telemetry count is summed
    //     across all days and therefore reads as depth. That is exactly the
    //     shape of the bug this file already fixed one layer down, so it
    //     gets the same treatment: withheld, with the backing count shown.
    const cs = num(confs);
    feeds[f] = { samples, misses, telemetry, staleWindows: stale, blindWindows: blind, rewinds,
      coverage: samples + misses ? r2(samples / (samples + misses) * 100) : null,
      worstGapS: worstGap, worstGapDay, worstDivBps: worstDiv, worstDivDay,
      confDays: cs.length,
      confTypicalBps: cs.length >= MIN_FOLD_DAYS ? r2(pct(cs, 0.5)) : null };
  }
  return { days: rows.length, minFoldDays: MIN_FOLD_DAYS,
    first: rows[0].d, last: rows[rows.length - 1].d,
    samples: rows.reduce((a, r) => a + (r.samples || 0), 0),
    dutyBestPct: rows.reduce((a, r) => Math.max(a, r.ourDutyPct || 0), 0),
    feeds };
}

module.exports = { report, noteSettle, rowsBetween, pct, HEALTH_H,
  computeWindow, rollupDay, ensureRollups, history, foldHistory, DAY_INDEX, dayKey };
