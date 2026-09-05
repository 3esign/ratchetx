// A STORE OUTAGE IS NOT A BUG IN THIS CODE, AND MUST NOT ANSWER LIKE ONE.
//
// Observed live 2026-09-05: every game action returned
//     500 {"ok":false,"reason":"fetch failed"}
// while /api/proof, from the same build, answered normally. The deployment was
// healthy; the store was unreachable. But 500 means "this code is broken",
// which sends whoever is debugging to the wrong place — and it is what
// monitoring, retry logic and CDNs all read it as.
//
// The distinction has to be kept in BOTH directions, which is why this test
// asserts the 500 path as hard as the 503 one. Turning every failure into a
// polite 503 would hide real bugs behind a reassuring message, which is worse
// than the problem it fixes.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

process.env.RATCHET_MINT = process.env.RATCHET_MINT || 'FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump';
delete process.env.RX_MIGRATION_FREEZE;

// Recovery reads display-only token metadata. Supply it locally so the test
// depends only on its store fixture. Record rejected requests as well as
// throwing: the runtime catches fetch failures, but the suite must not hide one.
const metadataUrl = 'https://frontend-api-v3.pump.fun/coins/' + process.env.RATCHET_MINT;
let metadataFetches = 0, unexpectedNetworkCalls = 0;
globalThis.fetch = async (url, options = {}) => {
  if (String(url) !== metadataUrl || (options.method || 'GET') !== 'GET') {
    unexpectedNetworkCalls++;
    throw new Error('UNEXPECTED_NETWORK_CALL_IN_STORE_OUTAGE_TEST');
  }
  metadataFetches++;
  return { ok:true, status:200, json:async () => ({ usd_market_cap:123456 }) };
};

const pricesPath = require.resolve('../lib/prices.js');
const burnPath = require.resolve('../lib/burn.js');
const gamePath = require.resolve('../api/game.js');
const FEEDS = ['SOL','BTC','ETH','BONK','WIF','JUP','PUMP'];
const PX = { src:'pyth-onchain', SOL:100, BTC:60000, ETH:2000, BONK:0.000002, WIF:0.1, JUP:0.2, PUMP:0.005 };
require.cache[pricesPath] = { id:pricesPath, filename:pricesPath, loaded:true, exports:{ getPrices: async () => {
  const t = Math.floor(Date.now()/1000);
  return { ...PX, ages:Object.fromEntries(FEEDS.map(f=>[f,1])), confs:Object.fromEntries(FEEDS.map(f=>[f,10])),
    pubs:Object.fromEntries(FEEDS.map(f=>[f,t])), prevPubs:Object.fromEntries(FEEDS.map(f=>[f,t-60])),
    slots:Object.fromEntries(FEEDS.map((f,i)=>[f,300000+i])), postedSlots:Object.fromEntries(FEEDS.map((f,i)=>[f,299900+i])),
    emaPrices:Object.fromEntries(FEEDS.map(f=>[f,PX[f]])), emaConfs:Object.fromEntries(FEEDS.map(f=>[f,8])) }; } } };
require.cache[burnPath] = { id:burnPath, filename:burnPath, loaded:true,
  exports:{ INCINERATOR:'1nc1nerator11111111111111111111111111111111',
    rpcCall: async () => null, getTx: async () => null, decideBurn: () => ({ ok:false }) } };

const game = require('../api/game.js');
const mem = globalThis.__ratchet_mem;
const real = { get: mem.get.bind(mem), set: mem.set.bind(mem), has: mem.has.bind(mem), delete: mem.delete.bind(mem) };
const restore = () => Object.assign(mem, real);

/** Make every store operation throw the way an unreachable Upstash does. */
const withStoreThrowing = async (message, fn) => {
  const boom = () => { throw new Error(message); };
  for (const k of ['get','set','has','delete']) mem[k] = boom;
  try { return await fn(); } finally { restore(); }
};

const call = () => new Promise(resolve => {
  const req = { method:'GET', query:{ action:'state' }, body:null, headers:{}, socket:{} };
  const res = { _s:200, setHeader(){}, status(c){ this._s = c; return this; },
    json(b){ resolve({ status:this._s, body:b }); } };
  game(req, res).catch(e => resolve({ status:'THREW', body:String(e && e.message || e) }));
});

let checks = 0, fails = 0;
const ok = (c, n) => { checks++; console.log((c?'PASS':'FAIL')+'  '+n); if(!c) fails++; };

// silence the deliberate console.error the handler makes
const realErr = console.error; console.error = () => {};

// ---- 1. an unreachable store answers 503, and says nothing is lost --------
for (const msg of ['fetch failed', 'ECONNREFUSED 10.0.0.1:6379', 'ETIMEDOUT',
                   'getaddrinfo ENOTFOUND upstash.io', 'socket hang up']) {
  const r = await withStoreThrowing(msg, call);
  ok(r.status === 503, `"${msg}" → 503, not 500`);
  ok(r.body.code === 'STORE_UNAVAILABLE', `"${msg}" → named STORE_UNAVAILABLE`);
  ok(r.body.retry === true, `"${msg}" → tells the client to retry`);
  ok(/safe and nothing has been lost/.test(r.body.reason || ''),
    `"${msg}" → says the player's balance is safe, because it is`);
}

// ---- 2. a quota ceiling is a DIFFERENT operator problem -------------------
// Waiting fixes one of these and does not fix the other, so they must not
// share a message.
for (const msg of ['429 Too Many Requests', 'max requests limit exceeded', 'monthly quota exceeded']) {
  const r = await withStoreThrowing(msg, call);
  ok(r.status === 503 && r.body.code === 'STORE_LIMIT',
    `"${msg}" → STORE_LIMIT, distinct from an unreachable store`);
  ok(/request limit/.test(r.body.reason || ''), `"${msg}" → the reason names the limit`);
}

// ---- 3. A GENUINE BUG STILL RETURNS 500 ----------------------------------
// The half that keeps this honest. If everything became 503 the site would look
// calm while broken, and nobody would go looking.
for (const msg of ["Cannot read properties of undefined (reading 'x')",
                   'foo is not a function', 'Assignment to constant variable']) {
  const r = await withStoreThrowing(msg, call);
  ok(r.status === 500, `a real bug ("${msg}") still returns 500`);
  ok(!r.body.code, 'and carries no reassuring store code');
  ok(r.body.reason === msg, 'and reports the actual message, for whoever is debugging');
}

// ---- 4. the store works again the moment it comes back -------------------
// No latch, no circuit breaker, no manual reset: the next request simply works.
{
  restore();
  const r = await call();
  ok(r.status === 200 && r.body.ok === true,
    'recovery needs no intervention — the next request after the store returns is served normally');
}

console.error = realErr;
ok(metadataFetches === 1, 'OFFLINE: recovery consumed the deterministic metadata fixture once');
ok(unexpectedNetworkCalls === 0, 'OFFLINE: no unexpected network request escaped the fixtures');
console.log(fails
  ? `\nFAIL  store outage: ${fails} of ${checks} checks failed`
  : `\nPASS  store outage: ${checks} checks — outage and quota answer 503 honestly, a real bug still answers 500`);
process.exitCode = fails ? 1 : 0;
