import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {runPlay, commandRequestId, URLS} from '../skills/ratchetx/scripts/session-play.mjs';

// Real HTTP adapter, capability service, game, guarded memory commits and Pyth
// capture settlement; only transport, clock, oracle observations and journal are
// fixtures. Synthetic signing keys never leave this process. No live requests.
const require = createRequire(import.meta.url);
const removedEnvironment = new Map();
for (const name of Object.keys(process.env)) {
  if (/^(SUPABASE_|KV_|UPSTASH_|RATCHET_|SOLANA_|PYTH_|X402_)/.test(name)) {
    removedEnvironment.set(name, process.env[name]);
    delete process.env[name];
  }
}
const originalNow = Date.now, originalFetch = globalThis.fetch;
const originalMemory = globalThis.__ratchet_mem, originalGate = globalThis.__ratchet_pxgate;
const epoch = Date.UTC(2026, 7, 30, 12);
let time = epoch, shotStart = time, currentPrice = 100, networkAttempts = 0;
let runtimeSource = 'pyth-onchain', flipSourceAfterBoard = false;
Date.now = () => time;
globalThis.fetch = async () => {
  networkAttempts++;
  throw new Error('session-play contract fixture forbids external connections');
};
globalThis.__ratchet_mem = new Map();
globalThis.__ratchet_pxgate = {t: 0, x: time};
const kv = require('../lib/kv.js');
assert.equal(kv.backend, 'memory', 'fixture must use memory storage implementations');
const originalBackend = kv.backend, originalCommit = kv.commitGuarded;
const sessions = require('../lib/play_session.js');
const {PREFIX} = require('../lib/play_session_record.js');
const feeds = ['SOL', 'BTC', 'ETH', 'BONK', 'PUMP', 'JUP', 'WIF'];
function prices() {
  const all = value => Object.fromEntries(feeds.map(feed => [feed, value]));
  const publish = Math.floor(time / 1000), slot = Math.floor((time - epoch) / 1000);
  return {src: runtimeSource, ...all(currentPrice), ages: all(0), confs: all(1),
    pubs: all(publish), prevPubs: all(publish), slots: all(123000 + slot),
    postedSlots: all(122000 + slot), emaPrices: all(100), emaConfs: all(1)};
}
const pricesPath = require.resolve('../lib/prices.js');
const originalPricesModule = require.cache[pricesPath];
require.cache[pricesPath] = {id: pricesPath, filename: pricesPath, loaded: true,
  exports: {getPrices: async () => prices(), coinbase: async () => ({})}};
const px = require('../lib/pxlog.js');
async function capture() {
  const p = prices();
  for (const feed of feeds) await px.ingestUpdate(feed, {price: p[feed],
    publishTime: p.pubs[feed], prevPublishTime: p.prevPubs[feed], confBps: 1,
    receivedAt: time, slot: p.slots[feed], postedSlot: p.postedSlots[feed],
    emaPrice: 100, emaConfidenceBps: 1});
}
const acceptedCommits = [];
kv.commitGuarded = async tx => {
  if (tx.entries.some(entry => entry.key.startsWith(PREFIX)
    && Object.values(entry.value.requests || {}).some(r => r.state === 'accepted')))
    acceptedCommits.push(tx.id);
  return originalCommit(tx);
};
const game = require('../api/game.js');
const gameModule = require.cache[require.resolve('../api/game.js')];
const dispatched = [];
gameModule.exports = async (req, res) => {
  if (req.method === 'POST' && req.body?.action === 'shot') dispatched.push(req.body.requestId);
  return game(req, res);
};
// Open the durable-backend HTTP gate only. The functions remain the memory
// implementations asserted above; no durable client or sockets are installed.
kv.backend = 'supabase';
async function invoke({method = 'POST', query = {action: 'play-session'}, body, headers = {}} = {}) {
  let status = 200, result;
  const responseHeaders = {};
  await gameModule.exports({method, query, body, socket: {},
    headers: {'content-type': 'application/json', 'x-forwarded-for': 'play-contract-fixture', ...headers}}, {
    setHeader(name, value) {responseHeaders[name.toLowerCase()] = value;},
    status(value) {status = value; return this;},
    json(value) {result = value; return value;}, end() {},
  });
  return {status, body: result, headers: responseHeaders};
}
function base58(bytes) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = BigInt('0x' + bytes.toString('hex')), out = '';
  while (n) {out = alphabet[Number(n % 58n)] + out; n /= 58n;}
  for (const byte of bytes) {if (byte) break; out = '1' + out;}
  return out;
}
async function owner() {
  const {publicKey, privateKey} = crypto.generateKeyPairSync('ed25519');
  const wallet = base58(publicKey.export({format: 'der', type: 'spki'}).subarray(12));
  const sessionId = 'a'.repeat(32);
  const token = `rxp1.${wallet}.${sessionId}.${crypto.randomBytes(32).toString('hex')}`;
  const grant = sessions.canonicalGrant({wallet, id: sessionId,
    tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
    issuedAt: time, expiresAt: time + 60 * 60000,
    limits: {maxAttempts: 5, maxStakeCredits: 100, maxGrossCredits: 500, minIntervalMs: 60000}}, time);
  await kv.setJSON('u:' + wallet, {w: wallet, cr: 1000, bal: 0, granted: true,
    qualified: true, agent: {name: 'offline play contract'}, xp: 0, streak: 0,
    best: 0, hits: 5, shots: 13, burned: 0, bn: 13, bsum: 4.0131,
    calib: {5: {n: 13, h: 5}}, day: new Date(time).toISOString().slice(0, 10), open: [], closed: []});
  const payload = JSON.stringify(grant);
  const response = await invoke({body: {op: 'grant', payload,
    signature: crypto.sign(null, Buffer.from(payload), privateKey).toString('base64')},
  headers: {origin: 'https://ratchetx.xyz'}});
  assert.equal(response.status, 200, 'synthetic grant must pass the actual signature gate');
  return {wallet, sessionId, token, tokenHash: grant.tokenHash};
}
function memoryJournal(events) {
  const entries = [];
  let created = false;
  return {entries,
    async create(value) {assert.equal(created, false); created = true;
      entries.push(structuredClone(value)); events.push({kind: 'journal-create'});},
    async read() {return structuredClone(entries);},
    async append(value) {assert.equal(created, true); entries.push(structuredClone(value));
      events.push({kind: 'journal-append', entry: value.kind});},
    async close() {},
  };
}
async function advance(f, ms) {
  time += ms;
  // Memory setnxJSON does not implement TTL expiry. Advance only the real
  // five-second status throttle with fake time, not capability/player records.
  const key = 'play-status-throttle:' + f.wallet, throttle = await kv.getJSONStrict(key);
  if (throttle && time - throttle.t >= 5000) await kv.delKey(key);
  currentPrice = time - shotStart >= 300000 ? 110 : 100;
  await capture();
}
async function run(f, options) {
  const events = [], replies = [], journal = options.mode === 'status' ? undefined : memoryJournal(events);
  const result = await runPlay({wallet: f.wallet, sessionId: f.sessionId,
    maxWaitMs: 6 * 60000, pollMs: 30000, ...options}, {
    ...(journal ? {journal} : {}), env: {RATCHET_PLAY_SESSION: f.token}, now: () => time - epoch,
    sleep: async ms => {events.push({kind: 'sleep', ms}); await advance(f, ms);},
    onEvent: event => events.push({kind: 'runner-event', ...event}),
    fetch: async (url, options) => {
      assert.ok(Object.values(URLS).includes(url));
      assert.equal(options.redirect, 'error');
      const address = new URL(url), body = options.body ? JSON.parse(options.body) : undefined;
      const headers = Object.fromEntries(Object.entries(options.headers).map(([k, v]) => [k.toLowerCase(), v]));
      if (options.method === 'POST') {
        assert.equal(url, URLS.session);
        assert.equal(headers.authorization, 'Bearer ' + f.token);
        assert.ok(['status', 'shot'].includes(body.op), 'runner cannot grant, fund or revoke');
      } else assert.equal(headers.authorization, undefined);
      const event = {kind: 'request', method: options.method, url, op: body?.op, body: options.body};
      events.push(event);
      const response = await invoke({method: options.method,
        query: Object.fromEntries(address.searchParams), body, headers});
      replies.push({event, ...structuredClone(response)});
      if(!body&&url===URLS.board&&flipSourceAfterBoard){
        flipSourceAfterBoard=false;
        runtimeSource='coinbase';
      }
      const wire = JSON.stringify(response.body);
      return {status: response.status, redirected: false, url,
        headers: {get: name => name.toLowerCase() === 'date' ? new Date(time).toUTCString()
          : response.headers[name.toLowerCase()] ?? null}, text: async () => wire};
    },
  });
  const safe = JSON.stringify({result, journal: journal?.entries});
  assert.ok(!safe.includes(f.token), 'no capability in outputs/journal');
  assert.ok(!safe.includes(f.tokenHash), 'no verifier in outputs/journal');
  for (const reply of replies) if (reply.body?.shot?.salt)
    assert.ok(!safe.includes(reply.body.shot.salt), 'no unrevealed salt in outputs/journal');
  assert.equal(await kv.getJSONStrict('lock:u:' + f.wallet), null);
  return {result, events, replies, journal};
}
async function economicState(f) {
  const player = await kv.getJSONStrict('u:' + f.wallet);
  const session = await kv.getJSONStrict(PREFIX + f.wallet);
  return {player: Object.fromEntries(['cr', 'bn', 'bsum', 'open', 'closed'].map(k => [k, player[k]])),
    session: Object.fromEntries(['attempts', 'grossCredits', 'pending', 'requests'].map(k => [k, session[k]]))};
}

try {
  await capture();
  const f = await owner();
  const board = await invoke({method: 'GET', query: {action: 'board'}});
  assert.equal(board.status, 200);
  const target = board.body.targets.find(row => row.kind === 'dir' && row.mins === 5);
  assert.ok(target);
  const intent = {target: target.id, side: 'YES', p: 0.55, stake: 100};
  const commands = ['1000000000000000001', '1000000000000000002'];
  const results = [];
  for (const [index, commandId] of commands.entries()) {
    if (index) await advance(f, 6000);
    shotStart = time; currentPrice = 100; await capture();
    const beforeDispatch = dispatched.length, beforeCommit = acceptedCommits.length;
    const executed = await run(f, {mode: 'execute', commandId, waitSettle: true, ...intent});
    results.push(executed.result);
    assert.equal(executed.result.code, 'PASS_HIT', JSON.stringify(executed.result));
    assert.equal(executed.result.immediateWireReplayVerified, true);
    assert.equal(executed.result.debitObserved, true);
    assert.equal(executed.result.creditsBefore, 1000 + 70 * index);
    assert.equal(executed.result.creditsAfter, 1070 + 70 * index);
    assert.equal(executed.result.statedAfter, 14 + index);
    const wires = executed.replies.filter(reply => reply.event.op === 'shot');
    assert.equal(wires.length, 2, 'one submit and exactly one wire replay per command');
    const [first, replay] = wires;
    assert.equal(first.status, 200); assert.equal(replay.status, 200);
    assert.equal(first.body.request.state, 'accepted');
    assert.equal(replay.body.idempotent, true);
    assert.deepEqual(replay.body.request, first.body.request);
    assert.equal(first.event.body, replay.event.body, 'exact wire JSON replay');
    assert.equal(executed.events.indexOf(replay.event), executed.events.indexOf(first.event) + 1,
      'submit/replay must be adjacent without intervening status, journal or sleep');
    assert.equal(dispatched.length - beforeDispatch, 1, 'one canonical shot dispatch per command');
    assert.equal(acceptedCommits.length - beforeCommit, 1, 'one atomic debit/receipt commit per command');
    assert.equal(first.body.request.intent.requestId, commandRequestId(f.wallet, f.sessionId, commandId));
    const state = await economicState(f);
    assert.equal(state.session.attempts, index + 1);
    assert.equal(state.session.grossCredits, 100 * (index + 1));
    assert.equal(state.session.pending, null);
    assert.equal(state.player.open.length, 0);
    assert.equal(state.player.closed.length, index + 1);
  }
  assert.notEqual(results[0].shotId, results[1].shotId, 'distinct commands authorize distinct shots');
  assert.equal(new Set(dispatched).size, 2);
  console.log('Session-play canonical contract: two command IDs on one five-attempt grant, each exact replay and one debit PASS');

  await advance(f, 6000);
  const beforeDuplicate = await economicState(f), beforeDispatch = dispatched.length;
  const duplicate = await run(f, {mode: 'execute', commandId: commands[0], ...intent});
  assert.equal(duplicate.result.category, 'DUPLICATE', JSON.stringify(duplicate.result));
  assert.equal(duplicate.result.code, 'COMMAND_ALREADY_RECORDED');
  assert.equal(duplicate.result.immediateWireReplayVerified, false);
  assert.equal(duplicate.journal.entries.length, 0, 'alternate journal cannot mint a second request');
  assert.deepEqual(duplicate.replies.map(r => r.event.op), ['status']);
  assert.equal(dispatched.length, beforeDispatch);
  assert.deepEqual(await economicState(f), beforeDuplicate);

  await advance(f, 6000);
  const beforeConflict = await economicState(f);
  const conflict = await run(f, {mode: 'execute', commandId: commands[0], ...intent, side: 'NO'});
  assert.equal(conflict.result.code, 'COMMAND_CONFLICT', JSON.stringify(conflict.result));
  assert.equal(conflict.journal.entries.length, 0);
  assert.deepEqual(conflict.replies.map(r => r.event.op), ['status']);
  assert.deepEqual(await economicState(f), beforeConflict);
  console.log('Session-play canonical contract: alternate-journal duplicate and changed-intent conflict cannot debit again PASS');

  await advance(f, 6000);
  const beforeHeldStock = await economicState(f), beforeHeldDispatch = dispatched.length;
  const heldStock = await run(f, {mode: 'execute', commandId: '1000000000000000003',
    say: 'put 100 on teslla higher'});
  assert.equal(heldStock.result.code, 'ASSET_NOT_ON_BOARD', JSON.stringify(heldStock.result));
  assert.equal(heldStock.result.requestedAsset, 'TSLA');
  assert.equal(heldStock.result.journalRetained, false);
  assert.equal(heldStock.journal.entries.length, 0);
  assert.equal(heldStock.replies.some(r => r.event.op === 'shot'), false,
    'an authenticated stock refusal must never reach op:shot');
  assert.equal(dispatched.length, beforeHeldDispatch);
  assert.deepEqual(await economicState(f), beforeHeldStock,
    'stock refusal must consume no attempt, gross allowance or credits');
  console.log('Session-play canonical contract: authenticated stock typo refuses before dispatch or debit PASS');

  await advance(f, 6000);
  const beforeStats = await economicState(f);
  const stats = await run(f, {mode: 'status'});
  assert.equal(stats.result.category, 'STATUS', JSON.stringify(stats.result));
  assert.equal(stats.result.code, 'STATUS');
  assert.equal(stats.result.attempts, 2);
  assert.equal(stats.result.remainingAttempts, 3);
  assert.equal(stats.result.grossCredits, 200);
  assert.equal(stats.result.remainingGrossCredits, 300);
  assert.equal(stats.result.credits, 1140);
  assert.equal(stats.result.stated, 15);
  assert.equal(stats.journal, undefined);
  assert.deepEqual(stats.replies.map(r => ({method: r.event.method, op: r.event.op,
    body: r.event.body})), [{method: 'POST', op: 'status', body: '{"op":"status"}'}]);
  assert.equal(dispatched.length, beforeDispatch, 'stats must not dispatch a forecast');
  assert.deepEqual(await economicState(f), beforeStats, 'settled stats cannot mutate economic state');

  await advance(f, 6000);
  const beforeRace = await economicState(f), beforeRaceDispatch = dispatched.length;
  runtimeSource='pyth-onchain';
  flipSourceAfterBoard=true;
  const sourceRace = await run(f, {mode:'execute', commandId:'1000000000000000004',
    say:'put 100 on sol higher'});
  runtimeSource='pyth-onchain';
  assert.equal(sourceRace.result.category,'REFUSED',JSON.stringify(sourceRace.result));
  assert.equal(sourceRace.result.code,'FEED_UNAVAILABLE');
  assert.notEqual(sourceRace.result.code,'ATTEMPT_UNRESOLVED');
  assert.equal(dispatched.length-beforeRaceDispatch,1,
    'the source changed only after the board read, so one inner dispatch was attempted');
  const afterRace=await economicState(f);
  assert.equal(afterRace.session.pending,null,'definite pre-debit refusal is terminal');
  assert.equal(afterRace.session.attempts,beforeRace.session.attempts+1);
  assert.equal(afterRace.session.grossCredits,beforeRace.session.grossCredits+100);
  assert.equal(afterRace.player.cr,beforeRace.player.cr,'readiness race debits no credits');
  assert.deepEqual(afterRace.player.open,beforeRace.player.open);
  assert.deepEqual(afterRace.player.closed,beforeRace.player.closed);
  console.log('Session-play canonical contract: board-to-seal source race terminalizes safely without debit PASS');

  assert.equal(networkAttempts, 0, 'entire fixture must attempt zero external connections');
  console.log('Session-play canonical contract: stats use protected status only, no journal or new forecast PASS');
} finally {
  gameModule.exports = game; kv.backend = originalBackend; kv.commitGuarded = originalCommit;
  if (originalPricesModule) require.cache[pricesPath] = originalPricesModule;
  else delete require.cache[pricesPath];
  Date.now = originalNow; globalThis.fetch = originalFetch;
  if (originalMemory === undefined) delete globalThis.__ratchet_mem;
  else globalThis.__ratchet_mem = originalMemory;
  if (originalGate === undefined) delete globalThis.__ratchet_pxgate;
  else globalThis.__ratchet_pxgate = originalGate;
  for (const [name, value] of removedEnvironment) process.env[name] = value;
}
