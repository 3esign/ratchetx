import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
process.env.RATCHET_CAPTURE_SECRET = 'test-capture-secret';
globalThis.__ratchet_mem = new Map();

const px = require('../lib/pxlog.js');

// Exact crossing events survive overlapping workers and settle deterministically.
const expiry = Date.UTC(2026, 7, 23, 12, 34, 0, 500);
const transition = {
  price:93.25,
  publishTime:Math.floor((expiry + 12_500) / 1000),
  prevPublishTime:Math.floor((expiry - 47_500) / 1000),
  confBps:4.2,
  receivedAt:expiry + 13_000,
  slot:123456,
};
assert.equal(await px.ingestUpdate('SOL', transition), true);
assert.equal(await px.ingestUpdate('SOL', transition), false, 'overlap must deduplicate');
assert.equal(await px.ingestUpdate('BONK', {
  ...transition, price:0.00001234,
  prevPublishTime:transition.publishTime,
}), true, 'same-second consecutive Pyth publishes are valid evidence');
const crossing = await px.priceCrossing('SOL', expiry, expiry + 60_000, 'pyth-onchain');
assert.equal(crossing.price, 93.25);
assert.equal(crossing.row.src, 'pyth-onchain-stream');
assert.equal(crossing.publishTime, transition.publishTime * 1000);
const path = await px.pathFor('SOL', expiry, expiry + 60_000);
assert.deepEqual(path, [[transition.receivedAt, 93.25]]);
const health = await px.streamHealth(transition.receivedAt + 1000);
assert.equal(health.feeds.SOL.active, true);
assert.equal(health.feeds.BTC.active, false);

// Byte-exact PriceUpdateV2 fixture: the API must revalidate what the Worker saw.
const { ACCOUNTS } = require('../lib/onchain_px.js');
const DISC = crypto.createHash('sha256').update('account:PriceUpdateV2').digest().subarray(0,8);
const OWNER = 'pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT';
function number(fn, value, bytes) {
  const b = Buffer.alloc(bytes); b[fn](value, 0); return b;
}
function accountData(feedId, publishTime, prevPublishTime) {
  const price = 6125050000000n;
  return Buffer.concat([
    DISC, crypto.randomBytes(32), Buffer.from([1]), Buffer.from(feedId, 'hex'),
    number('writeBigInt64LE', price, 8),
    number('writeBigUInt64LE', 2450020000n, 8),
    number('writeInt32LE', -8, 4),
    number('writeBigInt64LE', BigInt(publishTime), 8),
    number('writeBigInt64LE', BigInt(prevPublishTime), 8),
    number('writeBigInt64LE', price, 8),
    number('writeBigUInt64LE', 1n, 8),
    number('writeBigUInt64LE', 999n, 8),
  ]).toString('base64');
}

const now = Math.floor(Date.now() / 1000);
const update = {
  account:ACCOUNTS.BTC[0],
  owner:OWNER,
  data:accountData(ACCOUNTS.BTC[1], now - 1, now - 61),
  slot:987654,
};
const game = require('../api/game.js');
async function request({ method='POST', action='oracle-ingest', body={}, authorization='', ip='stream-test' }) {
  return new Promise((resolve, reject) => {
    const req = { method, query:{ action }, body:{ action, ...body },
      headers:{ authorization, 'x-forwarded-for':ip }, socket:{} };
    const res = { code:200, headers:{},
      setHeader(k,v){ this.headers[k]=v; },
      status(n){ this.code=n; return this; },
      json(value){ resolve({ status:this.code, body:value, headers:this.headers }); },
      end(value){ resolve({ status:this.code, body:value, headers:this.headers }); } };
    game(req,res).catch(reject);
  });
}

let response = await request({ body:{ updates:[update] } });
assert.equal(response.status, 401, 'unauthenticated stream rejected');
response = await request({ body:{ updates:[update] },
  authorization:'Bearer test-capture-secret' });
assert.equal(response.status, 200);
assert.equal(response.body.accepted, 1);
response = await request({ body:{ updates:[update] },
  authorization:'Bearer test-capture-secret' });
assert.equal(response.body.accepted, 0);
assert.equal(response.body.duplicates, 1);
response = await request({ body:{ updates:[{...update, owner:'bad-owner'}] },
  authorization:'Bearer test-capture-secret' });
assert.equal(response.status, 400, 'wrong owner rejected before storage');

response = await request({ method:'GET', action:'stream-health', ip:'stream-health-test' });
assert.equal(response.status, 200);
assert.equal(response.body.source, 'solana-accountSubscribe');
assert.equal(response.body.stream.feeds.BTC.active, true);

// Cloudflare's parser must bind the subscription id to the exact account.
const worker = await import('../ops/heartbeat-worker/worker.js');
const subscriptions = new Map([[77, ACCOUNTS.BTC[0]]]);
const parsed = worker.extractAccountNotification({
  method:'accountNotification',
  params:{ subscription:77, result:{ context:{slot:42},
    value:{ owner:OWNER, data:[update.data,'base64'] } } },
}, subscriptions);
assert.deepEqual(parsed, { account:ACCOUNTS.BTC[0], owner:OWNER, data:update.data, slot:42 });
assert.equal(worker.extractAccountNotification({ method:'slotNotification' }, subscriptions), null);

// A dropped socket reconnects inside the same cron session. Overlapping initial
// notifications are harmless because the backend is the idempotency boundary.
let sockets = 0, posted = 0;
const accountValues = new Map();
for (const [account, spec] of Object.values(ACCOUNTS).map(spec => [spec[0], spec])) {
  accountValues.set(account, {
    owner:OWNER,
    data:[accountData(spec[1], now - 1, now - 61), 'base64'],
  });
}
class MockWebSocket {
  constructor() {
    this.id = ++sockets;
    this.listeners = new Map();
    setTimeout(() => this.emit('open', {}), 0);
  }
  addEventListener(name, fn) { this.listeners.set(name, fn); }
  emit(name, value) { const fn = this.listeners.get(name); if (fn) fn(value); }
  send(raw) {
    const req = JSON.parse(raw);
    const subscription = this.id * 100 + req.id;
    setTimeout(() => {
      this.emit('message', { data:JSON.stringify({ id:req.id, result:subscription }) });
      this.emit('message', { data:JSON.stringify({
        method:'accountNotification',
        params:{ subscription, result:{ context:{slot:1000 + this.id},
          value:accountValues.get(req.params[0]) } },
      }) });
      if (this.id === 1 && req.id === 7) this.close();
    }, 0);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    setTimeout(() => this.emit('close', {}), 0);
  }
}
const realFetch = globalThis.fetch;
globalThis.fetch = async (_url, options) => {
  const batch = JSON.parse(options.body).updates;
  posted += batch.length;
  return new Response(JSON.stringify({ ok:true, accepted:batch.length, duplicates:0 }),
    { status:200, headers:{'content-type':'application/json'} });
};
const streamRun = await worker.runStream(
  { CAPTURE_SECRET:'test-capture-secret', TARGET:'https://unit.test/api/game' },
  { WebSocket:MockWebSocket, sessionMs:1250, backoffMs:1, maxBackoffMs:2 });
globalThis.fetch = realFetch;
assert.ok(streamRun.connections >= 2, 'socket close must reconnect in the same cron session');
assert.equal(streamRun.subscriptions, 7);
assert.ok(posted >= 14, 'initial account states from overlapping sessions are forwarded');

// Cloudflare fetch(Upgrade) returns an already accepted socket and emits no
// future open event. The Worker must subscribe immediately on that path.
let acceptedSocket = null, upgradePosts = 0;
class AcceptedSocket {
  constructor() { this.listeners = new Map(); this.id = 50; }
  accept() { this.accepted = true; }
  addEventListener(name, fn) { this.listeners.set(name, fn); }
  emit(name, value) { const fn = this.listeners.get(name); if (fn) fn(value); }
  send(raw) {
    const req = JSON.parse(raw);
    const subscription = 5000 + req.id;
    setTimeout(() => {
      this.emit('message', { data:JSON.stringify({ id:req.id, result:subscription }) });
      this.emit('message', { data:JSON.stringify({
        method:'accountNotification',
        params:{ subscription, result:{ context:{slot:2000},
          value:accountValues.get(req.params[0]) } },
      }) });
    }, 0);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    setTimeout(() => this.emit('close', {}), 0);
  }
}
globalThis.fetch = async (_url, options) => {
  if (options && options.headers && options.headers.Upgrade === 'websocket') {
    acceptedSocket = new AcceptedSocket();
    return { status:101, webSocket:acceptedSocket };
  }
  const batch = JSON.parse(options.body).updates;
  upgradePosts += batch.length;
  return new Response(JSON.stringify({ ok:true, accepted:batch.length, duplicates:0 }),
    { status:200, headers:{'content-type':'application/json'} });
};
const upgradeRun = await worker.runStream(
  { CAPTURE_SECRET:'test-capture-secret', TARGET:'https://unit.test/api/game',
    SOLANA_WS:'wss://unit.test/' },
  { sessionMs:1250, backoffMs:1, maxBackoffMs:2 });
globalThis.fetch = realFetch;
assert.equal(acceptedSocket.accepted, true);
assert.equal(upgradeRun.connections, 1, 'accepted socket subscribes without waiting for open');
assert.equal(upgradeRun.subscriptions, 7);
assert.equal(upgradePosts, 7);

// A backend outage backs off instead of exhausting Cloudflare subrequests.
let outageAttempts = 0;
globalThis.fetch = async (_url, options) => {
  if (options && options.headers && options.headers.Upgrade === 'websocket')
    return { status:101, webSocket:new AcceptedSocket() };
  outageAttempts++;
  if (outageAttempts <= 2)
    return new Response('temporary store outage', { status:503 });
  const batch = JSON.parse(options.body).updates;
  return new Response(JSON.stringify({ ok:true, accepted:batch.length, duplicates:0 }),
    { status:200, headers:{'content-type':'application/json'} });
};
const outageRun = await worker.runStream(
  { CAPTURE_SECRET:'test-capture-secret', TARGET:'https://unit.test/api/game',
    SOLANA_WS:'wss://unit.test/' },
  { sessionMs:3000, backoffMs:1, maxBackoffMs:2 });
globalThis.fetch = realFetch;
assert.equal(outageRun.postErrors, 2);
assert.ok(outageRun.accepted >= 7, 'pending account updates recover after outage');
assert.ok(outageAttempts <= 4, 'exponential backoff bounds subrequests');

console.log('stream capture: exact crossing, idempotency, service auth, byte validation, reconnect, accepted-upgrade lifecycle, bounded outage retry and Worker parsing all pass');
