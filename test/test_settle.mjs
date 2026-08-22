import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// in-memory KV (no env) so pxlog uses the Map backend
delete process.env.KV_REST_API_URL; delete process.env.UPSTASH_REDIS_REST_URL;
const px = require('../lib/pxlog.js');
const { priceAt, priceCrossing, sample, bucketKey, SETTLE_GRACE_MS } = px;

const gate = globalThis.__ratchet_pxgate;
const force = async (t, prices) => { gate.t = 0; const real = Date.now; Date.now = () => t; try { return await sample(prices); } finally { Date.now = real; } };

const T0 = Date.UTC(2026, 7, 20, 10, 0, 0);
const mk = v => ({ src:'pyth-onchain', SOL:v, BTC:60000, ETH:2000, BONK:1e-6, WIF:0.1, JUP:0.2, PUMP:0.005 });

// --- lay down a price history: SOL falls, then recovers hours later ---
await force(T0 +   0*60e3, mk(100));   // seal here
await force(T0 +   5*60e3, mk(99));    // expiry sample: DOWN
await force(T0 +  10*60e3, mk(98));
await force(T0 + 240*60e3, mk(120));   // 4h later: way UP

console.log('buckets:', bucketKey(T0), '/', bucketKey(T0 + 240*60e3));

// ---- 1. THE EXPLOIT: settle late, on a favourable price ----
const expiry = T0 + 5*60e3;
const lateNow = T0 + 240*60e3 + 1000;      // attacker fires the settle 4h later
const at = await priceAt(expiry, lateNow);
assert.ok(at.row, 'must resolve');
assert.equal(at.row.SOL, 99, `settled on ${at.row.SOL}, expected the 99 at expiry`);
assert.equal(at.row.t, expiry, 'must be the sample AT expiry');
console.log('late settle 4h after expiry -> SOL', at.row.SOL, '(not 120) · exploit closed');

// ---- 2. exact-expiry sample wins over any later one ----
const at2 = await priceAt(T0 + 6*60e3, T0 + 300*60e3);
assert.equal(at2.row.SOL, 98, 'first sample AFTER 06:00 is the 10-min one');
console.log('first-crossing picks the next sample forward ->', at2.row.SOL);

// ---- 3. not yet sampled -> WAIT, do not settle, do not void ----
const at3 = await priceAt(T0 + 600*60e3, T0 + 600*60e3 + 5000);
assert.equal(at3.wait, true, 'inside grace with no sample = wait');
assert.equal(at3.row, undefined);
console.log('no sample yet, inside grace -> wait (shot stays open)');

// ---- 4. grace window closed -> VOID, never a guessed price ----
const at4 = await priceAt(T0 + 600*60e3, T0 + 600*60e3 + SETTLE_GRACE_MS + 1000);
assert.equal(at4.expired, true, 'past grace = expired');
assert.equal(at4.row, undefined);
console.log('grace closed with no sample -> void/refund');

// ---- 5. a sample that lands AFTER the grace window must not settle ----
await force(T0 + 900*60e3, mk(500));                       // far future sample
const at5 = await priceAt(T0 + 880*60e3, T0 + 901*60e3);   // expiry 20min before it
assert.equal(at5.expired, true, 'sample beyond grace must be refused');
console.log('sample 20min past a 15min grace -> refused, void');

// ---- 5b. oracle-source pinning: fallback may refund, never settle ----
const sourceExpiry = T0 + 1000 * 60e3;
await force(sourceExpiry + 1000, { ...mk(777), src: 'coinbase' });
const mixed = await priceAt(sourceExpiry, sourceExpiry + SETTLE_GRACE_MS + 1000, 'pyth-onchain');
assert.equal(mixed.expired, true, 'a Coinbase row cannot settle a Pyth-sealed shot');
assert.equal(mixed.row, undefined);
console.log('Pyth entry + Coinbase-only exit window -> void/refund');

// ---- 5c. ORACLE TIME, NOT SERVER OBSERVATION TIME ----
// A row read after expiry may still contain a price Pyth published before it.
// Local row.t must never turn that pre-expiry print into a valid exit.
{
  const exp = T0 + 1100 * 60e3 + 500;
  const k = bucketKey(exp);
  const before = Math.floor(exp / 1000) - 2;
  globalThis.__ratchet_mem.set(k, JSON.stringify([{
    t: exp + 10_000, src:'pyth-onchain', SOL:111,
    pt:{SOL:before}, pp:{SOL:before-60}, cf:{SOL:10},
  }]));
  const r = await priceCrossing('SOL', exp, exp + 20_000);
  assert.equal(r.wait, true, 'a pre-expiry publish read later is still not a crossing');
  console.log('server read after expiry + Pyth publish before expiry -> WAIT, not settlement');
}

// ---- 5d. A LATER UPDATE CANNOT SUBSTITUTE FOR A MISSED CROSSING ----
{
  const exp = T0 + 1200 * 60e3;
  const pub = Math.floor(exp / 1000) + 90;
  const prev = Math.floor(exp / 1000) + 30; // crossing already happened in an update we did not retain
  globalThis.__ratchet_mem.set(bucketKey(exp), JSON.stringify([{
    t: pub*1000, src:'pyth-onchain', SOL:222,
    pt:{SOL:pub}, pp:{SOL:prev}, cf:{SOL:10},
  }]));
  const r = await priceCrossing('SOL', exp, exp + 100_000);
  assert.equal(r.expired, true);
  assert.equal(r.reason, 'crossing-update-missed');
  console.log('later Pyth update with prev>=expiry -> VOID, never chosen as a substitute');
}

// ---- 5e. THE EXACT CROSSING IS ACCEPTED WITH ITS ORACLE TIMESTAMP ----
{
  const exp = T0 + 1300 * 60e3;
  const expS = Math.floor(exp / 1000), pub = expS + 15, prev = expS - 45;
  globalThis.__ratchet_mem.set(bucketKey(exp), JSON.stringify([{
    t: pub*1000+999, src:'pyth-onchain', SOL:333,
    pt:{SOL:pub}, pp:{SOL:prev}, cf:{SOL:25},
  }]));
  const r = await priceCrossing('SOL', exp, exp + 30_000);
  assert.equal(r.price, 333);
  assert.equal(r.publishTime, pub*1000);
  assert.equal(r.prevPublishTime, prev*1000);
  console.log('prev_publish < expiry <= publish -> exact crossing accepted');
}

// ---- 6. patience cannot win: waiting only ever refunds ----
const outcomes = new Set();
for (const when of [expiry+1, expiry+60e3, expiry+3600e3, expiry+86400e3]) {
  const r = await priceAt(expiry, when);
  outcomes.add(r.row ? r.row.SOL : (r.expired ? 'void' : 'wait'));
}
assert.deepEqual([...outcomes], [99], 'exit price must be identical regardless of settle time');
console.log('settle at +1s / +1m / +1h / +24h -> all give SOL 99 · deterministic');

console.log('\nALL PASS');
