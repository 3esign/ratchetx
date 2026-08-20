import assert from 'node:assert';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const DISC = crypto.createHash('sha256').update('account:PriceUpdateV2').digest().subarray(0,8);
const OWNER = 'pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT';

// Build a byte-exact PriceUpdateV2 the way the Solana account really holds it.
function mkAccount({ feedId, price, expo, publishTime, prevPublishTime, full = true, disc = DISC }) {
  const parts = [];
  parts.push(disc);                                   // 8  discriminator
  parts.push(crypto.randomBytes(32));                 // 32 write_authority
  parts.push(full ? Buffer.from([1]) : Buffer.from([0, 13]));  // verification_level
  parts.push(Buffer.from(feedId, 'hex'));             // 32 feed_id
  const n = (fn, v, len) => { const b = Buffer.alloc(len); b[fn](v, 0); return b; };
  parts.push(n('writeBigInt64LE', BigInt(price), 8));       // price
  parts.push(n('writeBigUInt64LE', BigInt(Math.round(Math.abs(price)*0.0004)), 8)); // conf
  parts.push(n('writeInt32LE', expo, 4));                   // exponent
  parts.push(n('writeBigInt64LE', BigInt(publishTime), 8)); // publish_time
  parts.push(n('writeBigInt64LE', BigInt(prevPublishTime), 8)); // prev_publish_time
  parts.push(n('writeBigInt64LE', BigInt(price), 8));       // ema_price
  parts.push(n('writeBigUInt64LE', 1n, 8));                 // ema_conf
  parts.push(n('writeBigUInt64LE', 999n, 8));               // posted_slot
  return Buffer.concat(parts).toString('base64');
}

const { ACCOUNTS } = require('./lib/onchain_px.js');
const now = Math.floor(Date.now()/1000);
const TRUE_PX = { SOL: 84.37, BTC: 61250.5, ETH: 2410.88, BONK: 0.00001842,
                  PUMP: 0.004131, JUP: 0.6612, WIF: 1.2044 };

let rpcCalls = 0, maxBatch = 0;
function stubRpc(mutate = () => {}) {
  rpcCalls = 0; maxBatch = 0;
  globalThis.fetch = async (_url, opts) => {
    rpcCalls++;
    const body = JSON.parse(opts.body);
    const keys = body.params[0];
    maxBatch = Math.max(maxBatch, keys.length);
    const value = keys.map(k => {
      const sym = Object.keys(ACCOUNTS).find(s => ACCOUNTS[s][0] === k);
      if (!sym) return null;
      const spec = { feedId: ACCOUNTS[sym][1], price: Math.round(TRUE_PX[sym] * 1e8),
                     expo: -8, publishTime: now - 4, prevPublishTime: now - 64, full: true,
                     owner: OWNER, sym };
      mutate(spec);
      if (spec.drop) return null;
      return { owner: spec.owner, lamports: 1, data: [mkAccount(spec), 'base64'],
               executable: false, rentEpoch: 0 };
    });
    return { ok: true, json: async () => ({ jsonrpc:'2.0', id:1, result:{ context:{slot:1}, value } }) };
  };
}

function fresh() {
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  return require('./lib/onchain_px.js');
}

// ---- 1. happy path -------------------------------------------------
stubRpc();
let m = fresh();
let r = await m.onchainPrices();
assert.equal(r.src, 'pyth-onchain');
for (const [s, want] of Object.entries(TRUE_PX)) {
  assert.ok(Math.abs(r[s] - want) < want * 1e-9, `${s} decoded ${r[s]} want ${want}`);
}
assert.equal(r.partial, undefined, 'no drops expected');
assert.ok(r.ages.SOL >= 3 && r.ages.SOL <= 6, 'age ' + r.ages.SOL);
console.log('decode 7/7 ok  · SOL', r.SOL, '· BONK', r.BONK, '· age', r.ages.SOL + 's');
console.log('rpc calls', rpcCalls, '· max batch', maxBatch, '(provider cap is 5)');
assert.equal(maxBatch <= 5, true, 'batch exceeds the 5-key cap');
assert.equal(rpcCalls, 2, 'expected 7 keys in 2 batched calls');

// ---- 2. a bad OPTIONAL feed drops out, core survives ---------------
stubRpc(s => { if (s.sym === 'WIF') s.feedId = 'ab'.repeat(32); if (s.sym === 'JUP') s.drop = true; });
m = fresh(); r = await m.onchainPrices();
assert.equal(r.WIF, undefined); assert.equal(r.JUP, undefined);
assert.ok(r.SOL > 0 && r.BTC > 0 && r.ETH > 0);
assert.match(r.partial, /WIF:feed id mismatch/);
assert.match(r.partial, /JUP:account missing/);
console.log('bad optional feeds dropped, core intact ·', r.partial);

// ---- 3. every core rejection path must THROW, never guess ----------
const mustThrow = async (label, mut) => {
  stubRpc(mut); m = fresh();
  await assert.rejects(() => m.onchainPrices(), /onchain incomplete/, label);
  console.log('rejected:', label);
};
await mustThrow('wrong owner',        s => { if (s.sym==='SOL') s.owner = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'; });
await mustThrow('bad discriminator',  s => { if (s.sym==='BTC') s.disc = Buffer.alloc(8); });
await mustThrow('partial verification', s => { if (s.sym==='ETH') s.full = false; });
await mustThrow('stale price',        s => { if (s.sym==='SOL') s.publishTime = now - 400; });
await mustThrow('negative price',     s => { if (s.sym==='BTC') s.price = -1; });

// ---- 4. full stack: prices.js prefers on-chain, degrades honestly ---
stubRpc(); m = fresh();
const { getPrices } = require('./lib/prices.js');
r = await getPrices();
assert.equal(r.src, 'pyth-onchain');
assert.equal(r.degraded, undefined, 'on-chain must not report degraded');
console.log('prices.js -> src', r.src, '· SOL', r.SOL);

// cache still collapses a burst
const before = rpcCalls;
await Promise.all(Array.from({length: 12}, () => getPrices()));
console.log('12 concurrent getPrices ->', rpcCalls - before, 'extra rpc calls');
assert.equal(rpcCalls - before, 0, 'cache should have served all 12');

console.log('\nALL PASS');
