// The settlement walk was the whole outage. Measured 2026-09-03 from a complete
// copy of the store: `pxu:` 98 rows / 15.88 MB and `px:` 98 rows / 5.60 MB --
// about 162 KB and 57 KB per hour, 69% of the entire database. priceCrossing
// reads three hours of both, so one call moves roughly 600 KB, and the client
// re-triggered that walk on every poll while a shot expired. 25.9 GB against a
// 5 GB allowance followed.
//
// So this test counts operations rather than timing them: a hundred settlement
// resolutions of the same shot must not cost a hundred bucket reads. It also
// pins the two rules that make the cache safe to have at all -- a write is
// visible immediately, and an empty read is never remembered as an answer.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

delete process.env.KV_REST_API_URL; delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY;

// pxlog destructures kv at load time, so every hook has to be installed on the
// module BEFORE it is required. A swap afterwards would patch an object nobody
// is looking at any more -- which is exactly how a test can pass while proving
// nothing.
const kv = require('../lib/kv.js');
let reads = 0;
let failKey = null;
for (const name of ['getJSONStrict', 'getManyJSON']) {
  const original = kv[name];
  kv[name] = async (...args) => {
    reads += name === 'getManyJSON' ? args[0].length : 1;
    if (failKey && (args[0] === failKey || (Array.isArray(args[0]) && args[0].includes(failKey))))
      throw new Error('store unavailable');
    return original(...args);
  };
}
const px = require('../lib/pxlog.js');
const { sample, priceCrossing, pathFor, bucketKey } = px;

const gate = globalThis.__ratchet_pxgate;
const at = async (t, prices) => {
  gate.t = 0;
  const real = Date.now; Date.now = () => t;
  try { return await sample(prices); } finally { Date.now = real; }
};

const T0 = Date.UTC(2026, 8, 3, 10, 0, 0);
const row = (v, t) => ({ src:'pyth-onchain', SOL:v, BTC:60000, ETH:2000, BONK:1e-6, WIF:0.1, JUP:0.2, PUMP:0.005,
  ages:{SOL:2}, confs:{SOL:10}, pubs:{SOL:Math.floor(t/1000)}, prevPubs:{SOL:Math.floor(t/1000)-60},
  slots:{SOL:1}, postedSlots:{SOL:1} });

await at(T0 - 3600e3, row(99, T0 - 3600e3));   // the hour before: closed for good
await at(T0 + 60e3,   row(100, T0 + 60e3));    // the hour the shot expires in
await at(T0 + 120e3,  row(101, T0 + 120e3));

const expiry = T0 + 90e3;
let checks = 0;

// ---- 1. the same walk, a hundred times, must not cost a hundred reads -------
reads = 0;
const first = await priceCrossing('SOL', expiry, T0 + 130e3);
const firstReads = reads;
assert.ok(firstReads > 0, 'the first walk must actually read the store');
reads = 0;
for (let i = 0; i < 100; i++) await priceCrossing('SOL', expiry, T0 + 130e3 + i);
checks++;
assert.ok(reads <= firstReads, `100 repeats cost ${reads} reads, first walk cost ${firstReads}`);
console.log(`  100 repeated settlement walks: ${reads} store reads (first walk: ${firstReads})`);

// ---- 2. and they must still return the same answer -------------------------
const again = await priceCrossing('SOL', expiry, T0 + 130e3);
checks++; assert.deepEqual(again.price, first.price, 'a cached walk must settle identically');
checks++; assert.equal(first.price, 101, 'the first validated transition at or after expiry');

// ---- 3. a new sample in the OPEN hour is visible, not hidden by the cache ---
await at(T0 + 200e3, row(123, T0 + 200e3));
const path = await pathFor('SOL', T0, T0 + 300e3);
checks++;
assert.ok(path.some(([, value]) => value === 123),
  'a sample written after the read must appear: writes drop what they replace');
console.log('  a fresh sample is visible immediately after the write');

// ---- 4. a FAILED read is never remembered as an empty hour -----------------
// getJSONStrict throws rather than returning nothing, which is the whole reason
// a null from it is safe to keep. A throw must leave no trace: the next call has
// to ask again, or a store hiccup would harden into "no samples" and void a
// valid shot.
{
  const outageKey = bucketKey(T0 + 9 * 3600e3);
  failKey = outageKey;
  let threw = false;
  try { await priceCrossing('SOL', T0 + 9 * 3600e3 + 1000, T0 + 9 * 3600e3 + 2000); }
  catch { threw = true; }
  failKey = null;
  checks++;
  assert.ok(threw, 'a failed bucket read must surface, not settle as an empty hour');
  reads = 0;
  await priceCrossing('SOL', T0 + 9 * 3600e3 + 1000, T0 + 9 * 3600e3 + 2000);
  checks++;
  assert.ok(reads > 0, 'after a failure the bucket must be asked again, not served from cache');
  console.log('  a failed read leaves no trace: the next call asks the store again');
}

console.log(`\nPASS  read budget: ${checks} checks — the settlement walk is paid once, not once per poll`);
