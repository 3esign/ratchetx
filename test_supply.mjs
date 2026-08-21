// THE SUPPLY CLOCK makes a public, checkable claim about a token's supply.
// It must never overstate destruction, never claim the launchpad's burn as
// gameplay, and never draw a curve out of days it did not observe.
import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const fresh = () => {
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  globalThis.__ratchet_mem = new Map();
  globalThis.__ratchet_supgate = { t: 0 };
  return { sl: require('./lib/supplylog.js'), kv: require('./lib/kv.js') };
};
const DAY = 86400e3;
const T0 = Date.UTC(2026, 6, 1, 9, 0, 0);

// ---- 1. one reading a day; the first is the one that is kept ----
{
  const { sl, kv } = fresh();
  await sl.snap({ supply: 1_000_000, playerBurned: 0, incinerated: 0 }, T0);
  globalThis.__ratchet_supgate.t = 0;
  await sl.snap({ supply: 999_000, playerBurned: 1000, incinerated: 0 }, T0 + 6 * 3600e3);
  const row = await kv.getJSON('sup:2026-07-01');
  assert.equal(row.first, 1_000_000, 'the first reading of the day is immutable');
  assert.equal(row.last, 999_000, 'later readings only move `last`');
  assert.equal(row.playerBurned, 1000, 'the counter travels with the reading');
  console.log('two readings, one day -> first pinned, last updated');
}

// ---- 2. THE THROTTLE. A busy page must not cost a write per request. ----
{
  const { sl, kv } = fresh();
  await sl.snap({ supply: 1_000_000 }, T0);
  let wrote = 0;
  for (let i = 0; i < 50; i++) if (await sl.snap({ supply: 1_000_000 - i }, T0 + i * 1000)) wrote++;
  assert.equal(wrote, 0, 'fifty requests inside ten minutes wrote nothing');
  console.log('50 requests in 50 seconds -> 0 extra writes');
}

// ---- 3. a day's burn is measured against the NEXT day's opening ----
{
  const { sl } = fresh();
  for (let i = 0; i < 5; i++) {
    globalThis.__ratchet_supgate.t = 0;
    await sl.snap({ supply: 1_000_000 - i * 2000, playerBurned: i * 1500 }, T0 + i * DAY);
  }
  const s = await sl.series(30);
  assert.equal(s.length, 5, 'five days recorded');
  for (let i = 0; i < 4; i++) assert.equal(s[i].burned, 2000, `day ${i} burned 2000`);
  assert.equal(s[4].partial, true, 'the last day is flagged partial');
  assert.equal(s[4].burned, 0, 'and a partial day is not drawn as a collapse');
  console.log('5 days -> 4 complete days at 2000/day, last flagged partial');
}

// ---- 4. A MISSING DAY IS A GAP, NOT AN INVENTION ----
{
  const { sl } = fresh();
  globalThis.__ratchet_supgate.t = 0; await sl.snap({ supply: 1_000_000 }, T0);
  globalThis.__ratchet_supgate.t = 0; await sl.snap({ supply: 900_000 }, T0 + 4 * DAY);  // we slept 3 days
  const s = await sl.series(30);
  assert.equal(s.length, 2, 'only the days we actually read exist');
  assert.deepEqual(s.map(r => r.d), ['2026-07-01', '2026-07-05'], 'no fabricated days in between');
  assert.equal(s[0].burned, 100_000, 'the whole gap is attributed to the interval we can see, not spread');
  console.log('3 unobserved days -> 2 points, no interpolation');
}

// ---- 5. supply must never be recorded going up ----
{
  const { sl, kv } = fresh();
  assert.equal(await sl.snap({ supply: 0 }, T0), false, 'zero supply refused');
  assert.equal(await sl.snap({ supply: -5 }, T0), false, 'negative supply refused');
  assert.equal(await sl.snap({ supply: NaN }, T0), false, 'NaN refused');
  assert.equal(await kv.getJSON('g:sup:days'), null, 'and nothing was written');
  console.log('impossible readings refused before they reach the record');
}

// ---- 6. a store failure must not break the page that called it ----
// snap() is called from inside the PROOF page's render. If a Redis hiccup
// could throw out of it, a statistic we keep for our own interest would take
// down the page whose entire job is to be checkable.
{
  const kvPath = require.resolve('./lib/kv.js');
  const realKv = require.cache[kvPath];
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  globalThis.__ratchet_supgate = { t: 0 };
  require.cache[kvPath] = { id: kvPath, filename: kvPath, loaded: true, exports: {
    getJSON: async () => { throw new Error('kv down'); },
    setJSON: async () => { throw new Error('kv down'); },
  } };
  const sl = require('./lib/supplylog.js');
  assert.equal(await sl.snap({ supply: 1000 }, T0), false, 'returns false rather than throwing');
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  require.cache[kvPath] = realKv;
  console.log('store failure swallowed — the proof page still renders');
}

// ---- 7. THE PAGE: attribution must never claim the launchpad's burn ----
{
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  globalThis.__ratchet_mem = new Map();
  const kv = require('./lib/kv.js');
  const sl = require('./lib/supplylog.js');
  process.env.RATCHET_MINT = 'FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump';

  // launch supply 1,000,000,000 · now 940,000,000 -> 60,000,000 destroyed
  // players verifiably burned 1,684,999 of that; the rest is pump.fun's
  // graduation burn and must be reported as exactly that.
  await kv.setJSON('g:supply0', { supply: 1_000_000_000, t: T0 });
  await kv.hseed('h:stats', { realBurned: 1_684_999 });
  for (let i = 0; i < 4; i++) {
    globalThis.__ratchet_supgate = { t: 0 };
    await sl.snap({ supply: 1_000_000_000 - i * 20_000_000, playerBurned: i * 500_000 }, T0 + i * DAY);
  }
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result: null }) });
  const burn = require('./lib/burn.js');
  burn.rpcCall = async (m) => {
    if (m === 'getAccountInfo') return { value: { data: { parsed: { info: {
      supply: '940000000000000', decimals: 6, mintAuthority: null, freezeAuthority: null } } } } };
    if (m === 'getTokenAccountsByOwner') return { value: [] };
    if (m === 'getSignaturesForAddress') return [];
    return null;
  };
  const supply = require('./api/supply.js');
  const r = await new Promise(done => {
    const res = { _s: 200, setHeader() {}, status(c) { this._s = c; return this; },
      end(b) { done({ status: this._s, body: String(b) }); } };
    supply({ query: {} }, res);
  });
  assert.equal(r.status, 200, 'page renders');
  assert.ok(/60,000,000/.test(r.body), 'total destroyed is stated');
  assert.ok(/1,684,999/.test(r.body), 'the player-burned figure is stated');
  assert.ok(/58,315,001/.test(r.body), 'and the remainder is attributed to the launchpad, not to us');
  assert.ok(/LAUNCHPAD/.test(r.body), 'with the split labelled');
  assert.ok(!/NaN|undefined/.test(r.body), 'no NaN / undefined');
  assert.ok(/revoked/.test(r.body), 'mint and freeze authority reported');
  assert.ok(/<svg/.test(r.body), 'the curve is drawn once there are two readings');
  console.log('page: 60,000,000 destroyed = 1,684,999 players + 58,315,001 launchpad, split shown');

  // ---- 8. and with no mint configured it must say so, not render zeros ----
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  delete process.env.RATCHET_MINT;
  const s2 = require('./api/supply.js');
  const r2 = await new Promise(done => {
    const res = { _s: 200, setHeader() {}, status(c) { this._s = c; return this; },
      end(b) { done({ status: this._s, body: String(b) }); } };
    s2({ query: {} }, res);
  });
  assert.ok(/has not started/.test(r2.body), 'no mint -> the clock says it has not started');
  assert.ok(!/DESTROYED/.test(r2.body), 'and publishes no destruction figure at all');
  console.log('no mint -> the clock says so instead of printing zeroes');
}

// ---- 9. A RATE FROM ONE DAY IS NOT A RATE ----
// This shipped wrong: on its first day the page read 49 tokens burned and
// reported "49/day - half of what is left is gone in 26,238 years". The
// arithmetic was correct and the statement was nonsense.
{
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  globalThis.__ratchet_mem = new Map();
  const kv = require('./lib/kv.js');
  const sl = require('./lib/supplylog.js');
  process.env.RATCHET_MINT = 'FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump';
  await kv.setJSON('g:supply0', { supply: 1_000_000_000, t: T0 });
  await kv.hseed('h:stats', { realBurned: 1000 });

  const render = async () => {
    for (const k of Object.keys(require.cache)) delete require.cache[k];
    const burn = require('./lib/burn.js');
    burn.rpcCall = async (m) => {
      if (m === 'getAccountInfo') return { value: { data: { parsed: { info: {
        supply: '939000000000000', decimals: 6, mintAuthority: null, freezeAuthority: null } } } } };
      if (m === 'getTokenAccountsByOwner') return { value: [] };
      if (m === 'getSignaturesForAddress') return [];
      return null;
    };
    const supply = require('./api/supply.js');
    return new Promise(done => {
      const res = { _s: 200, setHeader() {}, status(c) { this._s = c; return this; },
        end(b) { done(String(b)); } };
      supply({ query: {} }, res);
    });
  };

  // two readings = ONE complete day
  globalThis.__ratchet_supgate = { t: 0 };
  await sl.snap({ supply: 939_000_049, playerBurned: 0 }, T0);
  globalThis.__ratchet_supgate = { t: 0 };
  await sl.snap({ supply: 939_000_000, playerBurned: 49 }, T0 + DAY);
  let html = await render();
  assert.ok(/withheld until 3 complete days/.test(html), 'one complete day -> the rate is withheld');
  assert.ok(!/49\/day/.test(html), 'and the one-day figure is never printed');
  assert.ok(!/years/.test(html) || !/26,?238/.test(html), 'and no absurd projection appears');

  // three more readings = three complete days
  for (let i = 2; i <= 4; i++) {
    globalThis.__ratchet_supgate = { t: 0 };
    await sl.snap({ supply: 939_000_000 - (i - 1) * 50, playerBurned: 49 * i }, T0 + i * DAY);
  }
  html = await render();
  assert.ok(!/withheld until/.test(html), 'three complete days -> the rate is published');
  assert.ok(/\/day/.test(html), 'and it reads as a per-day figure');
  console.log('burn rate -> withheld at one day, published at three');
}

console.log('\nsupply clock: all assertions passed');
