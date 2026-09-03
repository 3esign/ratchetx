// The cadence watcher restates two things the PROGRAM owns -- the horizon table
// and the seal-freshness bound -- because a Rust constant cannot be imported
// into node. A restated rule is a rule that can drift, and a report describing
// a game that is not running is worse than no report. So both are pinned here
// against lib.rs itself, and the arithmetic that turns a cadence into a product
// decision is checked against hand-worked cases.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decide, readPrice } from '../tools/stock_cadence.mjs';

let checks = 0;
const rust = readFileSync(new URL('../onchain/ratchet-core/programs/ratchet-core/src/lib.rs', import.meta.url), 'utf8');
const tool = readFileSync(new URL('../tools/stock_cadence.mjs', import.meta.url), 'utf8');

// ---- 1. the horizon table is the program's ------------------------------
{
  const block = rust.match(/pub const HORIZONS: \[\(u16, u64\); \d+\] = \[([\s\S]*?)\];/);
  checks++; assert.ok(block, 'HORIZONS must still be findable in lib.rs');
  const fromRust = [...block[1].matchAll(/\(\s*(\d+)\s*,\s*\d+\s*\)/g)].map(m => Number(m[1]));
  const fromTool = JSON.parse(tool.match(/const HORIZONS = (\[[^\]]*\]);/)[1]);
  checks++; assert.deepEqual(fromTool, fromRust,
    'the tool sells the horizons the program sells, or its pass rates describe a different game');
}

// ---- 2. the seal bound is the program's ---------------------------------
{
  const fn = rust.match(/pub fn max_seal_age\(minutes: u16\) -> u64 \{([\s\S]*?)\n\}/);
  checks++; assert.ok(fn, 'max_seal_age must still be findable in lib.rs');
  checks++; assert.match(fn[1], /window \* 15 \+ 50\) \/ 100/, 'the 15% term');
  checks++; assert.match(fn[1], /\.clamp\(30, 60\)/, 'the 30..60 clamp');
  // and the tool's copy must agree numerically at every horizon it sells
  const maxSealAge = minutes => Math.min(60, Math.max(30, Math.floor((minutes * 60 * 15 + 50) / 100)));
  checks++; assert.equal(maxSealAge(5), 45, 'a 5-minute window seals on a 45-second price');
  checks++; assert.equal(maxSealAge(10), 60, 'a 10-minute window is already at the clamp');
  checks++; assert.equal(maxSealAge(1440), 60,
    'THE WHOLE PROBLEM: a 24-hour target gets the same 60-second bound as a 5-minute one');
  checks++; assert.match(tool, /Math\.min\(60, Math\.max\(30, Math\.floor\(\(window \* 15 \+ 50\) \/ 100\)\)\)/,
    'the tool must restate the bound in the same shape, so a diff is visible');
}

// ---- 3. the pass rate is what makes stocks a feature that does not work ---
{
  // 870-second cadence, sampled evenly: fresh only in the 60s after a publish.
  const samples = [];
  for (let t = 0; t < 8700; t += 10) samples.push({ at: t, publishTime: Math.floor(t / 870) * 870 });
  const d = decide(samples, [870, 870, 870, 870]);
  checks++; assert.ok(d.lands[1440] > 0.05 && d.lands[1440] < 0.09,
    `a 24-hour stock seal lands about 7 times in 100 (got ${(d.lands[1440] * 100).toFixed(1)}%)`);
  checks++; assert.ok(d.lands[5] < d.lands[1440],
    'the 5-minute window has a tighter bound, so it lands even less often');
  checks++; assert.equal(d.bindWorst, 870, 'the worst forward-binding wait is one whole gap');
  checks++; assert.equal(d.bindTypical, 435, 'from a random instant inside a gap, the expected wait is half of it');
}

// ---- 4. a fast feed is unaffected, which is the point of measuring per feed
{
  const samples = [];
  for (let t = 0; t < 3600; t += 10) samples.push({ at: t, publishTime: Math.floor(t / 60) * 60 });
  const d = decide(samples, [60, 60, 60, 61, 59]);
  checks++; assert.ok(d.lands[1440] > 0.95,
    'SOL at a 60-second heartbeat seals essentially always — no rule needs relaxing for it');
  checks++; assert.ok(d.bindWorst <= 61,
    'and its forward-binding wait is a minute, not a quarter of an hour');
}

// ---- 5. an empty measurement reports nothing, it does not report zero ----
{
  const d = decide([], []);
  checks++; assert.equal(d.lands[5], null, 'no samples means no pass rate, not a pass rate of 0%');
  checks++; assert.equal(d.bindWorst, null, 'no gaps means no binding estimate');
}

// ---- 6. the price reader agrees with the other tool that reads these ------
{
  const gate = readFileSync(new URL('../scripts/check-equity-feeds.mjs', import.meta.url), 'utf8');
  for (const step of ['8 + 32', 'readUInt8(o++)', 'subarray(o, o + 32)', 'readBigInt64LE(o)']) {
    checks++; assert.ok(gate.includes(step) && tool.includes(step),
      `both readers must walk PriceUpdateV2 the same way (${step}) — two tools that disagree about a price account produce two confident wrong answers`);
  }
  // and it must actually parse a hand-built account
  const b = Buffer.alloc(8 + 32 + 1 + 32 + 8 + 8 + 4 + 8 + 8);
  let o = 8 + 32; b.writeUInt8(1, o++);                       // Full
  Buffer.from('ef'.repeat(32), 'hex').copy(b, o); o += 32;
  b.writeBigInt64LE(9927n, o); o += 8;
  b.writeBigUInt64LE(16n, o); o += 8;
  b.writeInt32LE(-2, o); o += 4;
  b.writeBigInt64LE(1_800_000_060n, o); o += 8;
  b.writeBigInt64LE(1_800_000_000n, o);
  const p = readPrice(b);
  checks++; assert.equal(p.full, true);
  checks++; assert.equal(p.feedId, 'ef'.repeat(32));
  checks++; assert.equal(Number(p.price) * Math.pow(10, p.exponent), 99.27);
  checks++; assert.equal(p.publishTime, 1_800_000_060);
  checks++; assert.equal(p.prevPublishTime, 1_800_000_000,
    'prev_publish_time is read too — it is the left half of the crossing predicate');
}

// ---- 7. the feed list is pinned, and the RR feeds are not targets ---------
{
  const cfg = JSON.parse(readFileSync(new URL('../docs/STOCK_FEEDS.json', import.meta.url), 'utf8'));
  checks++; assert.equal(cfg.control.feedId, rust.match(/hex32\(b"([0-9a-f]{64})"\), \/\/ SOL/)[1],
    'the control feed must be the SOL feed the live program settles on, or the control proves nothing');
  checks++; assert.ok(cfg.feeds.length >= 6, 'the six maintained xStocks at least');
  for (const f of cfg.feeds) {
    checks++; assert.match(f.feedId, /^[0-9a-f]{64}$/, f.ticker + ' feed id is 32 bytes of hex');
    checks++; assert.notEqual(f.feedId, f.rrFeedId,
      f.ticker + ': the USD feed and the redemption-rate feed are different instruments');
  }
  const marked = cfg.feeds.filter(f => f.status);
  checks++; assert.ok(marked.length >= 2,
    'COINX and HOODX were abandoned by their publisher and the file must say so, or somebody lists them');
}

console.log(`PASS  stock cadence: ${checks} checks — horizons and seal bound pinned to lib.rs, 870s cadence lands ~7% of seals`);
