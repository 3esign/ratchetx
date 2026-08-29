import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
globalThis.__ratchet_mem = new Map();
globalThis.__ratchet_pxgate = { t:0, x:Date.now() };
globalThis.__ratchet_fhreport = new Map();

const pricesPath = require.resolve('../lib/prices.js');
const burnPath = require.resolve('../lib/burn.js');
let forbiddenReads = 0;
require.cache[pricesPath] = { id:pricesPath, filename:pricesPath, loaded:true, exports:{
  getPrices:async () => { forbiddenReads++; throw new Error('agent read triggered oracle RPC'); },
  coinbase:async () => ({ src:'coinbase' }),
} };
require.cache[burnPath] = { id:burnPath, filename:burnPath, loaded:true, exports:{
  INCINERATOR:'1nc1nerator11111111111111111111111111111111',
  rpcCall:async()=>null, getTx:async()=>null, decideBurn:()=>({ok:false,reason:'stub'}),
} };

const px = require('../lib/pxlog.js');
const { buildContext, parsePathRequest, pathResponse } = require('../lib/pyth_context.js');
const FEEDS = px.FEEDS;
const now = Date.now();
const sec = Math.floor(now / 1000);
const prices = {
  src:'pyth-onchain',
  ages:Object.fromEntries(FEEDS.map(f => [f, 4])),
  confs:Object.fromEntries(FEEDS.map(f => [f, 3.5])),
  pubs:Object.fromEntries(FEEDS.map(f => [f, sec - 4])),
  prevPubs:Object.fromEntries(FEEDS.map(f => [f, sec - 64])),
  slots:Object.fromEntries(FEEDS.map(f => [f, 400])),
  postedSlots:Object.fromEntries(FEEDS.map(f => [f, 390])),
  emaPrices:Object.fromEntries(FEEDS.map((f, i) => [f, 100 + i])),
  emaConfs:Object.fromEntries(FEEDS.map(f => [f, 2.1])),
};
FEEDS.forEach((f, i) => { prices[f] = 101 + i; });
assert.equal(await px.sample(prices), true, 'one capture writes the shared polling snapshot');

let snapshot = await px.latestSnapshot(now);
assert.equal(snapshot.feeds.SOL.price, 101);
assert.equal(snapshot.feeds.SOL.emaPrice, 100);
assert.equal(snapshot.feeds.SOL.rpcSlot, 400);
assert.equal(snapshot.feeds.SOL.source, 'pyth-onchain-poll');

await px.ingestUpdate('SOL', {
  price:102, publishTime:sec - 4, prevPublishTime:sec - 64,
  confBps:2.5, receivedAt:now + 1, slot:401, postedSlot:391,
  emaPrice:100.5, emaConfidenceBps:1.9,
});
await px.ingestUpdate('SOL', {
  price:103, publishTime:sec - 3, prevPublishTime:sec - 4,
  confBps:2.4, receivedAt:now + 1, slot:402, postedSlot:392,
  emaPrice:100.6, emaConfidenceBps:1.8,
});
await px.ingestUpdate('BTC', {
  price:202, publishTime:sec - 3, prevPublishTime:sec - 63,
  confBps:0, receivedAt:now + 1, slot:402, postedSlot:392,
  emaPrice:null, emaConfidenceBps:null,
});
snapshot = await px.latestSnapshot(now + 2);
assert.equal(snapshot.feeds.SOL.price, 103,
  'newer posted slot from the shared stream wins the same-second tie');
assert.equal(snapshot.feeds.SOL.emaPrice, 100.6);
assert.equal(snapshot.feeds.BTC.source, 'pyth-onchain-stream');
assert.equal(snapshot.feeds.BTC.confidenceBps, 0, 'a real zero confidence value is preserved');
assert.equal(snapshot.feeds.BTC.emaPrice, null, 'an absent EMA never turns into zero');
assert.equal(snapshot.feeds.BTC.emaConfidenceBps, null,
  'an absent EMA confidence never turns into zero');
assert.equal(snapshot.feeds.ETH.source, 'pyth-onchain-poll',
  'feeds without a newer stream transition keep the shared poll snapshot');

const health = {
  windowHours:24, ourDutyPct:98, samples:59, expectedSamples:60,
  feeds:Object.fromEntries(FEEDS.map(f => [f, {
    samples:59, misses:1, coverage:98.3, telemetry:59, thin:false, minObs:30,
    updates:20, blindWindows:1, rewinds:0, gapMedS:60, gapP95S:61,
    gapMaxS:62, ageMedS:4, ageP95S:8, ageMaxS:12,
    confMedBps:3, confP95Bps:5, confMaxBps:7, staleWindows:0,
  }])),
  settle:Object.fromEntries(FEEDS.map(f => [f, { settled:10, deferred:1, voided:0 }])),
};
const context = buildContext({ snapshot, health,
  targets:[{id:'S1',kind:'dir',feed:'SOL',feed2:null,mins:5,label:'SOL higher'}],
  feed:'SOL', now });
assert.equal(context.schema, 'ratchetx-pyth-context-v1');
assert.equal(context.pyth.provider, 'Pyth Network');
assert.equal(context.access.requestTriggeredOracleRead, false);
assert.equal(context.feeds.length, 1);
assert.equal(context.feeds[0].current.priceVsEmaBps, 238.569);
assert.equal(context.feeds[0].activeTargets[0].id, 'S1');
assert.match(context.notASignal, /not a direction/);

const detailed = await px.evidencePathFor('SOL', now - 1000, now + 1000);
assert.ok(detailed.some(p => p.source === 'pyth-onchain-stream'
  && p.confidenceBps === 2.5 && p.emaPrice === 100.5));
const streamOnly = await px.evidencePathFor('SOL', now - 1000, now + 1000,
  'pyth-onchain-stream');
assert.equal(streamOnly.length, 2);
assert.equal(streamOnly[0].observedAt, streamOnly[1].observedAt,
  'fixture reproduces two valid transitions captured in the same millisecond');
const firstPageRequest = parsePathRequest({ feed:'SOL', from:now - 1000,
  to:now + 1000, source:'stream', limit:1 });
const firstPage = pathResponse(firstPageRequest, streamOnly);
assert.ok(firstPage.nextCursor, 'a truncated path returns an opaque composite cursor');
const secondPageRequest = parsePathRequest({ feed:'SOL', from:now - 1000,
  to:now + 1000, source:'stream', limit:1, cursor:firstPage.nextCursor });
const secondPage = pathResponse(secondPageRequest, streamOnly);
assert.equal(secondPage.returned, 1,
  'the next page retains the second transition with the identical observedAt');
assert.notDeepEqual(secondPage.points[0], firstPage.points[0]);
assert.throws(() => parsePathRequest({ feed:'BTC', from:now - 1000,
  to:now + 1000, source:'stream', limit:1, cursor:firstPage.nextCursor }),
  /cursor is invalid/, 'a continuation cursor is bound to the original path request');
const request = parsePathRequest({ feed:'SOL', from:now - 1000, to:now + 1000, limit:1 });
const bounded = pathResponse(request, detailed);
assert.equal(bounded.returned, 1);
assert.equal(bounded.truncated, detailed.length > 1);
assert.throws(() => parsePathRequest({ feed:'SOL', from:now - 27*3600e3, to:now }),
  /26 hours/);

const game = require('../api/game.js');
async function call(action, query = {}) {
  let status = 200, body;
  const req = { method:'GET', query:{ action, ...query },
    headers:{'x-forwarded-for':'pyth-context-test'}, socket:{} };
  const res = { status(n){status=n;return this;}, setHeader(){},
    json(value){body=value;return value;}, end(){} };
  await game(req, res);
  return { status, body };
}
const liveContext = await call('pyth-context', { feed:'SOL', hours:'24' });
assert.equal(liveContext.status, 200);
assert.equal(liveContext.body.access.requestTriggeredOracleRead, false);
assert.equal(liveContext.body.feeds[0].feed, 'SOL');
const livePath = await call('pyth-path',
  { feed:'SOL', from:String(now-1000), to:String(now+1000), limit:'10' });
assert.equal(livePath.status, 200);
assert.ok(livePath.body.points.length >= 1);
assert.equal(forbiddenReads, 0,
  'context and path routes never invoke getPrices or create an oracle RPC read');

console.log('Pyth agent context: shared snapshot, EMA/confidence/slots, bounded path and zero per-reader oracle calls pass');
