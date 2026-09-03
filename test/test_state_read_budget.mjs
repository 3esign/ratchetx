// A budget, not a benchmark. One `action=state` is the most-repeated request the
// game makes -- a connected client sends it every ten seconds -- so its cost in
// store touches is a number worth pinning. It was 14 before the display memo;
// this fails if it climbs back.
//
// It counts what actually touches the store rather than what calls a wrapper:
// getCached lives inside kv.js and hits the module-internal getJSON, invisible
// from outside, so counting the exported functions would have reported thirteen
// reads for a memo that made none.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

for (const name of ['KV_REST_API_URL','UPSTASH_REDIS_REST_URL','SUPABASE_URL','SUPABASE_SERVICE_KEY'])
  delete process.env[name];
process.env.RATCHET_MINT ||= 'FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump';

const FEEDS = ['SOL','BTC','ETH','BONK','WIF','JUP','PUMP'];
const pricesPath = require.resolve(path.join(ROOT, 'lib', 'prices.js'));
require.cache[pricesPath] = { id:pricesPath, filename:pricesPath, loaded:true, exports:{
  getPrices: async () => { const t = Math.floor(Date.now()/1000); return { src:'pyth-onchain',
    SOL:100, BTC:60000, ETH:2000, BONK:0.000002, WIF:0.1, JUP:0.2, PUMP:0.005,
    ages:Object.fromEntries(FEEDS.map(f=>[f,2])), confs:Object.fromEntries(FEEDS.map(f=>[f,10])),
    pubs:Object.fromEntries(FEEDS.map(f=>[f,t])), prevPubs:Object.fromEntries(FEEDS.map(f=>[f,t-60])),
    slots:Object.fromEntries(FEEDS.map(f=>[f,1])), postedSlots:Object.fromEntries(FEEDS.map(f=>[f,1])) }; },
  coinbase: async () => ({ src:'coinbase' }), FEEDS:{}, EQUITY:new Set(), EQUITY_OFF:'held' } };
const burnPath = require.resolve(path.join(ROOT, 'lib', 'burn.js'));
require.cache[burnPath] = { id:burnPath, filename:burnPath, loaded:true, exports:{
  INCINERATOR:'1nc1nerator11111111111111111111111111111111',
  rpcCall: async m => m === 'getTokenAccountsByOwner' ? { value:[] } : null,
  getTx: async()=>null, decideBurn:()=>({ok:false,reason:'budget-probe'}) } };

const mem = globalThis.__ratchet_mem || (globalThis.__ratchet_mem = new Map());
let touches = 0;
const realGet = mem.get.bind(mem);
mem.get = key => { touches++; return realGet(key); };

const game = require(path.join(ROOT, 'api', 'game.js'));
const WALLET = 'HXFDaHyZ3i477z1BakiTWZg9UQN8rcreruuv9ifC1HvM';
const call = query => new Promise((resolve, reject) => {
  const req = { method:'GET', query, headers:{'x-forwarded-for':'budget-probe'}, socket:{} };
  const res = { _status:200, status(c){ this._status=c; return this; },
    json(body){ resolve({ status:this._status, body }); },
    setHeader(){ return this; }, end(){ resolve({ status:this._status }); } };
  game(req, res).catch(reject);
});

// Steady state, not the first call. The first request of an instance's life
// warms caches and does the housekeeping nobody else has done yet -- 55 touches
// here -- and the second still pays for what the first invalidated. What a
// player actually costs is the fourth poll and every one after it.
const BUDGET = 6;
for (let i = 0; i < 3; i++) await call({ action:'state', wallet:WALLET });
touches = 0;
const steady = await call({ action:'state', wallet:WALLET });
const cost = touches;

assert.equal(steady.status, 200, 'the probe must actually get a state response');
assert.ok(steady.body && steady.body.ok, 'and it must be a real one');
assert.ok(cost > 0, 'a state read that touches nothing is measuring nothing');
assert.ok(cost <= BUDGET,
  `one steady-state action=state now costs ${cost} store touches, budget is ${BUDGET}. ` +
  'If this is a deliberate new read, raise the budget in the same commit and say why. ' +
  'Two of the remaining touches are the pot pointers, which rolloverPots refuses to cache ' +
  'on purpose -- a test caught a payout firing late when they were. Do not "fix" those.');

console.log(`PASS  state read budget: ${cost} store touches per steady-state action=state (budget ${BUDGET})`);
