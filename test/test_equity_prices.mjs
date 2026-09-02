// Economic capabilities must not appear when somebody adds a secret. Stocks
// have no sponsored Pyth-on-Solana account in this runtime, so they stay held
// with or without PYTH_API_KEY. Crypto remains keyless; Coinbase remains a
// labeled display fallback and can never invent an equity target.
import assert from 'node:assert';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// Set the old secret deliberately. The runtime must ignore it.
process.env.PYTH_API_KEY = 'test-key';

const DISC = crypto.createHash('sha256').update('account:PriceUpdateV2').digest().subarray(0, 8);
const OWNER = 'pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT';
const { ACCOUNTS } = require('../lib/onchain_px.js');
const now = () => Math.floor(Date.now() / 1000);
const CRYPTO_PX = { SOL: 84.37, BTC: 61250.5, ETH: 2410.88, BONK: 0.00001842,
                    PUMP: 0.004131, JUP: 0.6612, WIF: 1.2044 };
const EQ_PX = { TSLA: 402.11, NVDA: 178.4, PLTR: 63.25, COIN: 245.9, HOOD: 71.03 };

function mkAccount({ feedId, price, expo, publishTime, prevPublishTime }) {
  const n = (fn, v, len) => { const b = Buffer.alloc(len); b[fn](v, 0); return b; };
  return Buffer.concat([
    DISC, crypto.randomBytes(32), Buffer.from([1]), Buffer.from(feedId, 'hex'),
    n('writeBigInt64LE', BigInt(price), 8),
    n('writeBigUInt64LE', BigInt(Math.round(Math.abs(price) * 0.0004)), 8),
    n('writeInt32LE', expo, 4),
    n('writeBigInt64LE', BigInt(publishTime), 8),
    n('writeBigInt64LE', BigInt(prevPublishTime), 8),
    n('writeBigInt64LE', BigInt(price), 8),
    n('writeBigUInt64LE', 1n, 8),
    n('writeBigUInt64LE', 999n, 8),
  ]).toString('base64');
}

// One stub answers both roads: a JSON-RPC POST is the on-chain primary, a
// Hermes GET is the equity merge. `eq` shapes what Hermes says back.
let hermesCalls = 0;
function stub({ eq = 'fresh', chainDown = false } = {}) {
  hermesCalls = 0;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (opts && opts.body) {
      if (chainDown) return { ok: false, status: 502, json: async () => ({}) };
      const keys = JSON.parse(opts.body).params[0];
      const value = keys.map(k => {
        const sym = Object.keys(ACCOUNTS).find(s => ACCOUNTS[s][0] === k);
        if (!sym) return null;
        return { owner: OWNER, lamports: 1, executable: false, rentEpoch: 0,
          data: [mkAccount({ feedId: ACCOUNTS[sym][1], price: Math.round(CRYPTO_PX[sym] * 1e8),
            expo: -8, publishTime: now() - 4, prevPublishTime: now() - 64 }), 'base64'] };
      });
      return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result: { context: { slot: 1 }, value } }) };
    }
    if (u.includes('/v2/updates/price/latest')) {
      hermesCalls++;
      if (eq === 'down') return { ok: false, status: 503, json: async () => ({}) };
      const ids = [...u.matchAll(/ids%5B%5D=([0-9a-f]{64})|ids\[\]=([0-9a-f]{64})/g)]
        .map(m => m[1] || m[2]);
      const { FEEDS } = require('../lib/prices.js');
      const parsed = ids.map(id => {
        const sym = Object.keys(FEEDS).find(k => FEEDS[k] === id);
        if (!sym) return null;
        const px = EQ_PX[sym] ?? CRYPTO_PX[sym];
        const age = eq === 'stale' ? 300 : eq === 'future' ? -600 : 3;
        const conf = eq === 'wide' ? px * 0.05 : px * 0.0002;   // 500bps vs 2bps
        return { id, price: { price: String(Math.round(px * 1e8)), conf: String(Math.round(conf * 1e8)),
                              expo: -8, publish_time: now() - age } };
      }).filter(Boolean);
      return { ok: true, json: async () => ({ parsed }) };
    }
    // Coinbase spot, the last resort.
    const sym = (u.match(/prices\/([A-Z]+)-USD/) || [])[1];
    const px = CRYPTO_PX[sym];
    if (!px) return { ok: true, json: async () => ({ data: {} }) };
    return { ok: true, json: async () => ({ data: { amount: String(px) } }) };
  };
}

function fresh() {
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  globalThis.__ratchet_px = { t: 0, v: null, p: null };   // defeat the 6s memo
  return require('../lib/prices.js');
}
const EQ = ['TSLA', 'NVDA', 'PLTR', 'COIN', 'HOOD'];
let checks = 0;
const ok = (c, m) => { checks++; assert.ok(c, m); };

// ---- 1. healthy on-chain crypto; stocks stay held even with a secret -------
stub();
let m = fresh();
let r = await m.getPrices();
ok(r.src === 'pyth-onchain', 'primary should still be the on-chain read, got ' + r.src);
for (const [s, want] of Object.entries(CRYPTO_PX))
  ok(Math.abs(r[s] - want) < want * 1e-9, `${s} ${r[s]} != ${want}`);
for (const s of EQ) ok(r[s] === undefined, `${s} must not be enabled by an API key`);
ok(/API-keyless Pyth-on-Solana/.test(r.equityOff), 'the hold must name the product invariant');
ok(hermesCalls === 0, 'the runtime must not call Hermes, got ' + hermesCalls);

// ---- 2. a Hermes-shaped response is irrelevant; crypto is untouched --------
stub({ eq: 'stale' });
m = fresh();
r = await m.getPrices();
ok(r.src === 'pyth-onchain', 'crypto must survive a stale stock feed');
ok(Math.abs(r.SOL - CRYPTO_PX.SOL) < 1e-9, 'SOL must be untouched');
for (const s of EQ) ok(r[s] === undefined, `${s} was stale and must be absent`);
ok(typeof r.equityOff === 'string', 'a total equity drop must be stated, not silent');

// ---- 3. neither loose nor fresh HTTP equity data enters the runtime --------
stub({ eq: 'wide' });
m = fresh();
r = await m.getPrices();
for (const s of EQ) ok(r[s] === undefined, `${s} was 500bps wide and must be absent`);
ok(Math.abs(r.BTC - CRYPTO_PX.BTC) < 1e-6, 'BTC must be untouched');

// ---- 4. future-dated HTTP data is equally irrelevant -----------------------
stub({ eq: 'future' });
m = fresh();
r = await m.getPrices();
for (const s of EQ) ok(r[s] === undefined, `${s} was future-dated and must be absent`);

// ---- 5. Hermes state cannot take crypto down because it is never consulted --
stub({ eq: 'down' });
m = fresh();
r = await m.getPrices();
ok(r.src === 'pyth-onchain', 'a 503 on the equity road must not change the source');
for (const [s, want] of Object.entries(CRYPTO_PX))
  ok(Math.abs(r[s] - want) < want * 1e-9, `${s} must survive an equity outage`);
ok(typeof r.equityOff === 'string', 'the equity outage must be reported');

// ---- 6. the last resort never invents a stock ------------------------------
// Coinbase quotes no TSLA-USD, and any symbol that did resolve would be a
// different instrument from Pyth's 24/7 index mark.
stub({ chainDown: true, eq: 'down' });
m = fresh();
const cb = await m.coinbase();
ok(cb.src === 'coinbase', 'expected the coinbase route');
for (const s of EQ) ok(cb[s] === undefined, `${s} must never come from coinbase`);
ok(cb.SOL > 0 && cb.BTC > 0 && cb.ETH > 0, 'coinbase must still quote the core three');

// ---- 7. removing the old secret produces the exact same product ------------
delete process.env.PYTH_API_KEY;
stub();
m = fresh();
r = await m.getPrices();
ok(r.src === 'pyth-onchain', 'crypto is completely unaffected by having no Pyth key');
for (const [s, want] of Object.entries(CRYPTO_PX))
  ok(Math.abs(r[s] - want) < want * 1e-9, `${s} must be priced with no key at all`);
for (const s of EQ) ok(r[s] === undefined, `${s} remains held without a secret`);
ok(/API-keyless Pyth-on-Solana/.test(String(r.equityOff)), 'the invariant must be named: ' + r.equityOff);
ok(hermesCalls === 0, 'and nothing should be asked of Hermes at all, got ' + hermesCalls);
delete process.env.PYTH_API_KEY;

console.log(`EQUITY PRICES OK — ${checks} checks: API keys cannot enable stocks, `
  + `HTTP equity data is never consulted, and keyless crypto remains intact`);
