// The raw price buckets expire after four days. If a completed day is not
// summarised before then, that day is gone for good — no later effort can
// recover it. These tests exist because the whole value of the observatory is
// elapsed time, and elapsed time is the one thing a bug here destroys silently.
import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const fresh = () => {
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  globalThis.__ratchet_mem = new Map();
  globalThis.__ratchet_fhgate = { t: 0 };
  return { fh: require('./lib/feedhealth.js'), px: require('./lib/pxlog.js'), kv: require('./lib/kv.js') };
};

const DAY = 86400e3;
const D0 = Date.UTC(2026, 7, 18);            // 2026-08-18 00:00 UTC

async function seedDay(kv, px, day, { telemetry = true, minutes = 1440, gapAt = null } = {}) {
  const start = Date.parse(day + 'T00:00:00Z');
  const by = {};
  let pub = Math.floor(start / 1000);
  for (let i = 0; i < minutes; i++) {
    const t = start + i * 60_000, sec = Math.floor(t / 1000);
    const row = { t, src: 'pyth-onchain', SOL: 200 + i * 0.001, BTC: 60000, ETH: 3000,
      BONK: 0.0000026, WIF: 0.155, JUP: 0.187, PUMP: 0.00375 };
    if (telemetry) {
      row.ag = {}; row.cf = {}; row.pt = {};
      const stalled = gapAt != null && i > gapAt && i <= gapAt + 5;
      if (!stalled) pub = sec - 3;
      for (const f of ['SOL','BTC','ETH','BONK','WIF','JUP','PUMP']) {
        row.ag[f] = sec - pub; row.cf[f] = 2.5; row.pt[f] = pub;
      }
    }
    (by[px.bucketKey(t)] ||= []).push(row);
  }
  for (const [k, v] of Object.entries(by)) await kv.setJSONEx(k, v, 9999);
}

// ---- 1. a completed day is summarised and kept ----
{
  const { fh, px, kv } = fresh();
  await seedDay(kv, px, '2026-08-18');
  const made = await fh.rollupDay('2026-08-18', D0 + 2 * DAY);
  assert.equal(made, true, 'the day was rolled up');
  const row = await kv.getJSON(fh.dayKey('2026-08-18'));
  assert.ok(row, 'and stored');
  assert.equal(row.d, '2026-08-18');
  assert.equal(row.samples, 1440, 'every minute counted');
  assert.equal(row.ourDutyPct, 100, 'a full day is 100% duty');
  assert.equal(row.feeds.SOL.telemetry, 1440, 'telemetry carried through');
  assert.equal(row.feeds.SOL.gapMedS, 60, 'and the distributions survived the fold');
  assert.equal(row.feeds.SOL.thin, false, 'a full day is never thin');
  const idx = await kv.getJSON(fh.DAY_INDEX);
  assert.deepEqual(idx, ['2026-08-18'], 'and the day is in the index');
  console.log('complete day -> summarised, stored, indexed, distributions intact');
}

// ---- 2. A DAY STILL RUNNING MUST NEVER BE SUMMARISED ----
// Half a day rolled up as if it were whole would be a permanent, wrong row.
{
  const { fh, px, kv } = fresh();
  await seedDay(kv, px, '2026-08-18', { minutes: 600 });
  const midday = Date.parse('2026-08-18T10:00:00Z');
  assert.equal(await fh.rollupDay('2026-08-18', midday), false, 'refused while the day is still running');
  assert.equal(await kv.getJSON(fh.dayKey('2026-08-18')), null, 'and nothing was written');
  console.log('day still in progress -> refused, nothing written');
}

// ---- 3. idempotent: a second writer must not overwrite ----
{
  const { fh, px, kv } = fresh();
  await seedDay(kv, px, '2026-08-18');
  assert.equal(await fh.rollupDay('2026-08-18', D0 + 2 * DAY), true, 'first writer wins');
  const first = await kv.getJSON(fh.dayKey('2026-08-18'));
  assert.equal(await fh.rollupDay('2026-08-18', D0 + 3 * DAY), false, 'second writer declines');
  const again = await kv.getJSON(fh.dayKey('2026-08-18'));
  assert.equal(again.rolledAt, first.rolledAt, 'and the stored row is untouched');
  const idx = await kv.getJSON(fh.DAY_INDEX);
  assert.equal(idx.length, 1, 'the index has no duplicate');
  console.log('rolled twice -> written once, index clean');
}

// ---- 4. a day we never observed is a gap, not a zero ----
{
  const { fh } = fresh();
  assert.equal(await fh.rollupDay('2026-08-18', D0 + 2 * DAY), false, 'no samples -> no row');
  assert.equal(await fh.rollupDay('not-a-date', D0 + 2 * DAY), false, 'malformed day refused');
  console.log('unobserved day -> no row at all, rather than a day of zeroes');
}

// ---- 5. ensureRollups catches the days the buckets can still see ----
{
  const { fh, px, kv } = fresh();
  for (const d of ['2026-08-18', '2026-08-19', '2026-08-20']) await seedDay(kv, px, d);
  const now = Date.parse('2026-08-21T09:00:00Z');
  const made = await fh.ensureRollups(now);
  assert.equal(made, 3, `three complete days rolled up (${made})`);
  const idx = await kv.getJSON(fh.DAY_INDEX);
  assert.deepEqual(idx, ['2026-08-18', '2026-08-19', '2026-08-20'], 'all three indexed, in order');
  assert.equal(await kv.getJSON(fh.dayKey('2026-08-21')), null, 'today is not summarised');
  console.log('ensureRollups -> three complete days kept, today left alone');
}

// ---- 6. it is throttled, so a busy page does not recompute all day ----
{
  const { fh, px, kv } = fresh();
  await seedDay(kv, px, '2026-08-20');
  const now = Date.parse('2026-08-21T09:00:00Z');
  assert.equal(await fh.ensureRollups(now), 1, 'first pass does the work');
  assert.equal(await fh.ensureRollups(now + 1000), 0, 'a second pass a second later does nothing');
  assert.equal(await fh.ensureRollups(now + 60_000), 0, 'nor a minute later');
  console.log('ensureRollups throttled -> one pass per ten minutes per instance');
}

// ---- 7. THE FOLD: the all-time view is what waiting buys ----
{
  const { fh, px, kv } = fresh();
  await seedDay(kv, px, '2026-08-18');
  await seedDay(kv, px, '2026-08-19', { gapAt: 700 });   // a five-minute stall
  await seedDay(kv, px, '2026-08-20');
  await fh.ensureRollups(Date.parse('2026-08-21T09:00:00Z'));
  const hist = await fh.history(90);
  assert.equal(hist.length, 3, 'three days of history');
  assert.deepEqual(hist.map(r => r.d), ['2026-08-18','2026-08-19','2026-08-20'], 'oldest first');
  const all = fh.foldHistory(hist);
  assert.equal(all.days, 3);
  assert.equal(all.first, '2026-08-18');
  assert.equal(all.last, '2026-08-20');
  assert.equal(all.samples, 4320, 'every sample across every day');
  assert.ok(all.feeds.SOL.worstGapS >= 300,
    `the worst stall in three days is remembered (${all.feeds.SOL.worstGapS}s)`);
  assert.equal(all.feeds.SOL.worstGapDay, '2026-08-19', 'and WHICH day it happened on');
  assert.equal(all.feeds.SOL.coverage, 100, 'coverage folds across days');
  console.log(`fold -> 3 days, 4320 samples, worst gap ${all.feeds.SOL.worstGapS}s on ${all.feeds.SOL.worstGapDay}`);
}

// ---- 8. the fold must not invent an all-time view from nothing ----
{
  const { fh } = fresh();
  assert.equal(fh.foldHistory([]), null, 'no days -> no all-time view');
  assert.equal(fh.foldHistory(null), null, 'and null is handled');
  assert.deepEqual(await fh.history(90), [], 'empty history is empty, not fabricated');
  console.log('no history -> null, never a confident all-time zero');
}

// ---- 9. a store failure must be loud, not a silently empty history ----
{
  const kvPath = require.resolve('./lib/kv.js');
  const realKv = require.cache[kvPath];
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  require.cache[kvPath] = { id: kvPath, filename: kvPath, loaded: true, exports: {
    getJSONStrict: async () => { throw new Error('kv down'); },
    getJSON: async () => null, setJSON: async () => {}, setJSONEx: async () => {},
    setnxJSON: async () => true, hall: async () => ({}), hincr: async () => {} } };
  const fh = require('./lib/feedhealth.js');
  let threw = false;
  try { await fh.history(30); } catch { threw = true; }
  assert.ok(threw, 'a failed read throws rather than reporting "no days measured"');
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  require.cache[kvPath] = realKv;
  console.log('store failure -> history throws instead of claiming an empty record');
}

console.log('\nrollup: all assertions passed');
