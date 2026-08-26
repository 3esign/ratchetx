// A serverless function can be frozen the moment it sends its response, so
// any promise still in flight dies with it. The price sample is settlement
// evidence — the record that makes an exit price independent of who cranks
// the settle — and it must be on disk BEFORE the reply goes out, not racing it.
import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let fails = 0;
const ok = (c, n) => { console.log((c ? 'PASS  ' : 'FAIL  ') + n); if (!c) fails++; };

// ---- 1. THE SAMPLE IS ON DISK BEFORE THE RESPONSE IS SENT ----
{
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  globalThis.__ratchet_mem = new Map();

  const order = [];
  // A deliberately slow store: if the handler does not await the write, the
  // response lands first and the ordering below records it.
  const pxPath = require.resolve('../lib/pxlog.js');
  require.cache[pxPath] = { id: pxPath, filename: pxPath, loaded: true, exports: {
    sample: async () => { await new Promise(r => setTimeout(r, 120)); order.push('sample'); return true; },
    priceAt: async () => ({ wait: true }),
    pathFor: async () => [],
    bucketKey: t => 'px:stub',
    SETTLE_GRACE_MS: 900000, SAMPLE_MS: 60000,
    FEEDS: ['SOL', 'BTC', 'ETH', 'BONK', 'WIF', 'JUP', 'PUMP'],
  } };
  const prPath = require.resolve('../lib/prices.js');
  require.cache[prPath] = { id: prPath, filename: prPath, loaded: true, exports: {
    getPrices: async () => ({ src: 'stub', SOL: 100, BTC: 60000, ETH: 3000 }),
    coinbase: async () => ({ src: 'coinbase' }),
  } };

  const game = require('../api/game.js');
  await new Promise(done => {
    const res = { setHeader() {}, status() { return this; },
      json() { order.push('response'); done(); }, end() { order.push('response'); done(); } };
    game({ method: 'GET', query: { action: 'state' }, headers: {}, body: {} }, res);
  });

  ok(order[0] === 'sample',
    `the sample is written before the response is sent (order: ${order.join(' -> ')})`);
  ok(order.includes('response'), 'and the response still goes out');
}

// ---- 2. A FAILING WRITE STILL MUST NOT FAIL THE REQUEST ----
// Awaiting it must not have turned a dropped statistic into a 500.
{
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  globalThis.__ratchet_mem = new Map();

  const pxPath = require.resolve('../lib/pxlog.js');
  require.cache[pxPath] = { id: pxPath, filename: pxPath, loaded: true, exports: {
    sample: async () => { throw new Error('store exploded'); },
    priceAt: async () => ({ wait: true }),
    pathFor: async () => [],
    bucketKey: () => 'px:stub',
    SETTLE_GRACE_MS: 900000, SAMPLE_MS: 60000,
    FEEDS: ['SOL', 'BTC', 'ETH', 'BONK', 'WIF', 'JUP', 'PUMP'],
  } };
  const prPath = require.resolve('../lib/prices.js');
  require.cache[prPath] = { id: prPath, filename: prPath, loaded: true, exports: {
    getPrices: async () => ({ src: 'stub', SOL: 100, BTC: 60000, ETH: 3000 }),
    coinbase: async () => ({ src: 'coinbase' }),
  } };

  const game = require('../api/game.js');
  const r = await new Promise(done => {
    const res = { _s: 200, setHeader() {}, status(c) { this._s = c; return this; },
      json(o) { done({ status: this._s, body: o }); },
      end(b) { done({ status: this._s, body: b }); } };
    game({ method: 'GET', query: { action: 'state' }, headers: {}, body: {} }, res);
  });
  ok(r.status === 200, `a failed sample write still returns 200 (got ${r.status})`);
  ok(r.body && r.body.ok !== false, 'and the payload is a normal state response');
}

// ---- 3. THE THROTTLE STILL SPARES THE COMMON CASE ----
// Awaiting would be expensive if it meant a round trip per request. It does
// not: sample() returns on its own gate without touching the network.
{
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  globalThis.__ratchet_mem = new Map();
  globalThis.__ratchet_pxgate = { t: 0, x: 0 };

  // COUNT the store operations instead of timing them. This used to assert
  // "51 calls in under 2000ms", which measures the machine, not the gate: on a
  // loaded or thermally throttled box it fails while the behaviour is perfect.
  // kv is patched BEFORE pxlog is required, because pxlog destructures these
  // functions at require time and would otherwise capture the originals.
  const kv = require('../lib/kv.js');
  let ops = 0;
  for (const fn of ['getJSON', 'getJSONStrict', 'getManyJSON', 'setJSON', 'setJSONEx', 'setManyJSONAtomic']) {
    const real = kv[fn];
    if (typeof real === 'function') kv[fn] = (...a) => { ops++; return real.apply(kv, a); };
  }
  const px = require('../lib/pxlog.js');

  const first = await px.sample({ src: 'x', SOL: 1, ages: {}, confs: {}, pubs: {} });
  const afterFirst = ops;
  let hits = 0;
  for (let i = 0; i < 50; i++) if (await px.sample({ src: 'x', SOL: 1 })) hits++;
  const gatedOps = ops - afterFirst;

  ok(first === true, 'the first call samples');
  ok(hits === 0, `fifty further calls inside the minute wrote nothing (${hits})`);
  ok(gatedOps === 0,
    `and touched the store ZERO times while gated (${gatedOps} ops) — the claim is that the gate short-circuits, so count it, do not time it`);
}

console.log(fails ? `\n${fails} FAILED` : '\nSAMPLE DURABILITY OK');
process.exitCode = fails ? 1 : 0;
