// Regression contract registered before the implementation: latest accepted
// context must not depend on delivery order. No network, wallet or real funds.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
for (const key of ['KV_REST_API_URL','KV_REST_API_TOKEN','UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN','SUPABASE_URL','SUPABASE_SERVICE_KEY','SUPABASE_SERVICE_ROLE_KEY'])
  delete process.env[key];
globalThis.fetch = async () => { throw new Error('network forbidden in ordering fixture'); };
globalThis.__ratchet_mem = new Map();
globalThis.__ratchet_pxgate = {t:0, x:Date.now()};
const px = require('../lib/pxlog.js');
const {buildContext} = require('../lib/pyth_context.js');
const now = Date.now(), sec = Math.floor(now / 1000);
const base = {publishTime:sec-2, prevPublishTime:sec-2, receivedAt:now,
  emaPrice:100, emaConfidenceBps:20};
const older = {...base, price:100, confBps:20, slot:401, postedSlot:401};
const newer = {...base, price:110, confBps:199, slot:402, postedSlot:402};
const snapshot = async () => (await px.latestSnapshot(now)).feeds.SOL;
function reset() {
  globalThis.__ratchet_mem.clear();
  globalThis.__ratchet_pxgate.t = 0;
  globalThis.__ratchet_pxgate.x = Date.now();
}
function poll(update) {
  return {src:'pyth-onchain', SOL:update.price, confs:{SOL:update.confBps},
    pubs:{SOL:update.publishTime}, prevPubs:{SOL:update.prevPublishTime},
    slots:{SOL:update.slot}, postedSlots:{SOL:update.postedSlot},
    emaPrices:{SOL:update.emaPrice}, emaConfs:{SOL:update.emaConfidenceBps}};
}
for (const order of [[older,newer],[newer,older]]) {
  reset();
  for (const update of order) await px.ingestUpdate('SOL', update);
  assert.equal((await snapshot()).postedSlot, 402, 'late older arrival must not roll latest back');
  assert.equal((await snapshot()).confidenceBps, 199, 'late tight confidence cannot replace newer wide confidence');
  assert.equal((await px.evidencePathFor('SOL',now-1000,now+1000)).length, 2,
    'both same-millisecond observations remain auditable');
  await px.ingestUpdate('SOL', {...older, receivedAt:now+10000, slot:999});
  assert.equal((await snapshot()).postedSlot,402,'duplicate with later receipt/RPC slot cannot undo posted order');
}

// A late update can belong to a different bucket and therefore a different lease.
reset();
const hour = Math.floor(sec/3600)*3600;
await px.ingestUpdate('SOL',{...newer,publishTime:hour+1,prevPublishTime:hour});
await px.ingestUpdate('SOL',{...older,publishTime:hour-1,prevPublishTime:hour-2,slot:999,postedSlot:999});
assert.equal((await snapshot()).publishTime,hour+1,'publication order wins across hourly leases');

// Both capture paths must participate in the same durable high-water mark.
for (const first of ['poll','stream']) {
  reset();
  if (first === 'poll') await px.sample(poll(newer));
  else await px.ingestUpdate('SOL',newer);
  globalThis.__ratchet_pxgate.t = 0;
  await px.sample(poll(older));
  await px.ingestUpdate('SOL',older);
  assert.equal((await snapshot()).postedSlot,402,'poll/stream races cannot displace newer context');
}
reset();
await px.sample(poll(newer));
globalThis.__ratchet_pxgate.t=0;
await px.sample({src:'coinbase',SOL:999});
assert.equal((await snapshot()).price,110,'display fallback is never relabelled as Pyth context');

reset();
await px.ingestUpdate('SOL',newer);
await px.ingestUpdate('SOL',{...newer,price:111,confBps:200,postedSlot:403,slot:403});
await assert.rejects(px.ingestUpdate('SOL',{...newer,price:112,confBps:201,postedSlot:404,slot:404}),
  /invalid update/,'confidence limit remains 200 bps');
await px.ingestUpdate('SOL',older);
assert.equal((await snapshot()).confidenceBps,200,'rejected widening plus delayed older update cannot narrow last accepted context');
const context = buildContext({snapshot:await px.latestSnapshot(now),health:null,targets:[],feed:'SOL',now});
assert.equal(context.feeds[0].status,'current','EMA lag alone does not freeze valid context');
assert.equal(context.feeds[0].current.priceVsEmaBps,1100);

// Context projection and first-observed admissible settlement are different rules.
reset();
const expiry = (sec-2)*1000;
await px.ingestUpdate('SOL',newer);
await px.ingestUpdate('SOL',older);
const crossing = await px.priceCrossing('SOL',expiry,now);
assert.equal(crossing.price,100,'settlement still uses earliest admissible retained slot');
assert.equal((await snapshot()).price,110,'latest context uses newest retained slot');

// Rolling deployment: seed once from legacy state, then ignore unconditional
// writes left in flight by h97. Reading alone must never write a projection.
reset();
const kv=require('../lib/kv.js');
const legacy={observedAt:now,source:'pyth-onchain-stream',price:110,
  publishTime:base.publishTime,prevPublishTime:base.prevPublishTime,
  confidenceBps:199,rpcSlot:402,postedSlot:402,emaPrice:100,emaConfidenceBps:20};
await kv.setJSONEx('pxlatest:BTC',legacy,3600);
const beforeRead=globalThis.__ratchet_mem.size;
let view=await px.latestSnapshot(now);
assert.equal(view.feeds.BTC.postedSlot,402);
assert.ok(view.projection.legacyFeeds.includes('BTC'));
assert.equal(globalThis.__ratchet_mem.size,beforeRead,'legacy bootstrap reads remain read-only');
await px.ingestUpdate('BTC',older);
await kv.setJSONEx('pxlatest:BTC',{...legacy,postedSlot:401,price:100},3600);
view=await px.latestSnapshot(now);
assert.equal(view.feeds.BTC.postedSlot,402,'old deployment cannot overwrite versioned high-water mark');
assert.ok(view.projection.atomicFeeds.includes('BTC'));
assert.ok(!view.projection.legacyFeeds.includes('BTC'));
console.log('Pyth ordering: both arrival orders, duplicates, hour boundaries, poll/stream races, 199/200/201 bps and unchanged settlement pass');
