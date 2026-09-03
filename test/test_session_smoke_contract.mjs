import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {runSmoke, URLS} from '../skills/ratchetx/scripts/session-smoke.mjs';

// This is an in-process HTTP transport, not canned server responses. The real
// session adapter, authorization/CAS service, canonical game, guarded memory
// commits, Pyth capture projection and settlement selector execute below.
// Synthetic owner signing keys exist only in this process. No sockets or files
// are used by the fixture; its journal is an isolated in-memory implementation.
const require = createRequire(import.meta.url);
const removedEnvironment = new Map();
for (const name of Object.keys(process.env)) {
  if (/^(SUPABASE_|KV_|UPSTASH_|RATCHET_|SOLANA_|PYTH_|X402_)/.test(name)) {
    removedEnvironment.set(name, process.env[name]);
    delete process.env[name];
  }
}
const originalNow = Date.now;
const originalFetch = globalThis.fetch;
const originalMemory = globalThis.__ratchet_mem;
const originalGate = globalThis.__ratchet_pxgate;
let time = Date.UTC(2026, 7, 30, 12), networkAttempts = 0;
Date.now = () => time;
globalThis.fetch = async () => {
  networkAttempts++;
  throw new Error('session-smoke contract fixture forbids external connections');
};
globalThis.__ratchet_mem = new Map();
globalThis.__ratchet_pxgate = {t: 0, x: time};

const kv = require('../lib/kv.js');
assert.equal(kv.backend, 'memory', 'fixture must not use a durable backend');
const originalBackend = kv.backend, originalDurable = kv.durable;
const originalCommit = kv.commitGuarded;
const sessions = require('../lib/play_session.js');
const {PREFIX} = require('../lib/play_session_record.js');
const feeds = ['SOL', 'BTC', 'ETH', 'BONK', 'PUMP', 'JUP', 'WIF'];
let runStart = time, currentPrice = 100, canonicalAge = 0;
function prices() {
  const perFeed = value => Object.fromEntries(feeds.map(feed => [feed, value]));
  const publish = Math.floor(time / 1000);
  return {
    src: 'pyth-onchain', ...perFeed(currentPrice),
    ages: perFeed(canonicalAge), confs: perFeed(1),
    pubs: perFeed(publish), prevPubs: perFeed(publish),
    slots: perFeed(123000 + Math.floor((time - runStart) / 1000)),
    postedSlots: perFeed(122000 + Math.floor((time - runStart) / 1000)),
    emaPrices: perFeed(100), emaConfs: perFeed(1),
  };
}
const pricesPath = require.resolve('../lib/prices.js');
const originalPricesModule = require.cache[pricesPath];
require.cache[pricesPath] = {id: pricesPath, filename: pricesPath, loaded: true,
  exports: {getPrices: async () => prices(), coinbase: async () => ({})}};
const px = require('../lib/pxlog.js');
async function capture() {
  // Use the actual capture API and priceCrossing reducer. Equal previous/current
  // publish time is a valid live sponsored-account observation, not a reason to
  // reject the runner's terminal result. Capture timestamps are seconds; the
  // settled game response must convert its exitAt/prevExitAt to milliseconds.
  const snapshot = prices();
  for (const feed of feeds) {
    await px.ingestUpdate(feed, {price: snapshot[feed], publishTime: snapshot.pubs[feed],
      prevPublishTime: snapshot.prevPubs[feed], confBps: 1, receivedAt: time,
      slot: snapshot.slots[feed], postedSlot: snapshot.postedSlots[feed],
      emaPrice: 100, emaConfidenceBps: 1});
  }
}

const acceptedCommits = [];
kv.commitGuarded = async tx => {
  const accepted = tx.entries.find(entry => entry.key.startsWith(PREFIX)
    && Object.values(entry.value.requests || {}).some(request => request.state === 'accepted'));
  if (accepted) acceptedCommits.push({id: tx.id, key: accepted.key});
  return originalCommit(tx);
};
const gamePath = require.resolve('../api/game.js');
const game = require(gamePath);
const gameModule = require.cache[gamePath];
const dispatched = [];
gameModule.exports = async (req, res) => {
  if (req.method === 'POST' && req.body?.action === 'shot')
    dispatched.push({wallet: req.body.auth?.wallet, requestId: req.body.requestId});
  return game(req, res);
};
// The metadata override opens the real production HTTP gate. Storage functions
// remain the memory implementations asserted above, never Supabase or Redis.
kv.backend = 'supabase'; kv.durable = true;   // the gate asks for durability, not for a name

const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const id = n => n.toString(16).padStart(32, '0');
function base58(bytes) {
  let n = BigInt('0x' + bytes.toString('hex')), out = '';
  while (n) {out = alphabet[Number(n % 58n)] + out; n /= 58n;}
  for (const byte of bytes) {if (byte) break; out = '1' + out;}
  return out;
}
async function invoke({method = 'POST', query = {action: 'play-session'}, body,
  headers = {}, ip = 'smoke-contract-fixture'} = {}) {
  let status = 200, result;
  const responseHeaders = {};
  await gameModule.exports({method, query, body,
    headers: {'content-type': 'application/json', 'x-forwarded-for': ip, ...headers}, socket: {}}, {
    setHeader(name, value) {responseHeaders[name.toLowerCase()] = value;},
    status(value) {status = value; return this;},
    json(value) {result = value; return value;},
    end() {},
  });
  return {status, body: result, headers: responseHeaders};
}
let sequence = 0;
async function owner() {
  const {publicKey, privateKey} = crypto.generateKeyPairSync('ed25519');
  const wallet = base58(publicKey.export({format: 'der', type: 'spki'}).subarray(12));
  const sessionId = id(++sequence);
  const token = `rxp1.${wallet}.${sessionId}.${crypto.randomBytes(32).toString('hex')}`;
  const grant = sessions.canonicalGrant({wallet, id: sessionId,
    tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
    issuedAt: time, expiresAt: time + 30 * 60000,
    limits: {maxAttempts: 1, maxStakeCredits: 100, maxGrossCredits: 100, minIntervalMs: 60000}}, time);
  await kv.setJSON('u:' + wallet, {w: wallet, cr: 1000, bal: 0, granted: true,
    qualified: true, agent: {name: 'offline runner contract'}, xp: 0, streak: 0,
    best: 0, hits: 5, shots: 13, burned: 0, bn: 13, bsum: 4.0131,
    calib: {5: {n: 13, h: 5}}, day: new Date(time).toISOString().slice(0, 10),
    open: [], closed: []});
  const payload = JSON.stringify(grant);
  const response = await invoke({body: {op: 'grant', payload,
    signature: crypto.sign(null, Buffer.from(payload), privateKey).toString('base64')},
  headers: {origin: 'https://ratchetx.xyz'}});
  assert.equal(response.status, 200, 'synthetic owner grant must pass the actual signature gate');
  assert.equal(response.body.id, sessionId);
  assert.equal(await kv.getJSONStrict('lock:u:' + wallet), null);
  return {wallet, sessionId, token, tokenHash: grant.tokenHash};
}
function memoryJournal(events) {
  const entries = [];
  let created = false;
  return {entries,
    async create(value) {
      assert.equal(created, false, 'runner must create its journal exclusively');
      created = true; entries.push(structuredClone(value)); events.push({kind: 'journal-create'});
    },
    async read() {return structuredClone(entries);},
    async append(value) {
      assert.equal(created, true); entries.push(structuredClone(value));
      events.push({kind: 'journal-append', entry: value.kind});
    },
    async close() {},
  };
}
async function execute(f, {refuseAtDispatch = false} = {}) {
  const setupBoard = await invoke({method: 'GET', query: {action: 'board'}});
  assert.equal(setupBoard.status, 200);
  const target = setupBoard.body.targets.find(row => row.kind === 'dir' && row.mins === 5);
  assert.ok(target, 'real board must expose an exact five-minute directional target');
  const events = [], journal = memoryJournal(events), replies = [];
  const fetcher = async (url, options) => {
    assert.ok(Object.values(URLS).includes(url), 'runner must not use MCP or another endpoint');
    assert.equal(options.redirect, 'error');
    const address = new URL(url), body = options.body ? JSON.parse(options.body) : undefined;
    const headers = Object.fromEntries(Object.entries(options.headers).map(([key, value]) => [key.toLowerCase(), value]));
    if (options.method === 'POST') {
      assert.equal(url, URLS.session);
      assert.ok(headers.authorization === 'Bearer ' + f.token, 'fixture expects owner-bound protected bearer');
      assert.ok(['shot', 'status'].includes(body.op), 'runner must never grant, revoke, fund, sign or reload');
    } else assert.equal(headers.authorization, undefined, 'public reads must not carry a capability');
    const event = {kind: 'request', method: options.method, url, op: body?.op,
      body: options.body, at: time};
    events.push(event);
    if (body?.op === 'shot' && refuseAtDispatch) canonicalAge = 46;
    const response = await invoke({method: options.method,
      query: Object.fromEntries(address.searchParams), body, headers,
      ip: 'smoke-contract-' + f.sessionId});
    const responseCopy = structuredClone(response);
    replies.push({event, ...responseCopy});
    const wireText = JSON.stringify(response.body);
    return {status: response.status, redirected: false, url,
      headers: {get: name => name.toLowerCase() === 'date' ? new Date(time).toUTCString()
        : response.headers[name.toLowerCase()] ?? null},
      text: async () => wireText};
  };
  const result = await runSmoke({mode: 'execute', wallet: f.wallet, sessionId: f.sessionId,
    target: target.id, side: 'YES', p: 0.55, maxWaitMs: 6 * 60000, pollMs: 30000}, {
    fetch: fetcher, now: () => time - runStart, journal,
    randomId: () => id(1000 + sequence), env: {RATCHET_PLAY_SESSION: f.token},
    sleep: async ms => {
      events.push({kind: 'sleep', ms}); time += ms;
      // Memory setnxJSON intentionally omits durable TTL expiry (kv.js:247).
      // Advance only this fixture owner's five-second status throttle alongside
      // the fake clock; leave authorization/CAS/player/receipt storage untouched.
      const throttleKey = 'play-status-throttle:' + f.wallet;
      const throttle = await kv.getJSONStrict(throttleKey);
      if (throttle && time - throttle.t >= 5000) await kv.delKey(throttleKey);
      currentPrice = time - runStart >= 5 * 60000 ? 110 : 100;
      await capture();
    },
    onEvent: event => events.push({kind: 'runner-event', ...event}),
  });
  const safeOutput = JSON.stringify({result, journal: journal.entries});
  assert.ok(!safeOutput.includes(f.token), 'runner must not journal or report a capability');
  assert.ok(!safeOutput.includes(f.tokenHash), 'runner must not journal a credential verifier');
  for (const reply of replies) {
    if (reply.body?.shot?.salt)
      assert.ok(!safeOutput.includes(reply.body.shot.salt), 'journal must not persist unrevealed shot salt');
  }
  assert.equal(await kv.getJSONStrict('lock:u:' + f.wallet), null, 'canonical request must release its player lease');
  return {result, events, replies, journal, target};
}

try {
  await capture();
  const acceptedOwner = await owner();
  const beforeDispatch = dispatched.length, beforeCommits = acceptedCommits.length;
  const accepted = await execute(acceptedOwner);
  assert.equal(accepted.result.code, 'PASS_HIT', JSON.stringify(accepted.result));
  assert.equal(accepted.result.ok, true);
  assert.equal(accepted.result.immediateWireReplayVerified, true);
  assert.equal(accepted.result.debitObserved, true);
  assert.equal(accepted.result.creditsBefore, 1000);
  assert.equal(accepted.result.creditsAfter, 1070);
  assert.equal(accepted.result.statedBefore, 13);
  assert.equal(accepted.result.statedAfter, 14);
  assert.equal(accepted.result.brier, 0.3011);
  assert.ok(Math.abs(accepted.result.squaredError - 0.2025) < 1e-12);
  const shotReplies = accepted.replies.filter(reply => reply.event.op === 'shot');
  assert.equal(shotReplies.length, 2, 'execute sends exactly first submit and identical replay');
  const [submitted, replay] = shotReplies;
  assert.equal(submitted.status, 200);
  assert.equal(submitted.body.request.state, 'accepted');
  assert.equal(replay.status, 200);
  assert.equal(replay.body.idempotent, true);
  assert.deepEqual(replay.body.request, submitted.body.request, 'real retained receipt must replay unchanged');
  assert.equal(replay.body.shot, undefined, 'real replay does not return a top-level shot');
  assert.equal(replay.body.credits, undefined, 'real replay does not return top-level credits');
  assert.equal(submitted.event.body, replay.event.body, 'the two wire JSON bodies must be identical');
  const firstIndex = accepted.events.indexOf(submitted.event);
  const secondIndex = accepted.events.indexOf(replay.event);
  assert.equal(secondIndex, firstIndex + 1, 'no status, sleep, event or journal mutation may separate submit and replay');
  assert.ok(accepted.events.slice(0, firstIndex).some(event => event.kind === 'journal-create'));
  assert.equal(dispatched.length - beforeDispatch, 1, 'two session HTTP POSTs must dispatch only one canonical shot');
  assert.equal(acceptedCommits.length - beforeCommits, 1, 'one atomic player debit/accepted receipt commit');
  const record = await kv.getJSONStrict(PREFIX + acceptedOwner.wallet);
  assert.equal(record.attempts, 1);
  assert.equal(record.grossCredits, 100);
  assert.equal(record.pending, null);
  const saved = await kv.getJSONStrict('u:' + acceptedOwner.wallet);
  assert.equal(saved.cr, 1070);
  assert.equal(saved.open.length, 0);
  assert.equal(saved.closed.length, 1);
  const closed = saved.closed[0];
  assert.equal(closed.id, accepted.result.shotId);
  assert.equal(closed.res, 'hit');
  assert.equal(closed.economyMode, 'ranked');
  assert.equal(closed.exp, runStart + 5 * 60000);
  assert.equal(closed.exitAt, closed.exp, 'real priceCrossing returns millisecond exit time');
  assert.equal(closed.prevExitAt, closed.exitAt, 'equal sponsored-account publication times are valid');
  assert.equal(closed.exitSource, 'pyth-onchain-stream');
  assert.equal(closed.back, 170);
  assert.equal(saved.bn, 14);
  assert.deepEqual(saved.settlementOutbox, []);
  assert.equal((await kv.getJSONStrict('hist:' + acceptedOwner.wallet)).length, 1);
  const finalStatus = accepted.replies.filter(reply => reply.event.op === 'status').at(-1);
  assert.equal(finalStatus.body.player.closed[0].id, closed.id);
  assert.equal(finalStatus.body.player.credits, 1070);
  assert.equal(finalStatus.body.player.stated, 14);
  assert.equal(finalStatus.body.player.shots, undefined, 'runner consumes the actual narrow status schema');
  assert.equal(finalStatus.body.v, undefined, 'private status does not promise a release field');
  const tooSoon = await invoke({body: {op: 'status'},
    headers: {authorization: 'Bearer ' + acceptedOwner.token}});
  assert.equal(tooSoon.status, 429, 'fixture must still enforce an immediate repeated status refusal');
  assert.equal(tooSoon.body.code, 'SESSION_RATE_LIMIT');
  assert.equal(networkAttempts, 0);
  console.log('Session-smoke canonical contract: real submit/immediate replay, one debit, Pyth capture settlement and rounded existing Brier PASS');

  time += 60000; runStart = time; currentPrice = 100; canonicalAge = 0;
  await capture();
  const refusedOwner = await owner();
  const refusedBefore = structuredClone(await kv.getJSONStrict('u:' + refusedOwner.wallet));
  const beforeRefusedDispatch = dispatched.length, beforeRefusedCommit = acceptedCommits.length;
  const refused = await execute(refusedOwner, {refuseAtDispatch: true});
  assert.equal(refused.result.ok, false);
  assert.equal(refused.result.category, 'REFUSED');
  assert.equal(refused.result.code, 'ORACLE_STALE');
  assert.equal(refused.replies.filter(reply => reply.event.op === 'shot').length, 1,
    'canonical rejection must not cause another dispatch or fresh request ID');
  assert.equal(dispatched.length - beforeRefusedDispatch, 1);
  assert.equal(acceptedCommits.length - beforeRefusedCommit, 0);
  const refusedRecord = await kv.getJSONStrict(PREFIX + refusedOwner.wallet);
  assert.equal(refusedRecord.attempts, 1);
  assert.equal(refusedRecord.grossCredits, 100, 'refusal retains gross reserved allowance consumption');
  assert.equal(refusedRecord.pending, null);
  const refusedReceipt = Object.values(refusedRecord.requests)[0];
  assert.equal(refusedReceipt.state, 'rejected');
  assert.equal(refusedReceipt.result.code, 'ORACLE_STALE');
  const refusedAfter = await kv.getJSONStrict('u:' + refusedOwner.wallet);
  for (const field of ['cr', 'bn', 'bsum', 'open', 'closed'])
    assert.deepEqual(refusedAfter[field], refusedBefore[field], 'refusal must preserve canonical ' + field);
  assert.equal(refused.journal.entries.length, 1, 'refusal must not fabricate a replay-proof journal entry');
  assert.equal(networkAttempts, 0, 'the entire fixture must make zero external network attempts');
  console.log('Session-smoke canonical contract: post-preflight ORACLE_STALE refusal, no debit/score/replay and consumed one-attempt allowance PASS');
} finally {
  gameModule.exports = game;
  kv.backend = originalBackend; kv.durable = originalDurable;
  kv.commitGuarded = originalCommit;
  if (originalPricesModule) require.cache[pricesPath] = originalPricesModule;
  else delete require.cache[pricesPath];
  Date.now = originalNow;
  globalThis.fetch = originalFetch;
  if (originalMemory === undefined) delete globalThis.__ratchet_mem;
  else globalThis.__ratchet_mem = originalMemory;
  if (originalGate === undefined) delete globalThis.__ratchet_pxgate;
  else globalThis.__ratchet_pxgate = originalGate;
  for (const [name, value] of removedEnvironment) process.env[name] = value;
}
