// THE OBSERVATORY publishes numbers about somebody else's infrastructure.
// That raises the bar: a statistic that is wrong here is not a bug in a game,
// it is a false claim about Pyth. These tests exist to make each published
// figure fail loudly rather than quietly drift.
import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const fresh = () => {
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  globalThis.__ratchet_mem = new Map();
  globalThis.__ratchet_pxgate = { t: 0, x: 0 };
  return { fh: require('../lib/feedhealth.js'), px: require('../lib/pxlog.js'), kv: require('../lib/kv.js') };
};

const T0 = Date.UTC(2026, 7, 20, 6, 0, 0);   // fixed: no Date.now() in fixtures

/** Write samples straight into the buckets pxlog reads. */
async function seed(kv, px, rows) {
  const by = {};
  for (const r of rows) (by[px.bucketKey(r.t)] ||= []).push(r);
  for (const [k, v] of Object.entries(by)) await kv.setJSONEx(k, v.sort((a, b) => a.t - b.t), 9999);
}

// ---- 1. a clean 60s heartbeat reads back as a clean 60s heartbeat ----
{
  const { fh, px, kv } = fresh();
  const rows = [];
  for (let i = 0; i < 60; i++) {
    const t = T0 + i * 60_000;
    rows.push({ t, src: 'pyth-onchain', SOL: 200 + i * 0.1, BTC: 60000,
      ag: { SOL: 3, BTC: 5 }, cf: { SOL: 1.2, BTC: 0.8 }, pt: { SOL: Math.floor(t / 1000) - 3, BTC: Math.floor(t / 1000) - 5 } });
  }
  await seed(kv, px, rows);
  const r = await fh.report(2, T0 + 60 * 60_000);
  const s = r.feeds.SOL;
  assert.equal(s.samples, 60, 'every sample counted');
  assert.equal(s.misses, 0, 'no misses on a clean run');
  assert.equal(s.coverage, 100, 'coverage 100%');
  assert.equal(s.updates, 59, 'fifty-nine attributable advances from sixty samples');
  assert.equal(s.blindWindows, 0, 'we never stopped looking');
  assert.equal(s.rewinds, 0, 'publish_time never went backwards');
  assert.equal(s.gapMedS, 60, 'median gap is the 60s heartbeat');
  assert.equal(s.gapMaxS, 60, 'worst gap is the 60s heartbeat');
  assert.equal(s.staleWindows, 0, 'nothing stale');
  assert.equal(s.confMedBps, 1.2, 'confidence band reported in bps');
  assert.equal(s.divSamples, 0, 'no cross-checks recorded, so no divergence claimed');
  assert.equal(s.divMedBps, null, 'divergence is null, not zero, when unmeasured');
  console.log('clean heartbeat -> 60s median, 0 stale, conf 1.2bps, divergence unclaimed');
}

// ---- 2. A STALL MUST SHOW UP. This is the number that costs money. ----
{
  const { fh, px, kv } = fresh();
  const rows = [];
  // 10 clean minutes, then the feed freezes for 8 minutes, then resumes
  let pub = Math.floor(T0 / 1000);
  for (let i = 0; i < 30; i++) {
    const t = T0 + i * 60_000;
    if (i < 10 || i >= 18) pub = Math.floor(t / 1000) - 2;   // fresh
    rows.push({ t, src: 'pyth-onchain', SOL: 200, ag: { SOL: Math.floor(t / 1000) - pub },
      cf: { SOL: 1 }, pt: { SOL: pub } });
  }
  await seed(kv, px, rows);
  const s = (await fh.report(2, T0 + 30 * 60_000)).feeds.SOL;
  assert.equal(s.samples, 30, 'all samples present — the feed answered, it just did not move');
  assert.ok(s.updates < 25, `a frozen publish_time is not a new update (${s.updates})`);
  assert.equal(s.blindWindows, 0, 'we were watching the whole time — this one IS theirs');
  assert.ok(s.gapMaxS >= 8 * 60, `the 8-minute stall is visible as the worst gap (${s.gapMaxS}s)`);
  assert.equal(s.staleWindows, 1, 'exactly one window exceeded our freshness bound');
  assert.ok(s.ageMaxS >= 8 * 60, `and the age we read it at reflects it (${s.ageMaxS}s)`);
  assert.equal(s.gapMedS, 60, 'the median is untouched by one tail event — which is why we publish both');
  console.log(`8-minute stall -> gapMax ${s.gapMaxS}s, ageMax ${s.ageMaxS}s, 1 stale window, median still 60s`);
}

// ---- 3. OUR fault must never be reported as THEIRS ----
{
  const { fh, px, kv } = fresh();
  const rows = [];
  for (let i = 0; i < 100; i++) {
    const t = T0 + i * 60_000;
    // a ten-minute stretch on the fallback source: Pyth was not read at all
    const onPyth = i < 40 || i >= 50;
    rows.push(onPyth
      ? { t, src: 'pyth-onchain', SOL: 200, ag: { SOL: 2 }, cf: { SOL: 1 }, pt: { SOL: Math.floor(t / 1000) - 2 } }
      : { t, src: 'coinbase', SOL: 200 });
  }
  await seed(kv, px, rows);
  const r = await fh.report(2, T0 + 100 * 60_000);
  assert.equal(r.samples, 100, 'all our samples counted');
  assert.equal(r.pythSamples, 90, 'only the Pyth reads are attributed to Pyth');
  assert.equal(r.feeds.SOL.samples, 90, 'per-feed stats use the Pyth rows only');
  assert.equal(r.feeds.SOL.coverage, 100, 'coverage is 100% — Pyth was perfect when we asked');
  assert.equal(r.feeds.SOL.misses, 0, 'a fallback minute is not a Pyth miss');
  assert.equal(r.feeds.SOL.gapMaxS, 60, 'and the 10-minute hole in OUR sampling is not reported as their gap');
  assert.equal(r.feeds.SOL.staleWindows, 0, 'our outage produces no stale window for them');
  assert.equal(r.feeds.SOL.blindWindows, 1, 'it is counted as one blind window of ours');
  assert.deepEqual(r.srcMix, { 'pyth-onchain': 90, coinbase: 10 }, 'the mix is published so nobody has to guess');
  assert.ok(r.ourDutyPct != null, 'our own duty cycle is published first');
  console.log('ten minutes on fallback -> 0 misses blamed on Pyth, 1 blind window, srcMix published');
}

// ---- 4. a feed dropped by our own validity checks IS a miss ----
{
  const { fh, px, kv } = fresh();
  const rows = [];
  for (let i = 0; i < 20; i++) {
    const t = T0 + i * 60_000;
    const row = { t, src: 'pyth-onchain', SOL: 200, ag: { SOL: 2 }, cf: { SOL: 1 }, pt: { SOL: Math.floor(t / 1000) - 2 } };
    if (i % 4 === 0) { row.WIF = 2.5; row.ag.WIF = 3; row.cf.WIF = 4; row.pt.WIF = Math.floor(t / 1000) - 3; }
    rows.push(row);   // WIF absent 3 minutes in 4: stale, wrong owner, whatever — unusable
  }
  await seed(kv, px, rows);
  const w = (await fh.report(1, T0 + 20 * 60_000)).feeds.WIF;
  assert.equal(w.samples, 5, 'usable samples counted');
  assert.equal(w.misses, 15, 'unusable reads counted separately, not silently skipped');
  assert.equal(w.coverage, 25, 'coverage says 25% out loud');
  assert.equal(w.gapMaxS, null, 'four-minute-apart looks cannot be differenced into a gap');
  assert.equal(w.blindWindows, 4, 'they are counted as OUR blind windows instead');
  assert.equal(w.telemetry, 5, 'and only five reads carried telemetry at all');
  assert.equal(w.thin, true, 'which is far too few to publish a distribution from');
  console.log('WIF unusable 3 minutes in 4 -> coverage 25%, 15 misses, said plainly');
}

// ---- 4b. THE ATTRIBUTION RULE. Our outage must never become their stall. ----
// This is the failure mode that would turn this page into a false accusation:
// we stop sampling for 40 minutes, the publish_time moves 40 minutes, and a
// naive difference reports a 40-minute Pyth outage that never happened.
{
  const { fh, px, kv } = fresh();
  const rows = [];
  for (let i = 0; i < 90; i++) {
    if (i >= 20 && i < 60) continue;                 // WE go dark for 40 minutes
    const t = T0 + i * 60_000;
    rows.push({ t, src: 'pyth-onchain', SOL: 200, ag: { SOL: 2 },
      cf: { SOL: 1 }, pt: { SOL: Math.floor(t / 1000) - 2 } });
  }
  await seed(kv, px, rows);
  const s = (await fh.report(2, T0 + 90 * 60_000)).feeds.SOL;
  assert.equal(s.gapMaxS, 60, `worst gap must stay 60s, got ${s.gapMaxS}s — a 40-minute lie was avoided`);
  assert.equal(s.staleWindows, 0, 'and no stale window is charged to the feed');
  assert.equal(s.blindWindows, 1, 'the hole is counted, as ours');
  assert.equal(s.samples, 50, 'the samples we did take are still all used');
  console.log('40-minute hole in OUR sampling -> 1 blind window, 0 stale, gapMax still 60s');
}

// ---- 5. divergence is measured against the independent quote, in bps ----
{
  const { fh, px, kv } = fresh();
  const rows = [];
  for (let i = 0; i < 60; i++) {
    const t = T0 + i * 60_000;
    const row = { t, src: 'pyth-onchain', SOL: 100, ag: { SOL: 1 }, cf: { SOL: 1 }, pt: { SOL: Math.floor(t / 1000) - 1 } };
    if (i % 10 === 0) row.cb = { SOL: 100 };   // 0 bps, six of them
    if (i === 35) row.cb = { SOL: 100.5 };     // ~49.75 bps below pyth
    rows.push(row);
  }
  await seed(kv, px, rows);
  const s = (await fh.report(2, T0 + 60 * 60_000)).feeds.SOL;
  assert.equal(s.divSamples, 7, 'only the minutes with a cross-check count');
  assert.equal(s.divMedBps, 0, 'the median of seven, six of which agreed exactly');
  assert.ok(Math.abs(s.divMaxBps - 49.75) < 0.1, `max divergence ~49.75bps, got ${s.divMaxBps}`);
  console.log(`divergence -> 7 cross-checks, max ${s.divMaxBps}bps, measured not asserted`);
}

// ---- 5b. A THIN STATISTIC IS WITHHELD, NOT PUBLISHED THIN ----
// This shipped wrong once and was caught on the live site: price sampling had
// been running for months, so a feed reported 257 usable reads and 100%
// coverage while its "median gap" rested on a single pair of observations.
// A median off one pair is not a median, and printing one on a page that
// claims to measure somebody else's infrastructure is worse than printing
// nothing at all.
{
  const { fh, px, kv } = fresh();
  const rows = [];
  for (let i = 0; i < 50; i++) {
    const t = T0 + i * 60_000;
    // A long history of PRICES, but telemetry only on the last handful —
    // exactly the shape of a fleet that sampled long before this page shipped.
    const row = { t, src: 'pyth-onchain', SOL: 200 + i * 0.1 };
    if (i >= 47) { row.ag = { SOL: 3 }; row.cf = { SOL: 1.4 }; row.pt = { SOL: Math.floor(t / 1000) - 3 }; }
    rows.push(row);
  }
  await seed(kv, px, rows);
  const s = (await fh.report(2, T0 + 50 * 60_000)).feeds.SOL;
  assert.equal(s.samples, 50, 'every usable price read is still counted — that part is real');
  assert.equal(s.coverage, 100, 'and coverage is genuinely 100%');
  assert.equal(s.telemetry, 3, 'but only three reads carried telemetry');
  assert.equal(s.thin, true, 'so the feed is flagged thin');
  assert.equal(s.gapMedS, null, 'and NO median gap is published');
  assert.equal(s.gapMaxS, null, 'no worst gap');
  assert.equal(s.ageMedS, null, 'no age distribution');
  assert.equal(s.confMedBps, null, 'no confidence distribution');
  assert.equal(s.staleWindows, null, 'and stale windows is null, not a flattering zero');
  console.log('50 price reads but 3 telemetry reads -> every distribution withheld, counts kept');
}

// ---- 5c. and it publishes again the moment there is enough ----
{
  const { fh, px, kv } = fresh();
  const rows = [];
  for (let i = 0; i < 50; i++) {
    const t = T0 + i * 60_000;
    rows.push({ t, src: 'pyth-onchain', SOL: 200, ag: { SOL: 3 }, cf: { SOL: 1.4 }, pt: { SOL: Math.floor(t / 1000) - 3 } });
  }
  await seed(kv, px, rows);
  const s = (await fh.report(2, T0 + 50 * 60_000)).feeds.SOL;
  assert.equal(s.thin, false, 'fifty telemetry reads clears the threshold');
  assert.equal(s.gapMedS, 60, 'and the distribution appears');
  assert.equal(s.staleWindows, 0, 'zero stale windows is now a real zero');
  console.log('50 telemetry reads -> distributions published, zero means zero');
}

// ---- 6. settlement consequences are counted per feed ----
{
  const { fh } = fresh();
  await fh.noteSettle('SOL', 'set');
  await fh.noteSettle('SOL', 'set');
  await fh.noteSettle('SOL', 'wait');
  await fh.noteSettle('BTC', 'void');
  const r = await fh.report(1, T0);
  assert.equal(r.settle.SOL.settled, 2, 'settled counted');
  assert.equal(r.settle.SOL.deferred, 1, 'deferral counted');
  assert.equal(r.settle.SOL.voided, 0, 'no SOL voids');
  assert.equal(r.settle.BTC.voided, 1, 'the void is attributed to the feed that caused it');
  console.log('settlement consequences -> per-feed set/wait/void counters');
}

// ---- 7. noteSettle must never be able to break a settlement ----
{
  const { fh } = fresh();
  const kv = require('../lib/kv.js');
  const real = kv.hincr;
  kv.hincr = async () => { throw new Error('redis down'); };
  await fh.noteSettle('SOL', 'set');            // must not throw
  kv.hincr = real;
  await fh.noteSettle('', 'set');               // no feed: no-op, no throw
  await fh.noteSettle('SOL', '');
  console.log('telemetry failure is swallowed — a missing statistic never costs a settlement');
}

// ---- 8. THE TELEMETRY MUST NOT DISTURB SETTLEMENT. ----
// New row keys are lowercase two-letter; feed symbols are uppercase. If that
// ever collides, settle() reads a confidence band as a price.
{
  const { fh, px, kv } = fresh();
  const RESERVED = ['t', 'src', 'ag', 'cf', 'pt', 'cb'];
  for (const f of px.FEEDS) assert.ok(!RESERVED.includes(f), `feed symbol ${f} collides with a telemetry key`);
  const t = T0 + 30_000;
  await seed(kv, px, [{ t, src: 'pyth-onchain', SOL: 123.45, ag: { SOL: 4 }, cf: { SOL: 2 }, pt: { SOL: 1 }, cb: { SOL: 999 } }]);
  const at = await px.priceAt(T0, T0 + 60_000);
  assert.ok(at.row, 'settlement still finds the sample');
  assert.equal(at.row.SOL, 123.45, 'and reads the PRICE, not the cross-check or the band');
  const path = await px.pathFor('SOL', T0, T0 + 60_000);
  assert.deepEqual(path, [[t, 123.45]], 'the path is unchanged by telemetry');
  console.log('telemetry keys cannot collide with feed symbols; settle + path unchanged');
}

// ---- 9. an empty record must produce an empty report, not a lie ----
{
  const { fh } = fresh();
  const r = await fh.report(24, T0);
  assert.equal(r.samples, 0);
  for (const f of Object.keys(r.feeds)) {
    assert.equal(r.feeds[f].samples, 0, `${f} zero`);
    assert.equal(r.feeds[f].coverage, null, `${f} coverage null, not 0% and not 100%`);
    assert.equal(r.feeds[f].gapMedS, null, `${f} gap null`);
  }
  assert.ok(r.limits.length >= 4, 'limits ship with the numbers, always');
  console.log('no data -> nulls and limits, never a flattering zero');
}

// ---- 10. the window is bounded to what the buckets can actually hold ----
{
  const { fh } = fresh();
  assert.equal((await fh.report(9999, T0)).windowHours, 72, 'capped at 72h (buckets live 4 days)');
  assert.equal((await fh.report(0, T0)).windowHours, 24, 'zero falls back to 24h');
  assert.equal((await fh.report(-5, T0)).windowHours, 24, 'negative falls back to 24h');
  console.log('window bounded 1..72h — cannot ask for a period we do not retain');
}

console.log('\nfeedhealth: all assertions passed');
